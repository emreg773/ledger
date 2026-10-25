import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwner, viewerOwner } from "./access";
import { logEvent } from "./events";

// The demo clock (Step 4 brief, Section 4). Each owner can skip time forward;
// every time-based check (deadlines, reminders, countdowns, nudges, the weekly
// roundup) uses nowMs() instead of Date.now().

const DAY_MS = 24 * 60 * 60 * 1000;

/** The owner's demo-adjusted time: Date.now() plus their clock offset. */
export async function nowMs(ctx: QueryCtx | MutationCtx, ownerId: Id<"owners">): Promise<number> {
  const owner = await ctx.db.get(ownerId);
  return Date.now() + (owner?.clockOffsetMs ?? 0);
}

/**
 * The calendar date (YYYY-MM-DD) at a time, in Pacific time: every owner is in
 * Alameda County, and UTC would roll over to tomorrow at 5 PM.
 */
export function isoDateAt(ms: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ms);
  } catch {
    return new Date(ms - 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

/** For the owner's demo clock panel and useNow(). Zero offset when signed out. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    const offsetMs = owner?.clockOffsetMs ?? 0;
    return { offsetMs, nowMs: Date.now() + offsetMs };
  },
});

async function setOffset(ctx: MutationCtx, offsetMs: number) {
  const owner = await requireOwner(ctx);
  await ctx.db.patch(owner._id, { clockOffsetMs: offsetMs === 0 ? undefined : offsetMs });
  const date = new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
  await logEvent(ctx, {
    ownerId: owner._id,
    type: "clock_changed",
    summary: offsetMs === 0 ? "Demo clock reset to today" : `Demo clock set to ${date}`,
  });
  // Catch up: skipping ahead fires every reminder that would have fired in between.
  await ctx.scheduler.runAfter(0, internal.deadlines.runDue, { ownerId: owner._id });
  await ctx.scheduler.runAfter(0, internal.digest.runDue, { ownerId: owner._id });
  return null;
}

/** Skips the owner's clock forward by whole days. */
export const advance = mutation({
  args: { days: v.number() },
  handler: async (ctx, { days }) => {
    if (!Number.isFinite(days) || days <= 0 || days > 366) {
      throw new ConvexError({ code: "invalid_input", message: "days must be between 1 and 366" });
    }
    const owner = await requireOwner(ctx);
    return await setOffset(ctx, (owner.clockOffsetMs ?? 0) + Math.round(days) * DAY_MS);
  },
});

/** Sets the owner's demo date (same time of day as now). Not before today. */
export const setDate = mutation({
  args: { isoDate: v.string() },
  handler: async (ctx, { isoDate }) => {
    const target = Date.parse(`${isoDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || Number.isNaN(target)) {
      throw new ConvexError({ code: "invalid_input", message: "isoDate must be YYYY-MM-DD" });
    }
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    if (target < today) {
      throw new ConvexError({ code: "invalid_input", message: "The demo clock only moves forward" });
    }
    return await setOffset(ctx, target - today);
  },
});

/** Back to the real date. */
export const reset = mutation({
  args: {},
  handler: async (ctx) => await setOffset(ctx, 0),
});
