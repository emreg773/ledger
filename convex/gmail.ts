import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwner, requireOwnerOf, viewerOwner } from "./access";
import { logEvent } from "./events";
import { SUPPORTED_TYPES } from "./extraction";
import { backToApp, consentUrl, exchangeCode, refreshAccessToken } from "./googleOAuth";
import { classify } from "./emailRules";
import { emailCategory } from "./schema";

// Gmail, read-only: Ledger looks through the owner's recent email so letters
// from agencies don't get lost.
//
// - Gmail's own filters go first: spam, trash, Promotions, Social and Forums
//   are never fetched.
// - The rest is sorted by rules (classify, no AI call): government senders,
//   emails pretending to be one, likely business mail, everything else.
// - A government email's PDF or photo attachment goes through the normal
//   intake, so Ledger reads it like an uploaded letter.
// - Only headers, the snippet and attachment metadata are stored, not bodies.
//
// gmail.readonly is a restricted scope: an unverified app gets Google's warning
// screen and a 100-user cap. Same OAuth flow as Google Calendar (googleOAuth.ts).
//
// Google Cloud setup: the Gmail API enabled, the gmail.readonly scope under
// Data Access, and https://<deployment>.convex.site/gmail/callback as a
// redirect URI on the web client.

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
// Gmail search: the last 30 days, without what Gmail already files away.
const QUERY = "newer_than:30d -in:spam -in:trash -category:promotions -category:social -category:forums";
const MAX_FETCH = 50;
const MAX_AUTO_READ = 3; // attachments read per sync, to keep Claude costs bounded
const MAX_BYTES = 10 * 1024 * 1024;

// ---------- For the UI ----------

export const status = query({
  args: {},
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return null;
    const c = await connectionOf(ctx, owner._id);
    if (!c) return { connected: false as const };
    return { connected: true as const, emailAddress: c.emailAddress, lastSyncedAt: c.lastSyncedAt, error: c.error };
  },
});

export type InboxEmail = Doc<"gmailMessages"> & {
  /** The case Ledger opened from the attachment, for "Open in Ledger". */
  caseId?: Id<"cases">;
  documentStatus?: Doc<"documents">["status"];
};

/** The sorted inbox, newest first; the UI groups it by category. */
export const inbox = query({
  args: {},
  handler: async (ctx): Promise<InboxEmail[]> => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    const rows = await ctx.db
      .query("gmailMessages")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .order("desc")
      .take(100);
    return await Promise.all(
      rows.map(async (m) => {
        const doc = m.documentId ? await ctx.db.get(m.documentId) : null;
        return { ...m, caseId: doc?.caseId, documentStatus: doc?.status };
      }),
    );
  },
});

export const startConnect = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    return await consentUrl(ctx, owner, "gmail", SCOPE);
  },
});

export const syncNow = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    if (await connectionOf(ctx, owner._id)) {
      await ctx.scheduler.runAfter(0, internal.gmail.sync, { ownerId: owner._id });
    }
    return null;
  },
});

/** Has Ledger read an email's attachment (any category), like an upload. */
export const readAttachment = mutation({
  args: { messageId: v.id("gmailMessages") },
  handler: async (ctx, { messageId }) => {
    const m = await requireOwnerOf(ctx, await ctx.db.get(messageId));
    if (m.documentId || !readable(m)) return null;
    await ctx.scheduler.runAfter(0, internal.gmail.ingestAttachment, { messageId });
    return null;
  },
});

/** Removes the connection and the sorted emails, and revokes Google's grant. */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    const c = await connectionOf(ctx, owner._id);
    if (!c) return null;
    await ctx.scheduler.runAfter(0, internal.googleOAuth.revoke, { refreshToken: c.refreshToken });
    await ctx.db.delete(c._id);
    await clearMessages(ctx, owner._id);
    await logEvent(ctx, { ownerId: owner._id, type: "gmail_disconnected", summary: "Gmail disconnected" });
    return null;
  },
});

