import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// Person B owns this file. STUB from Person A's schema PR so deadlines.upcoming
// can call it; replace the body.

/** Compliance events from the owner's Google Calendar between two ISO dates. */
export const list = internalQuery({
  args: { ownerId: v.id("owners"), fromIso: v.string(), toIso: v.string() },
  handler: async (): Promise<{ key: string; date: string; time?: string; title: string; link?: string }[]> => [],
});
