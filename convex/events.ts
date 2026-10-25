import { v } from "convex/values";
import { internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server";
import { viewerOwner } from "./access";
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

/** Debug helper: npx convex run events:listForOwner '{"ownerId": "..."}' */
export const listForOwner = internalQuery({
  args: { ownerId: v.id("owners"), limit: v.optional(v.number()) },
  handler: async (ctx, { ownerId, limit }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(limit ?? 50);
  },
});

/** Live activity for the UI: events newest first, optionally only those after sinceMs. */
export const listRecentForOwner = query({
  // TODO: ownerId is ignored; remove it once no client sends it.
  args: {
    ownerId: v.optional(v.id("owners")),
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { sinceMs, limit }) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    const ownerId = owner._id;
    const events = await ctx.db
      .query("events")
      .withIndex("by_owner", (q) =>
        sinceMs === undefined
          ? q.eq("ownerId", ownerId)
          : q.eq("ownerId", ownerId).gte("at", sinceMs),
      )
      .order("desc")
      .take(limit ?? 50);
    return events.map(({ _id, type, summary, caseId, at }) => ({ _id, type, summary, caseId, at }));
  },
});