// ---------- OAuth callback ----------

/** GET /gmail/callback?code&state from Google. Always ends on the app's home screen. */
export const callback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!code) return backToApp("gmail", { failed: "cancelled" });
  if (!state) return backToApp("gmail", { failed: "state" });
  const ownerId = await ctx.runMutation(internal.googleOAuth.consumeState, { state, purpose: "gmail" });
  if (!ownerId) return backToApp("gmail", { failed: "state" });

  const tokens = await exchangeCode(code, "gmail");
  if (!tokens) return backToApp("gmail", { failed: "token" });
  // Google shows Gmail access as a checkbox, unticked by default.
  if (!tokens.scopes.includes(SCOPE)) return backToApp("gmail", { failed: "scope" });

  const profile = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  const emailAddress = profile.ok ? ((await profile.json()) as { emailAddress?: string }).emailAddress : undefined;
  const saved = await ctx.runMutation(internal.gmail.saveConnection, {
    ownerId,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
    emailAddress,
  });
  if (!saved) return backToApp("gmail", { failed: "no_refresh_token" });
  await ctx.scheduler.runAfter(0, internal.gmail.sync, { ownerId });
  return backToApp("gmail", "connected");
});

export const saveConnection = internalMutation({
  args: {
    ownerId: v.id("owners"),
    refreshToken: v.optional(v.string()),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
    emailAddress: v.optional(v.string()),
  },
  handler: async (ctx, { ownerId, refreshToken, ...fields }) => {
    const existing = await connectionOf(ctx, ownerId);
    const token = refreshToken ?? existing?.refreshToken;
    if (!token) return false;
    const patch = { ...fields, refreshToken: token, error: undefined };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("gmailConnections", { ownerId, connectedAt: Date.now(), ...patch });
    await logEvent(ctx, { ownerId, type: "gmail_connected", summary: "Gmail connected (read-only)" });
    return true;
  },
});

// ---------- Sync ----------

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

/** "IRS <no-reply@irs.gov>" → name, email, domain. */
function parseFrom(from: string) {
  const email = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const name = from.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || email;
  return { fromName: name.slice(0, 120), fromEmail: email, fromDomain: email.split("@")[1] ?? "" };
}

function attachmentsOf(part: GmailPart | undefined): Doc<"gmailMessages">["attachments"] {
  if (!part) return [];
  const own =
    part.filename && part.body?.attachmentId
      ? [{ filename: part.filename.slice(0, 200), mimeType: part.mimeType ?? "", size: part.body.size ?? 0, attachmentId: part.body.attachmentId }]
      : [];
  return [...own, ...(part.parts ?? []).flatMap(attachmentsOf)];
}

/** The first attachment Ledger can read: a PDF or photo under 10 MB. */
function readable(m: Pick<Doc<"gmailMessages">, "attachments">) {
  return m.attachments.find((a) => SUPPORTED_TYPES.includes(a.mimeType) && a.size <= MAX_BYTES);
}

async function accessTokenFor(ctx: ActionCtx, ownerId: Id<"owners">) {
  const c: Doc<"gmailConnections"> | null = await ctx.runQuery(internal.gmail.getConnection, { ownerId });
  if (!c) return null;
  if (c.accessToken && c.accessTokenExpiresAt && c.accessTokenExpiresAt > Date.now() + 60_000) return c.accessToken;
  const fresh = await refreshAccessToken(c.refreshToken);
  if ("error" in fresh) {
    await ctx.runMutation(internal.gmail.saveSync, { ownerId, error: fresh.error });
    return null;
  }
  await ctx.runMutation(internal.gmail.saveAccessToken, { ownerId, accessToken: fresh.accessToken, accessTokenExpiresAt: fresh.expiresAt });
  return fresh.accessToken;
}

