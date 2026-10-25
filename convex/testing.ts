import { v } from "convex/values";
import { listUIMessages } from "@convex-dev/agent";
import { components } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { extractFromStorage } from "./extraction";
import { seedBankFor } from "./nessie";

/** The owner with this email, or the newest owner when no email is given. */
async function findOwner(ctx: QueryCtx, email?: string) {
  if (email) {
    return await ctx.db
      .query("owners")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
  }
  return await ctx.db.query("owners").order("desc").first();
}

// Test harness helpers. Internal only; call with `npx convex run`.

/** An upload URL without a signed-in owner (documents:generateUploadUrl needs one). */
export const uploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/**
 * Runs extraction on a stored file and prints the JSON. Writes nothing.
 * npx convex run testing:extractStorageId '{"storageId":"...","mimeType":"image/jpeg"}'
 * Add "extraPages":[{"storageId":"...","mimeType":"..."}] for a multi-page document.
 */
export const extractStorageId = internalAction({
  args: {
    storageId: v.id("_storage"),
    mimeType: v.string(),
    extraPages: v.optional(v.array(v.object({ storageId: v.id("_storage"), mimeType: v.string() }))),
  },
  handler: async (ctx, { storageId, mimeType, extraPages }) => {
    const extraction = await extractFromStorage(ctx, [{ storageId, mimeType }, ...(extraPages ?? [])]);
    console.log(JSON.stringify(extraction, null, 2));
    return extraction;
  },
});

/** Latest messages in an owner's thread (by email; default: the newest owner). */
export const recentMessages = internalQuery({
  args: { count: v.optional(v.number()), email: v.optional(v.string()) },
  handler: async (ctx, { count, email }) => {
    const owner = await findOwner(ctx, email);
    if (!owner) return [];
    const { page } = await listUIMessages(ctx, components.agent, {
      threadId: owner.agentThreadId,
      paginationOpts: { numItems: count ?? 6, cursor: null },
    });
    return page.map((m) => ({ role: m.role, status: m.status, text: m.text }));
  },
});

/**
 * An owner's cases, actions, events and latest messages in one call.
 * npx convex run testing:snapshot '{"email": "you@gmail.com"}' (default: the newest owner)
 */
export const snapshot = internalQuery({
  args: { messages: v.optional(v.number()), email: v.optional(v.string()) },
  handler: async (ctx, { messages, email }) => {
    const owner = await findOwner(ctx, email);
    if (!owner) return null;
    const cases = await ctx.db
      .query("cases")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .collect();
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .collect();
    const actions = await ctx.db
      .query("actions")
      .withIndex("by_owner_and_status", (q) => q.eq("ownerId", owner._id))
      .collect();
    const events = await ctx.db
      .query("events")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .collect();
    const { page } = await listUIMessages(ctx, components.agent, {
      threadId: owner.agentThreadId,
      paginationOpts: { numItems: messages ?? 6, cursor: null },
    });
    return {
      ownerId: owner._id,
      accountLast4: owner.accountLast4,
      documents: documents.map((d) => ({ _id: d._id, status: d.status, caseId: d.caseId })),
      cases,
      actions,
      events: events.map((e) => ({ type: e.type, summary: e.summary, at: e.at })),
      messages: page.map((m) => ({ role: m.role, status: m.status, text: m.text })),
    };
  },
});

/**
 * Reseeds an owner's sandbox bank. With withoutTreasuryPayment, the Oct 2 IRS
 * payment is left out, so the CP14 proposes pay_bill.
 * npx convex run testing:reseedBank '{"email": "you@gmail.com", "withoutTreasuryPayment": true}'
 */
export const reseedBank = internalMutation({
  args: { email: v.optional(v.string()), withoutTreasuryPayment: v.optional(v.boolean()) },
  handler: async (ctx, { email, withoutTreasuryPayment }) => {
    const owner = await findOwner(ctx, email);
    if (!owner) throw new Error("No owner found");
    await seedBankFor(ctx, owner._id, { withoutTreasuryPayment });
    return owner._id;
  },
});
