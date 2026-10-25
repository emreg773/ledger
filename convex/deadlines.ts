import { v } from "convex/values";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { viewerOwner } from "./access";
import { complianceEvents } from "./calendarCompliance";
import { GENERAL_DATES } from "./generalDates";

// Upcoming deadlines for the home calendar (Step 4 brief, Section 5). Three
// sources, one list: open cases with a deadline, general form due dates
// (generalDates.ts), and compliance events from the owner's Google Calendar
// (calendarCompliance.ts). Cases and calendar events get Telegram nudges
// (nudges.ts).

export type UpcomingItem = {
  key: string;
  date: string; // ISO date
  title: string; // English; docType or form lets the UI translate it
  source: "case" | "general" | "calendar";
  caseId?: string;
  link?: string;
  docType?: string;
  form?: string;
  amountDue?: number;
};

async function collectItems(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<"owners">,
  fromIso: string,
  toIso: string,
): Promise<UpcomingItem[]> {
  const items: UpcomingItem[] = [];
  const cases = await ctx.db
    .query("cases")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const c of cases) {
    if (c.status === "resolved" || !c.deadline || c.deadline < fromIso || c.deadline > toIso) continue;
    items.push({
      key: `case|${c._id}`,
      date: c.deadline,
      title: c.title,
      source: "case",
      caseId: c._id,
      docType: c.docType,
      amountDue: c.amountDue,
    });
  }
  for (const g of GENERAL_DATES) {
    if (g.date < fromIso || g.date > toIso) continue;
    items.push({
      key: g.key,
      date: g.date,
      title: `Form ${g.form} due (${g.period})`,
      source: "general",
      link: g.link,
      form: g.form,
    });
  }
  const calendar = await complianceEvents(ctx, ownerId, fromIso, toIso);
  for (const e of calendar) {
    items.push({ key: `calendar|${e.key}`, date: e.date, title: e.title, source: "calendar", link: e.link });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** The signed-in owner's deadlines between two ISO dates (Person B's Upcoming panel uses it too). */
export const upcoming = query({
  args: { fromIso: v.string(), toIso: v.string() },
  handler: async (ctx, { fromIso, toIso }): Promise<UpcomingItem[]> => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    return await collectItems(ctx, owner._id, fromIso, toIso);
  },
});
