import { v } from "convex/values";
import { createThread } from "@convex-dev/agent";
import { components } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { logEvent } from "./events";

// No auth yet: one demo owner. The UI loads whichever owner was seeded first.

/** Run once: npx convex run owners:seedDemoOwner */
export const seedDemoOwner = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("owners").first();
    if (existing) return existing._id;

    // Insert first so the thread can be tied to the owner's id.
    const ownerId = await ctx.db.insert("owners", {
      name: "María López",
      businessName: "Taquería La Esquina",
      preferredLanguage: "es",
      city: "Oakland",
      county: "Alameda",
      state: "CA",
      agentThreadId: "",
    });
    const agentThreadId = await createThread(ctx, components.agent, {
      userId: ownerId,
      title: "Taquería La Esquina",
    });
    await ctx.db.patch(ownerId, { agentThreadId });
    await logEvent(ctx, { ownerId, type: "owner_created", summary: "Demo owner created" });
    return ownerId;
  },
});

export const getDemoOwner = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("owners").first(),
});

export const get = internalQuery({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => await ctx.db.get(ownerId),
});

export const setLanguage = mutation({
  args: { ownerId: v.id("owners"), language: v.string() },
  handler: async (ctx, { ownerId, language }) => {
    const owner = await ctx.db.get(ownerId);
    if (!owner || owner.preferredLanguage === language) return;
    await ctx.db.patch(ownerId, { preferredLanguage: language });
    await logEvent(ctx, {
      ownerId,
      type: "language_changed",
      summary: `Owner language changed from ${owner.preferredLanguage} to ${language}`,
    });
  },
});
