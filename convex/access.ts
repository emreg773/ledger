import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// Ownership checks (Step 3 brief, Section 4). Every public function gets the
// owner from the session, never from its arguments.

/** The signed-in user's owner, or null when signed out or not onboarded. For queries. */
export async function viewerOwner(ctx: QueryCtx | MutationCtx): Promise<Doc<"owners"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db
    .query("owners")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** The signed-in user's owner. Throws not_signed_in or not_onboarded. For mutations. */
export async function requireOwner(ctx: QueryCtx | MutationCtx): Promise<Doc<"owners">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError({ code: "not_signed_in", message: "Not signed in" });
  const owner = await ctx.db
    .query("owners")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (!owner) throw new ConvexError({ code: "not_onboarded", message: "Not onboarded" });
  return owner;
}

/**
 * The row, if it belongs to the signed-in owner. Missing rows and other owners'
 * rows both throw "Not found", so ids can't be probed.
 */
export async function requireOwnerOf<T extends { ownerId: Id<"owners"> }>(
  ctx: QueryCtx | MutationCtx,
  row: T | null,
): Promise<T> {
  const owner = await requireOwner(ctx);
  if (!row || row.ownerId !== owner._id) throw new ConvexError({ code: "not_found", message: "Not found" });
  return row;
}
