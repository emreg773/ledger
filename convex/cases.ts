import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { viewerOwner } from "./access";

// Case reads for the UI. Only the signed-in owner's cases; anything else is null.

export const get = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const owner = await viewerOwner(ctx);
    const c = await ctx.db.get(caseId);
    return owner && c?.ownerId === owner._id ? c : null;
  },
});

/** The owner's cases, newest first. */
export const listForOwner = query({
  // TODO(step3): ownerId is ignored and goes away once Track B's UI stops sending it.
  args: { ownerId: v.optional(v.id("owners")) },
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    return await ctx.db
      .query("cases")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
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

export type TimelineItem = {
  at: number; // ms, for ordering
  date: string; // ISO date shown to the owner
  kind: "document" | "bank_payment" | "action" | "event";
  title: string; // English; the UI translates by kind
  detail?: string;
  status?: string;
  documentId?: string;
  actionId?: string;
};

/** The case's documents, bank matches, actions and key events, oldest first. STUB. */
export const timeline = query({
  args: { caseId: v.id("cases") },
  handler: async (): Promise<TimelineItem[]> => [],
});
