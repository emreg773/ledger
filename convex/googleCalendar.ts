import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwner, viewerOwner } from "./access";
import { logEvent } from "./events";
import { backToApp, consentUrl, exchangeCode, refreshAccessToken } from "./googleOAuth";
import { isBusinessEvent } from "./calendarRules";

// Google Calendar, read-only, so the home screen's calendar shows the owner's
// own events next to Ledger's deadlines.
//
// A separate OAuth flow from sign-in (same Google client): calendar access is a
// sensitive scope, and an unverified app gets Google's warning screen for it.
// Keeping it out of sign-in means only owners who connect a calendar see it.
//
// startConnect → Google → GET /calendar/callback (this file) → tokens saved →
// sync. A cron re-syncs every hour; disconnect revokes the grant.
//
// Google Cloud setup: the Calendar API enabled, the calendar.readonly scope
// added under Data Access, and https://<deployment>.convex.site/calendar/callback
// as a redirect URI on the web client.

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const DAY_MS = 86_400_000;

// ---------- For the UI ----------

/** Whether the viewer has a calendar connected. Null when signed out. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return null;
    const c = await ctx.db
      .query("calendarConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .unique();
    if (!c) return { connected: false as const };
    return {
      connected: true as const,
      calendarName: c.calendarName,
      lastSyncedAt: c.lastSyncedAt,
      error: c.error,
    };
  },
});

/** The viewer's Google events between two ISO dates, inclusive. */
export const events = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    return await ctx.db
      .query("calendarEvents")
      .withIndex("by_owner_and_date", (q) => q.eq("ownerId", owner._id).gte("date", from).lte("date", to))
      .take(500);
  },
});

/** Returns the Google consent URL; the browser goes there. */
export const startConnect = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    return await consentUrl(ctx, owner, "calendar", SCOPE);
  },
});

export const syncNow = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    const c = await ctx.db
      .query("calendarConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .unique();
    if (c) await ctx.scheduler.runAfter(0, internal.googleCalendar.sync, { ownerId: owner._id });
    return null;
  },
});

/** Removes the connection and the copied events, and revokes Google's grant. */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    const c = await ctx.db
      .query("calendarConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .unique();
    if (!c) return null;
    await ctx.scheduler.runAfter(0, internal.googleOAuth.revoke, { refreshToken: c.refreshToken });
    await ctx.db.delete(c._id);
    await clearEvents(ctx, owner._id);
    await logEvent(ctx, { ownerId: owner._id, type: "calendar_disconnected", summary: "Google Calendar disconnected" });
    return null;
  },
});

// ---------- OAuth callback ----------

/** GET /calendar/callback?code&state from Google. Always ends on the app's home screen. */
export const callback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!code) return backToApp("calendar", { failed: "cancelled" }); // Cancel, or ?error=access_denied
  if (!state) return backToApp("calendar", { failed: "state" });
  const ownerId = await ctx.runMutation(internal.googleOAuth.consumeState, { state, purpose: "calendar" });
  if (!ownerId) return backToApp("calendar", { failed: "state" });

  const tokens = await exchangeCode(code, "calendar");
  if (!tokens) return backToApp("calendar", { failed: "token" });
  // Google shows calendar access as a checkbox, unticked by default.
  if (!tokens.scopes.includes(SCOPE)) {
    await ctx.runMutation(internal.googleCalendar.logFailure, { ownerId, reason: "scope" });
    return backToApp("calendar", { failed: "scope" });
  }

  const saved = await ctx.runMutation(internal.googleCalendar.saveConnection, {
    ownerId,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
  });
  if (!saved) return backToApp("calendar", { failed: "no_refresh_token" });
  await ctx.scheduler.runAfter(0, internal.googleCalendar.sync, { ownerId });
  return backToApp("calendar", "connected");
});

export const logFailure = internalMutation({
  args: { ownerId: v.id("owners"), reason: v.string() },
  handler: async (ctx, { ownerId, reason }) => {
    await logEvent(ctx, {
      ownerId,
      type: "calendar_connect_failed",
      summary:
        reason === "scope"
          ? "Google Calendar not connected: calendar access wasn't ticked on Google's screen"
          : `Google Calendar not connected (${reason})`,
    });
  },
});

/** False when Google sent no refresh token and there's no earlier one to keep. */
export const saveConnection = internalMutation({
  args: {
    ownerId: v.id("owners"),
    refreshToken: v.optional(v.string()),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
  },
  handler: async (ctx, { ownerId, refreshToken, accessToken, accessTokenExpiresAt }) => {
    const existing = await ctx.db
      .query("calendarConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique();
    const token = refreshToken ?? existing?.refreshToken;
    if (!token) return false;
    const fields = { refreshToken: token, accessToken, accessTokenExpiresAt, error: undefined };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("calendarConnections", { ownerId, connectedAt: Date.now(), ...fields });
    await logEvent(ctx, { ownerId, type: "calendar_connected", summary: "Google Calendar connected (read-only)" });
    return true;
  },
});

// ---------- Sync ----------

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
};

