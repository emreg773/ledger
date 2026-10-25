import { v } from "convex/values";
import { internalAction, query } from "./_generated/server";

// Deadline reminders (Step 4 brief, Section 5). STUB: real version in a/step4-reminders.

export type UpcomingItem = {
  key: string;
  date: string; // ISO date
  title: string;
  source: "case" | "general" | "calendar";
  caseId?: string;
  link?: string;
};

/** Case deadlines, general form due dates and calendar compliance events between two dates. */
export const upcoming = query({
  args: { fromIso: v.string(), toIso: v.string() },
  handler: async (): Promise<UpcomingItem[]> => [],
});

/** Sends every reminder that's due by the owner's demo clock and not sent yet. */
export const runDue = internalAction({
  args: { ownerId: v.id("owners") },
  handler: async () => null,
});
