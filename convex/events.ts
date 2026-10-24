import { v } from "convex/values";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Audit log helpers. Every meaningful step writes one readable row.

export async function logEvent(
  ctx: MutationCtx,
  event: {
    ownerId: Id<"owners">;
    caseId?: Id<"cases">;
    type: string;
    summary: string;
    data?: unknown;
  },
) {
  await ctx.db.insert("events", { ...event, at: Date.now() });
}

// For actions, which can't write to the db directly.
export const log = internalMutation({
  args: {
    ownerId: v.id("owners"),
    caseId: v.optional(v.id("cases")),
    type: v.string(),
    summary: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await logEvent(ctx, args);
  },
});

export const listForOwner = query({
  args: { ownerId: v.id("owners"), limit: v.optional(v.number()) },
  handler: async (ctx, { ownerId, limit }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(limit ?? 50);
  },
});
