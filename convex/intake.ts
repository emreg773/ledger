import { ConvexError, v } from "convex/values";
import { saveMessage } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { documentSource } from "./schema";
import { logEvent } from "./events";
import { documentMarker } from "./shared";
import { requireOwner } from "./access";
import { checkAgentRun, checkOwnerLimit } from "./limits";
import { SUPPORTED_TYPES } from "./extraction";

// Channel-agnostic document intake (brief Section 9).
// Every channel calls ingest(): web upload now, Gmail in Step 4, WhatsApp in Step 5.

const MAX_BYTES = 10 * 1024 * 1024;

const SOURCE_LABELS = {
  web_upload: "web upload",
  gmail: "Gmail",
  whatsapp: "WhatsApp",
} as const;

const ingestArgs = {
  ownerId: v.id("owners"),
  storageId: v.id("_storage"),
  mimeType: v.string(),
  source: documentSource,
  sourceRef: v.optional(v.string()),
};

async function ingest(
  ctx: MutationCtx,
  args: {
    ownerId: Id<"owners">;
    storageId: Id<"_storage">;
    mimeType: string;
    source: keyof typeof SOURCE_LABELS;
    sourceRef?: string;
  },
) {
  const owner = await ctx.db.get(args.ownerId);
  if (!owner) throw new Error(`Owner not found: ${args.ownerId}`);

  // The upload's own content type wins over the client's claim. Rejected files
  // can't be deleted here (the throw rolls that back too); the hourly cleanup in
  // crons.ts removes uploads that no document uses.
  const file = await ctx.db.system.get(args.storageId);
  if (!file) throw new Error(`File not found in storage: ${args.storageId}`);
  const mimeType = file.contentType ?? args.mimeType;
  if (!SUPPORTED_TYPES.includes(mimeType) || !SUPPORTED_TYPES.includes(args.mimeType)) {
    throw new ConvexError({ code: "unsupported_file", message: "Please upload a photo (JPEG, PNG, WebP) or a PDF." });
  }
  if (file.size > MAX_BYTES) {
    throw new ConvexError({ code: "file_too_large", message: "File is larger than 10 MB" });
  }

  const documentId = await ctx.db.insert("documents", {
    ownerId: args.ownerId,
    storageId: args.storageId,
    mimeType: args.mimeType,
    source: args.source,
    sourceRef: args.sourceRef,
    receivedAt: Date.now(),
    status: "received",
  });
  await logEvent(ctx, {
    ownerId: args.ownerId,
    type: "document_received",
    summary: `Received a document (${args.mimeType}) via ${SOURCE_LABELS[args.source]}`,
    data: { documentId, sourceRef: args.sourceRef },
  });

  // The arrival becomes a user message in the owner's thread, so the agent
  // sees it in context and the UI can show it in the conversation.
  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId: owner.agentThreadId,
    userId: args.ownerId,
    prompt: `${documentMarker(documentId)} New document received via ${SOURCE_LABELS[args.source]}. Read it with read_document (documentId: ${documentId}).`,
  });

  // Run the agent in the background so intake returns immediately.
  await ctx.scheduler.runAfter(0, internal.agent.respond, {
    ownerId: args.ownerId,
    promptMessageId: messageId,
    documentId,
  });

  return documentId;
}

/** The one internal entry point for every channel. */
export const ingestDocument = internalMutation({
  args: ingestArgs,
  handler: async (ctx, args) => {
    await checkAgentRun(ctx);
    return await ingest(ctx, args);
  },
});

/** Web upload. A thin public wrapper; all logic stays in ingest(). */
export const ingestWebUpload = mutation({
  // TODO(step3): ownerId is ignored and goes away once Track B's UI stops sending it.
  args: {
    storageId: v.id("_storage"),
    mimeType: v.string(),
    ownerId: v.optional(v.id("owners")),
  },
  handler: async (ctx, { storageId, mimeType }) => {
    const owner = await requireOwner(ctx);
    await checkOwnerLimit(ctx, owner._id, "upload");
    return await ingest(ctx, { ownerId: owner._id, storageId, mimeType, source: "web_upload" });
  },
});
