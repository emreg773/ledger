import { v } from "convex/values";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Shared Google OAuth plumbing for the read-only integrations (Google Calendar,
// Gmail). Separate from sign-in, which Convex Auth handles; same web client,
// so AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from the Convex env.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_TTL_MS = 10 * 60_000;

export type Purpose = "calendar" | "gmail";
export const purpose = v.union(v.literal("calendar"), v.literal("gmail"));

export const redirectUri = (p: Purpose) => `${process.env.CONVEX_SITE_URL}/${p}/callback`;

function clientCredentials() {
  const id = process.env.AUTH_GOOGLE_ID;
  const secret = process.env.AUTH_GOOGLE_SECRET;
  if (!id || !secret) throw new Error("AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET must be set");
  return { id, secret };
}

/** Creates a single-use state and returns Google's consent URL for one scope. */
export async function consentUrl(
  ctx: MutationCtx,
  owner: { _id: Id<"owners">; email?: string },
  p: Purpose,
  scope: string,
): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await ctx.db.insert("googleOAuthStates", { ownerId: owner._id, state, purpose: p, createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: clientCredentials().id,
    redirect_uri: redirectUri(p),
    response_type: "code",
    scope,
    access_type: "offline", // a refresh token, for background syncs
    prompt: "consent", // Google only returns a refresh token on consent
    include_granted_scopes: "true",
    state,
  });
  if (owner.email) params.set("login_hint", owner.email);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** The owner a callback's state belongs to, once; null if unknown, used, expired or for another purpose. */
export const consumeState = internalMutation({
  args: { state: v.string(), purpose },
  handler: async (ctx, { state, purpose: p }): Promise<Id<"owners"> | null> => {
    const row = await ctx.db
      .query("googleOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    return row.purpose === p && Date.now() - row.createdAt <= STATE_TTL_MS ? row.ownerId : null;
  },
});

export type Tokens = { accessToken: string; expiresAt: number; refreshToken?: string; scopes: string[] };

export async function exchangeCode(code: string, p: Purpose): Promise<Tokens | null> {
  const { id, secret } = clientCredentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(p),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    console.error(`Google token exchange failed (${p})`, res.status, await res.text());
    return null;
  }
  const t = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
  return {
    accessToken: t.access_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    refreshToken: t.refresh_token,
    scopes: t.scope?.split(" ") ?? [],
  };
}

/** A fresh access token, or why not: "revoked" when the owner removed access in Google. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number } | { error: string }> {
  const { id, secret } = clientCredentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { error: body.includes("invalid_grant") ? "revoked" : `refresh failed (${res.status})` };
  }
  const t = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
}

/** Tells Google to drop a grant. Best effort: the token is gone from our side anyway. */
export const revoke = internalAction({
  args: { refreshToken: v.string() },
  handler: async (_ctx, { refreshToken }) => {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
      method: "POST",
    }).catch(() => {});
    return null;
  },
});

/** Redirects back to the app's home screen with the outcome, logging failures. */
export function backToApp(p: Purpose, outcome: "connected" | { failed: string }) {
  const site = process.env.SITE_URL ?? "";
  if (outcome === "connected") return Response.redirect(`${site}/?${p}=connected`, 302);
  console.warn(`Google ${p} connect failed: ${outcome.failed}`);
  return Response.redirect(`${site}/?${p}=error&reason=${outcome.failed}`, 302);
}
