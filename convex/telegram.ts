import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// Person B owns this file. STUB from Person A's schema PR so agent runs on
// Telegram documents can report back; replace the body.

/** Sends a document's result (the same title and body as the push) to the owner's Telegram chat. */
export const notifyDocumentResult = internalAction({
  args: {
    ownerId: v.id("owners"),
    documentId: v.id("documents"),
    caseId: v.optional(v.id("cases")),
    title: v.string(),
    body: v.string(),
  },
  handler: async () => null,
});
