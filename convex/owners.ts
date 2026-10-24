import { ConvexError, v } from "convex/values";
import { createThread } from "@convex-dev/agent";
import { getAuthUserId } from "@convex-dev/auth/server";
import { components } from "./_generated/api";
import { internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { logEvent } from "./events";
import { requireOwner, viewerOwner } from "./access";
import { deleteAuthUser, deleteOwner, deleteOwnerData } from "./admin";
import { seedBankFor } from "./nessie";
import { LANGUAGES } from "./shared";

// One owner per Google account (Step 3 brief, Section 5). The owner always comes
// from the session; no public function takes an ownerId.

/** The signed-in user's owner, or null when signed out or not onboarded. */
export const me = query({
  args: {},
  handler: async (ctx) => await viewerOwner(ctx),
});

// TODO(step3): delete once Track B's chat uses owners.me. Same result.
export const getDemoOwner = query({
  args: {},
  handler: async (ctx) => await viewerOwner(ctx),
});

export const get = internalQuery({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => await ctx.db.get(ownerId),
});

const MAX_FIELD = 80;

function cleanField(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FIELD) {
    throw new ConvexError({ code: "invalid_input", field, message: `${field} must be 1 to ${MAX_FIELD} characters` });
  }
  return trimmed;
}

function checkLanguage(language: string): string {
  if (!LANGUAGES.some((l) => l.code === language)) {
    throw new ConvexError({ code: "invalid_input", field: "preferredLanguage", message: `Unsupported language: ${language}` });
  }
  return language;
}

/** Creates the signed-in user's owner, thread and sandbox bank. Run again, it updates the profile. */
export const completeOnboarding = mutation({
  args: {
    name: v.string(),
    businessName: v.string(),
    preferredLanguage: v.string(),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"owners">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ code: "not_signed_in", message: "Not signed in" });
    const profile = {
      name: cleanField(args.name, "name"),
      businessName: cleanField(args.businessName, "businessName"),
      preferredLanguage: checkLanguage(args.preferredLanguage),
      // The playbooks and contacts cover Alameda County only, so that's the default.
      city: args.city === undefined ? "Oakland" : cleanField(args.city, "city"),
    };

    const existing = await viewerOwner(ctx);
    if (existing) {
      await ctx.db.patch(existing._id, profile);
      await logEvent(ctx, { ownerId: existing._id, type: "owner_onboarded", summary: "Owner updated their profile" });
      return existing._id;
    }

    const user = await ctx.db.get(userId);
    // Insert first so the thread can be tied to the owner's id.
    const ownerId = await ctx.db.insert("owners", {
      userId,
      email: user?.email,
      ...profile,
      county: "Alameda",
      state: "CA",
      agentThreadId: "",
    });
    await ctx.db.patch(ownerId, { agentThreadId: await newThread(ctx, ownerId, profile.businessName) });
    await seedBankFor(ctx, ownerId);
    await logEvent(ctx, {
      ownerId,
      type: "owner_onboarded",
      summary: `Owner signed up: ${profile.businessName}, language ${profile.preferredLanguage}`,
    });
    return ownerId;
  },
});

async function newThread(ctx: MutationCtx, ownerId: Id<"owners">, title: string) {
  return await createThread(ctx, components.agent, { userId: ownerId, title });
}

export const setLanguage = mutation({
  // TODO(step3): ownerId is ignored and goes away once Track B's UI stops sending it.
  args: { language: v.string(), ownerId: v.optional(v.id("owners")) },
  handler: async (ctx, { language }) => {
    const owner = await requireOwner(ctx);
    checkLanguage(language);
    if (owner.preferredLanguage === language) return null;
    await ctx.db.patch(owner._id, { preferredLanguage: language });
    await logEvent(ctx, {
      ownerId: owner._id,
      type: "language_changed",
      summary: `Owner language changed from ${owner.preferredLanguage} to ${language}`,
    });
    return null;
  },
});

/** "Start over with demo data": a clean thread and a reseeded bank. Keeps the profile and push subscriptions. */
export const resetMyData = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    await deleteOwnerData(ctx, owner);
    await ctx.db.patch(owner._id, { agentThreadId: await newThread(ctx, owner._id, owner.businessName) });
    await seedBankFor(ctx, owner._id);
    await logEvent(ctx, { ownerId: owner._id, type: "data_reset", summary: "Owner started over with demo data" });
    return null;
  },
});

/** Deletes the owner, all their data, their push subscriptions and their Google sign-in. */
export const deleteMyAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    await deleteOwner(ctx, owner);
    if (owner.userId) await deleteAuthUser(ctx, owner.userId);
    return null;
  },
});
