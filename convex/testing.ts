import { v } from "convex/values";
import { listUIMessages } from "@convex-dev/agent";
import { components } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { extractFromStorage } from "./extraction";

// Test harness helpers. Internal only; call with `npx convex run`.

/**
 * Runs extraction on a stored file and prints the JSON. Writes nothing.
 * npx convex run testing:extractStorageId '{"storageId":"...","mimeType":"image/jpeg"}'
 */
export const extractStorageId = internalAction({
  args: { storageId: v.id("_storage"), mimeType: v.string() },
  handler: async (ctx, { storageId, mimeType }) => {
    const extraction = await extractFromStorage(ctx, storageId, mimeType);
    console.log(JSON.stringify(extraction, null, 2));
    return extraction;
  },
});

/** Latest messages in the demo owner's thread, oldest first. For checking agent replies. */
export const recentMessages = internalQuery({
  args: { count: v.optional(v.number()) },
  handler: async (ctx, { count }) => {
    const owner = await ctx.db.query("owners").first();
    if (!owner) return [];
    const { page } = await listUIMessages(ctx, components.agent, {
      threadId: owner.agentThreadId,
      paginationOpts: { numItems: count ?? 6, cursor: null },
    });
    return page.map((m) => ({ role: m.role, status: m.status, text: m.text }));
  },
});