/** Copies about a month back and four months ahead of the primary calendar. */
export const sync = internalAction({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => {
    const c = await ctx.runQuery(internal.googleCalendar.getConnection, { ownerId });
    const owner = await ctx.runQuery(internal.owners.get, { ownerId });
    if (!c || !owner) return null;

    let accessToken = c.accessToken;
    if (!accessToken || !c.accessTokenExpiresAt || c.accessTokenExpiresAt < Date.now() + 60_000) {
      const fresh = await refreshAccessToken(c.refreshToken);
      if ("error" in fresh) {
        await ctx.runMutation(internal.googleCalendar.saveSync, { ownerId, error: fresh.error });
        return null;
      }
      accessToken = fresh.accessToken;
      await ctx.runMutation(internal.googleCalendar.saveAccessToken, {
        ownerId,
        accessToken,
        accessTokenExpiresAt: fresh.expiresAt,
      });
    }

    const now = Date.now();
    const events: {
      googleId: string;
      title: string;
      date: string;
      time?: string;
      htmlLink?: string;
      business: boolean;
    }[] = [];
    let calendarName: string | undefined;
    let pageToken: string | undefined;
    // At most 4 pages of 250: plenty for a small business owner's four months.
    for (let page = 0; page < 4; page++) {
      const params = new URLSearchParams({
        timeMin: new Date(now - 31 * DAY_MS).toISOString(),
        timeMax: new Date(now + 120 * DAY_MS).toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        await ctx.runMutation(internal.googleCalendar.saveSync, {
          ownerId,
          error: res.status === 401 || res.status === 403 ? "revoked" : `sync failed (${res.status})`,
        });
        return null;
      }
      const data = (await res.json()) as { summary?: string; items?: GoogleEvent[]; nextPageToken?: string };
      calendarName ??= data.summary;
      for (const e of data.items ?? []) {
        if (e.status === "cancelled" || !e.start) continue;
        const dateTime = e.start.dateTime; // e.g. 2026-11-02T09:30:00-07:00, in the calendar's zone
        const date = e.start.date ?? dateTime?.slice(0, 10);
        if (!date) continue;
        const title = (e.summary ?? "").slice(0, 200);
        events.push({
          googleId: e.id,
          title,
          business: isBusinessEvent(title, owner.businessName),
          date,
          time: dateTime ? dateTime.slice(11, 16) : undefined,
          htmlLink: e.htmlLink,
        });
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    await ctx.runMutation(internal.googleCalendar.saveSync, { ownerId, events, calendarName });
    return null;
  },
});

/** Hourly (crons.ts): re-syncs every connected calendar, a few seconds apart. */
export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const ownerIds = await ctx.runQuery(internal.googleCalendar.connectedOwners, {});
    for (const [i, ownerId] of ownerIds.entries()) {
      await ctx.scheduler.runAfter(i * 2000, internal.googleCalendar.sync, { ownerId });
    }
    return null;
  },
});

export const getConnection = internalQuery({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) =>
    await ctx.db
      .query("calendarConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique(),
});

export const connectedOwners = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("calendarConnections").collect()).filter((c) => !c.error).map((c) => c.ownerId),
});

export const saveAccessToken = internalMutation({
  args: { ownerId: v.id("owners"), accessToken: v.string(), accessTokenExpiresAt: v.number() },
  handler: async (ctx, { ownerId, ...fields }) => {
    const c = await ctx.db
      .query("calendarConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique();
    if (c) await ctx.db.patch(c._id, fields);
  },
});

/** Replaces the owner's copied events, or records why the sync failed. */
export const saveSync = internalMutation({
  args: {
    ownerId: v.id("owners"),
    events: v.optional(
      v.array(
        v.object({
          googleId: v.string(),
          title: v.string(),
          date: v.string(),
          time: v.optional(v.string()),
          htmlLink: v.optional(v.string()),
          business: v.boolean(),
        }),
      ),
    ),
    calendarName: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { ownerId, events, calendarName, error }) => {
    const c = await ctx.db
      .query("calendarConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique();
    if (!c) return; // disconnected while the sync ran
    if (error) {
      await ctx.db.patch(c._id, { error });
      if (error === "revoked") await clearEvents(ctx, ownerId);
      return;
    }
    await clearEvents(ctx, ownerId);
    for (const e of events ?? []) await ctx.db.insert("calendarEvents", { ownerId, ...e });
    await ctx.db.patch(c._id, { lastSyncedAt: Date.now(), error: undefined, calendarName: calendarName ?? c.calendarName });
  },
});

async function clearEvents(ctx: MutationCtx, ownerId: Id<"owners">) {
  const rows = await ctx.db
    .query("calendarEvents")
    .withIndex("by_owner_and_date", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const r of rows) await ctx.db.delete(r._id);
}
