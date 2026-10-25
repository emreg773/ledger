import { ConvexError } from "convex/values";
import { createThread, listMessages } from "@convex-dev/agent";
import { components } from "./_generated/api";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { viewerOwner } from "./access";

// Conversation history. Each conversation is one agent thread. A message or a
// letter sent from the home screen, and every letter sent on Telegram, starts a
// new one; sending inside an open conversation continues it. owners.agentThreadId
// is the thread from before conversations existed (or from onboarding); it
// shows in the list as an earlier conversation once it has messages.

const MAX_TITLE = 80;

/** A new conversation for the owner. Its title is the first typed text, if any. */
export async function startConversation(
  ctx: MutationCtx,
  ownerId: Id<"owners">,
  first: { title?: string; documentId?: Id<"documents"> },
): Promise<string> {
  const threadId = await createThread(ctx, components.agent, { userId: ownerId });
  const now = Date.now();
  await ctx.db.insert("conversations", {
    ownerId,
    threadId,
    title: first.title?.trim().slice(0, MAX_TITLE) || undefined,
    documentId: first.documentId,
    createdAt: now,
    lastMessageAt: now,
  });
  return threadId;
}

/** The thread, if it's one of the owner's conversations. Throws otherwise. */
export async function ownedThread(ctx: QueryCtx, owner: Doc<"owners">, threadId: string): Promise<string> {
  if (threadId === owner.agentThreadId) return threadId;
  const row = await ctx.db
    .query("conversations")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique();
  if (row?.ownerId !== owner._id) throw new ConvexError({ code: "not_found", message: "Not found" });
  return threadId;
}

/** Moves a conversation to the top of the list. */
export async function touchConversation(ctx: MutationCtx, threadId: string) {
  const row = await ctx.db
    .query("conversations")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique();
  if (row) await ctx.db.patch(row._id, { lastMessageAt: Date.now() });
}

/** Deletes every conversation's messages and rows (start over, delete account). */
export async function deleteConversations(ctx: MutationCtx, ownerId: Id<"owners">) {
  const rows = await ctx.db
    .query("conversations")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const row of rows) {
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, { threadId: row.threadId });
    await ctx.db.delete(row._id);
  }
}

export type ConversationView = {
  threadId: string;
  title?: string;
  /** The letter that started it: the UI names the conversation after its type. */
  docType?: string;
  /** The thread from before conversation history. */
  earlier?: boolean;
  lastMessageAt: number;
};

/** The viewer's conversations, most recent first. Empty when signed out. */
export const list = query({
  args: {},
  handler: async (ctx): Promise<ConversationView[]> => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .order("desc")
      .take(100);
    const out: ConversationView[] = [];
    for (const row of rows) {
      const doc = row.documentId ? await ctx.db.get(row.documentId) : null;
      out.push({
        threadId: row.threadId,
        title: row.title,
        docType: (doc?.extraction as { docType?: string } | undefined)?.docType,
        lastMessageAt: row.lastMessageAt,
      });
    }
    // The older single thread, if anything was ever said in it.
    if (owner.agentThreadId && !rows.some((r) => r.threadId === owner.agentThreadId)) {
      const { page } = await listMessages(ctx, components.agent, {
        threadId: owner.agentThreadId,
        paginationOpts: { numItems: 1, cursor: null },
      });
      if (page.length > 0) {
        out.push({ threadId: owner.agentThreadId, earlier: true, lastMessageAt: page[0]._creationTime });
        out.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      }
    }
    return out;
  },
});