/** Fetches emails Ledger hasn't seen yet, sorts them, and reads government attachments. */
export const sync = internalAction({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => {
    const token = await accessTokenFor(ctx, ownerId);
    if (!token) return null;
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    const list = await fetch(`${API}/messages?${new URLSearchParams({ q: QUERY, maxResults: String(MAX_FETCH) })}`, auth);
    if (!list.ok) {
      await ctx.runMutation(internal.gmail.saveSync, {
        ownerId,
        error: list.status === 401 || list.status === 403 ? "revoked" : `sync failed (${list.status})`,
      });
      return null;
    }
    const ids = ((await list.json()) as { messages?: { id: string }[] }).messages?.map((m) => m.id) ?? [];
    const known = new Set<string>(await ctx.runQuery(internal.gmail.knownIds, { ownerId, gmailIds: ids }));

    const fresh: Omit<Doc<"gmailMessages">, "_id" | "_creationTime" | "ownerId">[] = [];
    for (const id of ids.filter((i) => !known.has(i))) {
      const res = await fetch(`${API}/messages/${id}?format=full`, auth);
      if (!res.ok) continue;
      const m = (await res.json()) as { id: string; threadId: string; snippet?: string; internalDate?: string; payload?: GmailPart };
      const header = (name: string) =>
        m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
      const from = parseFrom(header("from"));
      const subject = header("subject").slice(0, 300);
      const snippet = (m.snippet ?? "").slice(0, 300);
      const { category, reasons } = classify({
        ...from,
        subject,
        snippet,
        newsletter: header("list-unsubscribe") !== "" || header("list-id") !== "",
      });
      fresh.push({
        gmailId: m.id,
        threadId: m.threadId,
        ...from,
        subject,
        snippet,
        receivedAt: Number(m.internalDate ?? Date.now()),
        category,
        reasons,
        attachments: attachmentsOf(m.payload),
      });
    }
    await ctx.runMutation(internal.gmail.saveSync, { ownerId, messages: fresh });
    return null;
  },
});

/** Every 15 minutes (crons.ts): re-syncs every connected inbox, a few seconds apart. */
export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const ownerIds = await ctx.runQuery(internal.gmail.connectedOwners, {});
    for (const [i, ownerId] of ownerIds.entries()) {
      await ctx.scheduler.runAfter(i * 2000, internal.gmail.sync, { ownerId });
    }
    return null;
  },
});

