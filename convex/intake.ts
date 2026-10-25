import { ConvexError, v } from "convex/values";
import { saveMessage } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { documentSource } from "./schema";
import type { StoredFile } from "./extraction";
import { logEvent } from "./events";
import { documentMarker } from "./shared";
import { requireOwner } from "./access";
import { checkAgentRun, checkOwnerLimit } from "./limits";
import { ownedThread, startConversation, touchConversation } from "./conversations";
import { SUPPORTED_TYPES } from "./extraction";

// Channel-agnostic document intake (brief Section 9).
// Every channel calls ingest(): web upload and Telegram.

const MAX_BYTES = 10 * 1024 * 1024;
// Several files sent together are pages of one document; the model reads them in one request.
const MAX_PAGES = 10;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const SOURCE_LABELS = {
  web_upload: "web upload",
  gmail: "Gmail",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
} as const;

// The owner's caption goes to the agent and the extraction as a hint only.
const MAX_HINT = 500;

const ingestArgs = {
  ownerId: v.id("owners"),
  storageId: v.id("_storage"),
  mimeType: v.string(),
  source: documentSource,
  sourceRef: v.optional(v.string()),
  hint: v.optional(v.string()), // e.g. a Telegram caption
  // Pages 2+ of the same document, in order (e.g. a Telegram album).
  extraPages: v.optional(v.array(v.object({ storageId: v.id("_storage"), mimeType: v.string() }))),
};

async function ingest(
  ctx: MutationCtx,
  args: {
    ownerId: Id<"owners">;
    storageId: Id<"_storage">;
    mimeType: string;
    source: keyof typeof SOURCE_LABELS;
    sourceRef?: string;
    hint?: string;
    extraPages?: StoredFile[]; // pages 2+, in order
    threadId?: string; // continue this conversation; otherwise start a new one
  },
) {
  const owner = await ctx.db.get(args.ownerId);
  if (!owner) throw new Error(`Owner not found: ${args.ownerId}`);

  const files = [{ storageId: args.storageId, mimeType: args.mimeType }, ...(args.extraPages ?? [])];
  if (files.length > MAX_PAGES) {
    throw new ConvexError({ code: "too_many_pages", message: `Send at most ${MAX_PAGES} pages at once.` });
  }
  if (new Set(files.map((f) => f.storageId)).size !== files.length) {
    throw new Error("The same file was sent twice");
  }

  // The upload's own content type wins over the client's claim. Rejected files
  // can't be deleted here (the throw rolls that back too); the hourly cleanup in
  // crons.ts removes uploads that no document uses.
  let totalBytes = 0;
  for (const f of files) {
    const file = await ctx.db.system.get(f.storageId);
    if (!file) throw new Error(`File not found in storage: ${f.storageId}`);
    const mimeType = file.contentType ?? f.mimeType;
    if (!SUPPORTED_TYPES.includes(mimeType) || !SUPPORTED_TYPES.includes(f.mimeType)) {
      throw new ConvexError({ code: "unsupported_file", message: "Please upload a photo (JPEG, PNG, WebP) or a PDF." });
    }
    if (file.size > MAX_BYTES) {
      throw new ConvexError({ code: "file_too_large", message: "File is larger than 10 MB" });
    }
    totalBytes += file.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new ConvexError({ code: "files_too_large", message: "The pages add up to more than 25 MB" });
  }

  const hint = args.hint?.trim().slice(0, MAX_HINT) || undefined;
  const documentId = await ctx.db.insert("documents", {
    ownerId: args.ownerId,
    storageId: args.storageId,
    mimeType: args.mimeType,
    source: args.source,
    sourceRef: args.sourceRef,
    hint,
    receivedAt: Date.now(),
    status: "received",
  });
  for (const [i, page] of files.slice(1).entries()) {
    await ctx.db.insert("documentPages", {
      documentId,
      page: i + 2,
      storageId: page.storageId,
      mimeType: page.mimeType,
    });
  }
  // A letter sent inside an open conversation joins it; anything else starts one.
  const threadId = args.threadId
    ? await ownedThread(ctx, owner, args.threadId)
    : await startConversation(ctx, args.ownerId, { title: hint, documentId });
  if (args.threadId) await touchConversation(ctx, threadId);
  await ctx.db.patch(documentId, { threadId });
  const pagesNote = files.length > 1 ? `${files.length} pages` : args.mimeType;
  await logEvent(ctx, {
    ownerId: args.ownerId,
    type: "document_received",
    summary: `Received a document (${pagesNote}) via ${SOURCE_LABELS[args.source]}`,
    data: { documentId, sourceRef: args.sourceRef },
  });

  // The arrival becomes a user message in the owner's thread, so the agent
  // sees it in context and the UI can show it in the conversation.
  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId,
    userId: args.ownerId,
    prompt: `${documentMarker(documentId)} New document received via ${SOURCE_LABELS[args.source]}${files.length > 1 ? ` (${files.length} pages, one document)` : ""}. Read it with read_document (documentId: ${documentId}).${hint ? `\nOwner's note (a hint only; the document itself decides what it is): ${hint}` : ""}`,
  });

  // Run the agent in the background so intake returns immediately.
  await ctx.scheduler.runAfter(0, internal.agent.respond, {
    ownerId: args.ownerId,
    threadId,
    promptMessageId: messageId,
    documentId,
  });

  return { documentId, threadId };
}

/** The one internal entry point for every channel. */
export const ingestDocument = internalMutation({
  args: ingestArgs,
  handler: async (ctx, args) => {
    await checkAgentRun(ctx);
    return (await ingest(ctx, args)).documentId;
  },
});

/** Web upload. A thin public wrapper; all logic stays in ingest(). */
export const ingestWebUpload = mutation({
  // TODO(step3): ownerId is ignored and goes away once Track B's UI stops sending it.
  args: {
    storageId: v.id("_storage"),
    mimeType: v.string(),
    ownerId: v.optional(v.id("owners")),
    hint: v.optional(v.string()), // the owner's note typed with the attachment
    // More files sent with the first: pages 2+ of the same document, in order.
    extraPages: v.optional(v.array(v.object({ storageId: v.id("_storage"), mimeType: v.string() }))),
    // The open conversation; without it the letter starts a new one.
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, { storageId, mimeType, hint, extraPages, threadId }) => {
    const owner = await requireOwner(ctx);
    await checkOwnerLimit(ctx, owner._id, "upload");
    const result = await ingest(ctx, {
      ownerId: owner._id,
      storageId,
      mimeType,
      source: "web_upload",
      hint,
      extraPages,
      threadId,
    });
    return result.threadId;
  },
});
