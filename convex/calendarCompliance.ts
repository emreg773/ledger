import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { isComplianceEvent } from "./calendarRules";

// Compliance events from the owner's Google Calendar: events the business
// filter includes (calendarEvents.business, set at sync in googleCalendar.ts)
// whose title names a deadline or an obligation (calendarRules.ts). Used by the
// deadline list (deadlines.ts) and Telegram nudges (nudges.ts).

export type ComplianceEvent = { key: string; date: string; time?: string; title: string; link?: string };

export async function complianceEvents(
  ctx: QueryCtx,
  ownerId: Id<"owners">,
  fromIso: string,
  toIso: string,
): Promise<ComplianceEvent[]> {
  const rows = await ctx.db
    .query("calendarEvents")
    .withIndex("by_owner_and_date", (q) => q.eq("ownerId", ownerId).gte("date", fromIso).lte("date", toIso))
    .take(500);
  // business is unset only on events synced before the filter; compliance words are business words anyway.
  return rows
    .filter((e) => e.business !== false && isComplianceEvent(e.title))
    .map((e) => ({ key: `${e.googleId}|${e.date}`, date: e.date, time: e.time, title: e.title, link: e.htmlLink }));
}

/** Compliance events from the owner's Google Calendar between two ISO dates. */
export const list = internalQuery({
  args: { ownerId: v.id("owners"), fromIso: v.string(), toIso: v.string() },
  handler: async (ctx, { ownerId, fromIso, toIso }) => await complianceEvents(ctx, ownerId, fromIso, toIso),
});
