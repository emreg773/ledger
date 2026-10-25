import { v } from "convex/values";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { viewerOwner } from "./access";
import { caseNotices } from "./documents";
import type { Doc } from "./_generated/dataModel";

// Case reads for the UI. Only the signed-in owner's cases; anything else is null.

export const get = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const owner = await viewerOwner(ctx);
    const c = await ctx.db.get(caseId);
    return owner && c?.ownerId === owner._id ? c : null;
  },
});

/** The owner's cases, newest first. */
export const listForOwner = query({
  // TODO: ownerId is ignored; remove it once no client sends it.
  args: { ownerId: v.optional(v.id("owners")) },
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    const cases = await ctx.db
      .query("cases")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .order("desc")
      .take(50);
    // hasActions: Ledger proposed something for this case. Its to-dos then stand
    // in for its deadline on the calendar, and it leaves the calendar once
    // they're handled.
    return await Promise.all(
      cases.map(async (c) => ({
        ...c,
        hasActions:
          (await ctx.db
            .query("actions")
            .withIndex("by_case", (q) => q.eq("caseId", c._id))
            .first()) !== null,
      })),
    );
  },
});

export const getInternal = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const owner = await ctx.db.get(c.ownerId);
    const actions = await ctx.db
      .query("actions")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect();
    return { case: c, owner, actions };
  },
});

export const setPlaybook = internalMutation({
  args: { caseId: v.id("cases"), docType: v.string() },
  handler: async (ctx, { caseId, docType }) => {
    await ctx.db.patch(caseId, { playbookDocType: docType });
  },
});

export type TimelineItem = {
  at: number; // ms, for ordering
  date: string; // ISO date shown to the owner
  kind: "document" | "bank_payment" | "action" | "event";
  title: string; // English; the UI translates by kind
  detail?: string;
  status?: string;
  docType?: string;
  noticeCode?: string;
  amount?: number;
  dueDate?: string;
  payee?: string;
  actionType?: string;
  eventType?: string;
  documentId?: string;
  actionId?: string;
};

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Events worth showing in the history; the rest stay in the activity feed.
const TIMELINE_EVENTS = new Set(["case_opened", "case_linked"]);

async function buildTimeline(ctx: QueryCtx, c: Doc<"cases">): Promise<TimelineItem[]> {
  const items: TimelineItem[] = [];

  for (const { doc, extraction: x } of await caseNotices(ctx, c._id)) {
    const date = x.noticeDate ?? isoDay(doc.receivedAt);
    const facts = [
      x.amountDue !== undefined ? usd(x.amountDue) : undefined,
      x.deadline ? `due ${x.deadline}` : undefined,
    ].filter(Boolean);
    items.push({
      at: x.noticeDate ? dayMs(x.noticeDate) : doc.receivedAt,
      date,
      kind: "document",
      title: `${x.noticeCode ?? x.docType} notice`,
      detail: facts.join(", ") || undefined,
      docType: x.docType,
      noticeCode: x.noticeCode,
      amount: x.amountDue,
      dueDate: x.deadline,
      documentId: doc._id,
    });
  }

  for (const m of c.bankCheck?.matches ?? []) {
    items.push({
      at: dayMs(m.date),
      date: m.date,
      kind: "bank_payment",
      title: `Paid ${usd(m.amount)} to ${m.payee}`,
      detail: m.memo,
      amount: m.amount,
      payee: m.payee,
    });
  }

  const actions = await ctx.db
    .query("actions")
    .withIndex("by_case", (q) => q.eq("caseId", c._id))
    .collect();
  for (const a of actions) {
    const at = a.executedAt ?? a.decidedAt ?? a.createdAt;
    items.push({
      at,
      date: isoDay(at),
      kind: "action",
      title: a.summary,
      status: a.status,
      actionType: a.type,
      actionId: a._id,
    });
  }

  const events = await ctx.db
    .query("events")
    .withIndex("by_case", (q) => q.eq("caseId", c._id))
    .collect();
  for (const e of events) {
    if (!TIMELINE_EVENTS.has(e.type)) continue;
    items.push({ at: e.at, date: isoDay(e.at), kind: "event", title: e.summary, eventType: e.type });
  }

  return items.sort((a, b) => a.at - b.at);
}

/** The case's documents, bank matches, actions and key events, oldest first. Null if not the viewer's. */
export const timeline = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }): Promise<TimelineItem[] | null> => {
    const owner = await viewerOwner(ctx);
    const c = await ctx.db.get(caseId);
    if (!owner || !c || c.ownerId !== owner._id) return null;
    return await buildTimeline(ctx, c);
  },
});

/** For the agent's get_case_history tool: the timeline and how many distinct notices the case has. */
export const historyInternal = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    return { case: c, items: await buildTimeline(ctx, c), notices: (await caseNotices(ctx, caseId)).length };
  },
});

/** One line per item, for the model. Dates are ISO, amounts as printed. */
export function timelineText(items: TimelineItem[]): string {
  return items
    .map((i) => {
      const status =
        i.kind === "action"
          ? i.status === "executed"
            ? i.actionType === "owner_task"
              ? " (owner marked it done)"
              : " (done)"
            : ` (${i.status})`
          : "";
      return `${i.date} [${i.kind}] ${i.title}${status}${i.detail ? `: ${i.detail}` : ""}`;
    })
    .join("\n");
}
