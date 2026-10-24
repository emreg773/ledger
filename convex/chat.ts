import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { listUIMessages, saveMessage, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireOwner, viewerOwner } from "./access";

/** Messages for the chat UI (shape required by useUIMessages). */
export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    // useUIMessages passes the threadId, so check it's the viewer's own thread.
    const owner = await viewerOwner(ctx);
    if (!owner || owner.agentThreadId !== args.threadId) {
      throw new ConvexError({ code: "not_found", message: "Not found" });
    }
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});

/** A typed message from the owner. Saved now, answered in the background. */
export const sendMessage = mutation({
  // TODO(step3): ownerId is ignored and goes away once Track B's UI stops sending it.
  args: { text: v.string(), ownerId: v.optional(v.id("owners")) },
  handler: async (ctx, { text }) => {
    const owner = await requireOwner(ctx);
    const ownerId = owner._id;
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
