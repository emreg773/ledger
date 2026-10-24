import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOwner, viewerOwner } from "./access";
import { notificationCategory } from "./schema";

// The notification center: every notification Ledger sent (push.ts records
// them in queuePush), searchable and filterable by category. Which ones are
// time-sensitive depends on today's date, so the UI decides what to pin from
// the case facts returned here.

const LIMIT = 100;

export type NotificationView = Doc<"notifications"> & {
  case: {
    docType: string;
    title: string;
    deadline?: string;
    status: Doc<"cases">["status"];
    /** The owner still has a proposed action to approve, reject or mark done. */
    hasPendingAction: boolean;
  } | null;
};

/** Newest first, or by relevance with `search`. Empty when signed out. */
export const list = query({
  args: {
    search: v.optional(v.string()),
    category: v.optional(notificationCategory),
  },
  handler: async (ctx, { search, category }): Promise<NotificationView[]> => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    const ownerId = owner._id;
    const text = search?.trim();

    const rows = text
      ? await ctx.db
          .query("notifications")
          .withSearchIndex("search_text", (q) => {
            const byOwner = q.search("searchText", text).eq("ownerId", ownerId);
            return category ? byOwner.eq("category", category) : byOwner;
          })
          .take(LIMIT)
      : category
        ? await ctx.db
            .query("notifications")
            .withIndex("by_owner_and_category", (q) => q.eq("ownerId", ownerId).eq("category", category))
            .order("desc")
            .take(LIMIT)
        : await ctx.db
            .query("notifications")
            .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
            .order("desc")
            .take(LIMIT);

    // One lookup per case, however many notifications point at it.
    const cases = new Map<string, NotificationView["case"]>();
    for (const caseId of new Set(rows.flatMap((n) => (n.caseId ? [n.caseId] : [])))) {
      const c = await ctx.db.get(caseId);
      if (!c || c.ownerId !== ownerId) continue;
      const pending = await ctx.db
        .query("actions")
        .withIndex("by_case", (q) => q.eq("caseId", caseId))
        .filter((q) => q.eq(q.field("status"), "proposed"))
        .first();
      cases.set(caseId, {
        docType: c.docType,
        title: c.title,
        deadline: c.deadline,
        status: c.status,
        hasPendingAction: pending !== null,
      });
    }
    return rows.map((n) => ({ ...n, case: n.caseId ? (cases.get(n.caseId) ?? null) : null }));
  },
});

/** For the badge on the bell. 0 when signed out. */
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_owner_and_read", (q) => q.eq("ownerId", owner._id).eq("readAt", undefined))
      .take(LIMIT);
    return unread.length;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const owner = await requireOwner(ctx);
    const n = await ctx.db.get(notificationId);
    if (n && n.ownerId === owner._id && n.readAt === undefined) {
      await ctx.db.patch(notificationId, { readAt: Date.now() });
    }
    return null;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_owner_and_read", (q) => q.eq("ownerId", owner._id).eq("readAt", undefined))
      .collect();
    const now = Date.now();
    for (const n of unread) await ctx.db.patch(n._id, { readAt: now });
    return null;
  },
});
