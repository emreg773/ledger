import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { listUIMessages, saveMessage, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireOwner, viewerOwner } from "./access";
import { ownedThread, startConversation, touchConversation } from "./conversations";

/** Messages for the chat UI (shape required by useUIMessages). */
export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    // useUIMessages passes the threadId, so check it's one of the viewer's conversations.
    const owner = await viewerOwner(ctx);
    if (!owner) throw new ConvexError({ code: "not_found", message: "Not found" });
    await ownedThread(ctx, owner, args.threadId);
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});

/**
 * A typed message from the owner. Saved now, answered in the background.
 * Inside an open conversation (threadId) it continues it; otherwise it starts a
 * new one. Returns the conversation's threadId.
 */
export const sendMessage = mutation({
  // TODO: ownerId is ignored; remove it once no client sends it.
  args: { text: v.string(), threadId: v.optional(v.string()), ownerId: v.optional(v.id("owners")) },
  handler: async (ctx, { text, threadId: openThread }) => {
    const owner = await requireOwner(ctx);
    const ownerId = owner._id;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const threadId = openThread
      ? await ownedThread(ctx, owner, openThread)
      : await startConversation(ctx, ownerId, { title: trimmed });
    if (openThread) await touchConversation(ctx, threadId);
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      userId: ownerId,
      prompt: trimmed,
    });
    await ctx.scheduler.runAfter(0, internal.agent.respond, {
      ownerId,
      threadId,
      promptMessageId: messageId,
    });
    return threadId;
  },
});
