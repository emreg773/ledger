import { components } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { deleteMockBank } from "./nessie";

// Data deletion, shared by admin.resetDemo (dev), owners.resetMyData and
// owners.deleteMyAccount. The only places that delete events; the audit log is
// append-only otherwise.

/**
 * Deletes an owner's thread messages, documents and their files, generated
 * documents, cases, actions, tasks, staff and events. Keeps the owner row, the
 * profile, the bank ids and the push subscriptions.
 */
export async function deleteOwnerData(ctx: MutationCtx, owner: Doc<"owners">) {
  const ownerId = owner._id;
  if (owner.agentThreadId) {
    // Deletes the thread's messages in the background, in batches.
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: owner.agentThreadId,
    });
  }
  const documents = await ctx.db
    .query("documents")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  const generated = await ctx.db
    .query("generatedDocuments")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const file of [...documents, ...generated]) {
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(file._id);
  }
  for (const table of ["cases", "staff"] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  }
  for (const table of ["actions", "tasks"] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_owner_and_status", (q) => q.eq("ownerId", ownerId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  }
  const events = await ctx.db
    .query("events")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const event of events) await ctx.db.delete(event._id);
  const notifications = await ctx.db
    .query("notifications")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const n of notifications) await ctx.db.delete(n._id);
}

/** Everything above, plus the push subscriptions, the mock bank and the owner row. */
export async function deleteOwner(ctx: MutationCtx, owner: Doc<"owners">) {
  await deleteOwnerData(ctx, owner);
  const subscriptions = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
    .collect();
  for (const s of subscriptions) await ctx.db.delete(s._id);
  await deleteMockBank(ctx, owner._id);
  await ctx.db.delete(owner._id);
}

/** The auth user with its sessions, refresh tokens, accounts and verification codes. */
export async function deleteAuthUser(ctx: MutationCtx, userId: Id<"users">) {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);
    await ctx.db.delete(session._id);
  }
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect();
  for (const account of accounts) {
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", account._id))
      .collect();
    for (const code of codes) await ctx.db.delete(code._id);
    await ctx.db.delete(account._id);
  }
  await ctx.db.delete(userId);
}

/**
 * Dev only: npm run reset (npx convex run admin:resetDemo).
 * Deletes every owner and their data. Google accounts stay signed up, so signing
 * in again starts onboarding.
 */
export const resetDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const owner of await ctx.db.query("owners").collect()) {
      await deleteOwner(ctx, owner);
    }
    return null;
  },
});

const ORPHAN_AGE_MS = 60 * 60 * 1000;

/**
 * Hourly (crons.ts): deletes uploads older than an hour that no document uses.
 * These are files whose ingest was refused (wrong type, too large, rate limited)
 * or never called; the refusal can't delete them itself because it throws.
 */
export const cleanupOrphanUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ORPHAN_AGE_MS;
    const files = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .order("desc")
      .take(200);
    let deleted = 0;
    for (const file of files) {
      const used =
        (await ctx.db
          .query("documents")
          .withIndex("by_storageId", (q) => q.eq("storageId", file._id))
          .first()) ??
        (await ctx.db
          .query("generatedDocuments")
          .withIndex("by_storageId", (q) => q.eq("storageId", file._id))
          .first());
      if (!used) {
        await ctx.storage.delete(file._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
