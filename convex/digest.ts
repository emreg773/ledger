import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// Person B owns this file. STUB from Person A's schema PR so the demo clock can
// call it; replace the body.

/** Sends the weekly roundup and nudges that are due by the owner's demo clock. */
export const runDue = internalAction({
  args: { ownerId: v.id("owners") },
  handler: async () => null,
});
