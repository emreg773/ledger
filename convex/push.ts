import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOwner, viewerOwner } from "./access";

// Web push (Step 3 brief, Section 7). Track B's service worker subscribes and
// calls saveSubscription; Track A sends every push (notifyOwner → pushNode.send).

export const pushKind = v.union(
  v.literal("document_read"),
  v.literal("action_needed"),
  v.literal("action_done"),
  v.literal("document_failed"),
  v.literal("test"),
);

/** Upserts by endpoint. A browser that was another owner's (a shared device) moves to this one. */
export const saveSubscription = mutation({
  args: {
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, { endpoint, keys, userAgent }) => {
    const owner = await requireOwner(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ownerId: owner._id, keys, userAgent });
    } else {
      await ctx.db.insert("pushSubscriptions", {
        ownerId: owner._id,
        endpoint,
        keys,
        userAgent,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

export const removeSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const owner = await requireOwner(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing && existing.ownerId === owner._id) await ctx.db.delete(existing._id);
    return null;
  },
});

/** For "Notifications on". 0 when signed out. */
export const mySubscriptionCount = query({
  args: {},
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return 0;
    const subs = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .collect();
    return subs.length;
  },
});

/** Sends "Notifications are on" to the caller's devices. STUB until pushNode lands. */
export const sendTest = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return null;
  },
});

/** Builds the message for an owner and sends it to their devices. STUB until pushNode lands. */
export const notifyOwner = internalMutation({
  args: {
    ownerId: v.id("owners"),
    kind: pushKind,
    caseId: v.optional(v.id("cases")),
    actionId: v.optional(v.id("actions")),
  },
  handler: async () => null,
});
