import { v } from "convex/values";
import { query } from "./_generated/server";

// Case reads for the UI (Step 2 contract, Section 8).

export const get = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => await ctx.db.get(caseId),
});

/** The owner's cases, newest first. */
export const listForOwner = query({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => {
    return await ctx.db
      .query("cases")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(50);
  },
});
