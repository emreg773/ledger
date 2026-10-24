import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

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

export const getInternal = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const owner = await ctx.db.get(c.ownerId);
    const actions = await ctx.db
      .query("actions")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect();
    return { case: c, owner, actions };
  },
});

export const setPlaybook = internalMutation({
  args: { caseId: v.id("cases"), docType: v.string() },
  handler: async (ctx, { caseId, docType }) => {
    await ctx.db.patch(caseId, { playbookDocType: docType });
  },
});
