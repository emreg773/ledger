import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { insertDemoOwner } from "./owners";
import { isLive, seedMockBank } from "./nessie";

// Demo reset: npm run reset (npx convex run admin:resetDemo).
// Test flag: npx convex run admin:resetDemo '{"withoutTreasuryPayment": true}'
// leaves out the Oct 2 IRS payment, so the CP14 proposes pay_bill.
// The one place that deletes events; the audit log is append-only otherwise.

export const resetDemo = internalMutation({
  args: { withoutTreasuryPayment: v.optional(v.boolean()) },
  handler: async (ctx, { withoutTreasuryPayment = false }) => {
    for (const owner of await ctx.db.query("owners").collect()) {
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
      await ctx.db.delete(ownerId);
    }

    const ownerId = await insertDemoOwner(ctx);
    if (isLive()) {
      // fetch() needs an action; the owner's account ids land a few seconds later.
      await ctx.scheduler.runAfter(0, internal.nessie.seedLiveBank, { ownerId, withoutTreasuryPayment });
    } else {
      await seedMockBank(ctx, ownerId, { withoutTreasuryPayment });
    }
    return { ownerId };
  },
});