/** Downloads an email's attachment and sends it through the normal intake. */
export const ingestAttachment = internalAction({
  args: { messageId: v.id("gmailMessages") },
  handler: async (ctx, { messageId }) => {
    const m = await ctx.runQuery(internal.gmail.getMessage, { messageId });
    const attachment = m && !m.documentId ? readable(m) : undefined;
    if (!m || !attachment) return null;
    const token = await accessTokenFor(ctx, m.ownerId);
    if (!token) return null;
    const res = await fetch(`${API}/messages/${m.gmailId}/attachments/${attachment.attachmentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data: string };
    const bytes = Uint8Array.from(atob(data.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const storageId = await ctx.storage.store(new Blob([bytes], { type: attachment.mimeType }));
    try {
      const documentId = await ctx.runMutation(internal.intake.ingestDocument, {
        ownerId: m.ownerId,
        storageId,
        mimeType: attachment.mimeType,
        source: "gmail",
        sourceRef: `${m.gmailId}/${attachment.attachmentId}`,
      });
      await ctx.runMutation(internal.gmail.linkDocument, { messageId, documentId });
    } catch (e) {
      // Over the daily agent cap, say: the file goes in the hourly cleanup.
      console.warn("Gmail attachment not ingested", e);
    }
    return null;
  },
});

export const getConnection = internalQuery({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => await connectionOf(ctx, ownerId),
});

export const getMessage = internalQuery({
  args: { messageId: v.id("gmailMessages") },
  handler: async (ctx, { messageId }) => await ctx.db.get(messageId),
});

export const connectedOwners = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("gmailConnections").collect()).filter((c) => !c.error).map((c) => c.ownerId),
});

export const knownIds = internalQuery({
  args: { ownerId: v.id("owners"), gmailIds: v.array(v.string()) },
  handler: async (ctx, { ownerId, gmailIds }) => {
    const known: string[] = [];
    for (const gmailId of gmailIds) {
      const row = await ctx.db
        .query("gmailMessages")
        .withIndex("by_owner_and_gmail_id", (q) => q.eq("ownerId", ownerId).eq("gmailId", gmailId))
        .first();
      if (row) known.push(gmailId);
    }
    return known;
  },
});

export const saveAccessToken = internalMutation({
  args: { ownerId: v.id("owners"), accessToken: v.string(), accessTokenExpiresAt: v.number() },
  handler: async (ctx, { ownerId, ...fields }) => {
    const c = await connectionOf(ctx, ownerId);
    if (c) await ctx.db.patch(c._id, fields);
  },
});

const messageFields = v.object({
  gmailId: v.string(),
  threadId: v.string(),
  fromName: v.string(),
  fromEmail: v.string(),
  fromDomain: v.string(),
  subject: v.string(),
  snippet: v.string(),
  receivedAt: v.number(),
  category: emailCategory,
  reasons: v.array(v.string()),
  attachments: v.array(
    v.object({ filename: v.string(), mimeType: v.string(), size: v.number(), attachmentId: v.string() }),
  ),
});

/**
 * Saves newly sorted emails (or the sync error), then: reads up to 3
 * government attachments, and notifies about government emails without one
 * (those with one notify when Ledger has read them) and about suspicious ones.
 */
export const saveSync = internalMutation({
  args: { ownerId: v.id("owners"), messages: v.optional(v.array(messageFields)), error: v.optional(v.string()) },
  handler: async (ctx, { ownerId, messages, error }) => {
    const c = await connectionOf(ctx, ownerId);
    if (!c) return; // disconnected while the sync ran
    if (error) {
      await ctx.db.patch(c._id, { error });
      if (error === "revoked") await clearMessages(ctx, ownerId);
      return;
    }
    // The first sync looks back 30 days; only newer mail is "new" enough to notify about.
    const firstSync = c.lastSyncedAt === undefined;
    let autoRead = 0;
    for (const m of messages ?? []) {
      const messageId = await ctx.db.insert("gmailMessages", { ownerId, ...m });
      const isRecent = !firstSync || m.receivedAt > Date.now() - 2 * 86_400_000;
      if (m.category === "government" && readable(m) && autoRead < MAX_AUTO_READ) {
        autoRead++;
        await ctx.scheduler.runAfter(0, internal.gmail.ingestAttachment, { messageId });
      } else if ((m.category === "government" || m.category === "suspicious") && isRecent) {
        await ctx.runMutation(internal.push.notifyEmail, {
          ownerId,
          kind: m.category === "government" ? "email_government" : "email_suspicious",
          fromDomain: m.fromDomain,
        });
      }
    }
    if (messages && messages.length > 0) {
      const counts = messages.reduce<Record<string, number>>((n, m) => ({ ...n, [m.category]: (n[m.category] ?? 0) + 1 }), {});
      await logEvent(ctx, {
        ownerId,
        type: "gmail_synced",
        summary: `Sorted ${messages.length} new emails: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}`,
      });
    }
    await ctx.db.patch(c._id, { lastSyncedAt: Date.now(), error: undefined });
  },
});

export const linkDocument = internalMutation({
  args: { messageId: v.id("gmailMessages"), documentId: v.id("documents") },
  handler: async (ctx, { messageId, documentId }) => {
    if (await ctx.db.get(messageId)) await ctx.db.patch(messageId, { documentId });
  },
});

async function connectionOf(ctx: QueryCtx | MutationCtx, ownerId: Id<"owners">) {
  return await ctx.db
    .query("gmailConnections")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .unique();
}

export async function clearMessages(ctx: MutationCtx, ownerId: Id<"owners">) {
  const rows = await ctx.db
    .query("gmailMessages")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const r of rows) await ctx.db.delete(r._id);
}
