import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { listUIMessages, saveMessage, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";

/** Messages for the chat UI (shape required by useUIMessages). */
export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    // TODO(auth): check the viewer owns this thread once auth exists.
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});

/** A typed message from the owner. Saved now, answered in the background. */
export const sendMessage = mutation({
  args: { ownerId: v.id("owners"), text: v.string() },
  handler: async (ctx, { ownerId, text }) => {
    const owner = await ctx.db.get(ownerId);
    if (!owner) throw new Error(`Owner not found: ${ownerId}`);
    const trimmed = text.trim();
    if (!trimmed) return;

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: owner.agentThreadId,
      userId: ownerId,
      prompt: trimmed,
    });
    await ctx.scheduler.runAfter(0, internal.agent.respond, {
      ownerId,
      promptMessageId: messageId,
    });
  },
});
