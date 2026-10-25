import { v, type Infer } from "convex/values";
import { saveMessage } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { actionType } from "./schema";
import { logEvent } from "./events";
import { requireOwnerOf, viewerOwner } from "./access";
import { SYSTEM_NOTE_PREFIX } from "./shared";

// The action system (Step 2 brief, Track B, Section 3).
// The agent proposes; the server decides autonomy from the type, never the agent.

type ActionType = Infer<typeof actionType>;
type Autonomy = Doc<"actions">["autonomyLevel"];

const AUTONOMY: Record<ActionType, Autonomy> = {
  pay_bill: "one_tap",
  send_email: "one_tap",
  send_whatsapp: "one_tap", // Not used: no WhatsApp in Step 2+.
  create_document: "auto",
  add_calendar_event: "auto",
  schedule_followup: "auto",
  owner_task: "human_only",
};

/** pay_bill payload. owner_task payload: { instructions, checklist?, dueDate?, callScript?: { en, translated? }, phone? }. */
export type PayBillPayload = {
  amount: number;
  payee: string;
  accountLast4: string;
  memo?: string;
  dueDate?: string;
};

/** What a successful pay_bill stores in `result` (the shape of nessie.payBill's return). */
export type PayBillResult = {
  confirmationId: string;
  paidAt: number;
  amount: number;
  payee: string;
  accountLast4: string;
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** One readable English line per action, for event summaries. */
function describe(action: Pick<Doc<"actions">, "type" | "payload" | "summary">): string {
  if (action.type === "pay_bill") {
    const p = action.payload as PayBillPayload;
    return `paying ${usd(p.amount)} to ${p.payee}`;
  }
  return action.summary;
}

/** The action, if it belongs to the signed-in owner (Step 3: owner from the session). */
async function load(ctx: MutationCtx, actionId: Id<"actions">) {
  return await requireOwnerOf(ctx, await ctx.db.get(actionId));
}

/**
 * Once a case has nothing left to approve, reject or mark done, its "Action
 * needed" notifications leave the list (notifications.ts), so they shouldn't
 * keep the bell's unread badge up either.
 */
async function readFinishedCaseNotices(ctx: MutationCtx, action: Doc<"actions">) {
  const pending = await ctx.db
    .query("actions")
    .withIndex("by_case", (q) => q.eq("caseId", action.caseId))
    .filter((q) => q.eq(q.field("status"), "proposed"))
    .first();
  if (pending) return;
  const notices = await ctx.db
    .query("notifications")
    .withIndex("by_owner_and_category", (q) => q.eq("ownerId", action.ownerId).eq("category", "needs_action"))
    .filter((q) => q.and(q.eq(q.field("caseId"), action.caseId), q.eq(q.field("readAt"), undefined)))
    .collect();
  for (const n of notices) await ctx.db.patch(n._id, { readAt: Date.now() });
}

// ---------- Contract (shared with Track A) ----------

export const propose = internalMutation({
  args: {
    ownerId: v.id("owners"),
    caseId: v.id("cases"),
    type: actionType,
    summary: v.string(),
    payload: v.any(),
    threadId: v.optional(v.string()), // the conversation it's proposed in
  },
  handler: async (ctx, args): Promise<Id<"actions">> => {
    const autonomyLevel = AUTONOMY[args.type];
    const actionId = await ctx.db.insert("actions", {
      ...args,
      autonomyLevel,
      status: "proposed",
      createdAt: Date.now(),
    });
    await logEvent(ctx, {
      ownerId: args.ownerId,
      caseId: args.caseId,
      type: "action_proposed",
      summary: `Ledger proposed ${describe(args)} (${autonomyLevel})`,
      data: { actionId, type: args.type },
    });
    if (autonomyLevel === "auto") {
      await ctx.scheduler.runAfter(0, internal.actions.execute, { actionId });
    }
    return actionId;
  },
});

export const approve = mutation({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }) => {
    const action = await load(ctx, actionId);
    if (action.autonomyLevel !== "one_tap") {
      throw new Error(`Only one-tap actions can be approved; this one is ${action.autonomyLevel}.`);
    }
    // A double tap lands while the first is in flight ("approved"): ignore it.
    // Approving something already finished is a real error.
    if (action.status === "approved") return null;
    if (action.status !== "proposed") {
      throw new Error(`Only proposed actions can be approved; this one is ${action.status}.`);
    }

    await ctx.db.patch(actionId, { status: "approved", decidedAt: Date.now() });
    await logEvent(ctx, {
      ownerId: action.ownerId,
      caseId: action.caseId,
      type: "action_approved",
      summary: `Owner approved ${describe(action)}`,
      data: { actionId },
    });
    await readFinishedCaseNotices(ctx, action);
    await ctx.scheduler.runAfter(0, internal.actions.execute, { actionId });
    return null;
  },
});

export const reject = mutation({
  args: { actionId: v.id("actions"), reason: v.optional(v.string()) },
  handler: async (ctx, { actionId, reason }) => {
    const action = await load(ctx, actionId);
    if (action.status === "rejected") return null; // double tap
    if (action.status !== "proposed") {
      throw new Error(`Only proposed actions can be rejected; this one is ${action.status}.`);
    }
    await ctx.db.patch(actionId, {
      status: "rejected",
      decidedAt: Date.now(),
      result: reason ? { reason } : undefined,
    });
    await logEvent(ctx, {
      ownerId: action.ownerId,
      caseId: action.caseId,
      type: "action_rejected",
      summary: `Owner declined ${describe(action)}${reason ? `: ${reason}` : ""}`,
      data: { actionId, reason },
    });
    await readFinishedCaseNotices(ctx, action);
    await notifyAgent(ctx, action.ownerId, actionId);
    return null;
  },
});

export const markDone = mutation({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }) => {
    const action = await load(ctx, actionId);
    if (action.autonomyLevel !== "human_only") {
      throw new Error(`Only owner tasks can be marked done; this one is ${action.autonomyLevel}.`);
    }
    if (action.status === "executed") return null; // double tap
    if (action.status !== "proposed") {
      throw new Error(`Only proposed tasks can be marked done; this one is ${action.status}.`);
    }
    const now = Date.now();
    await ctx.db.patch(actionId, { status: "executed", decidedAt: now, executedAt: now });
    await logEvent(ctx, {
      ownerId: action.ownerId,
      caseId: action.caseId,
      type: "action_executed",
      summary: `Owner marked done: ${describe(action)}`,
      data: { actionId },
    });
    await readFinishedCaseNotices(ctx, action);
    await notifyAgent(ctx, action.ownerId, actionId);
    return null;
  },
});

/**
 * Undoes "Mark done" on an owner task: it's open again (and nudged again).
 * The agent gets a quiet note in the task's conversation, with no reply, so its
 * next answer knows the task is open.
 */
export const reopen = mutation({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }) => {
    const action = await load(ctx, actionId);
    if (action.type !== "owner_task") throw new Error("Only owner tasks can be reopened.");
    if (action.status === "proposed") return null; // double tap
    if (action.status !== "executed") {
      throw new Error(`Only tasks marked done can be reopened; this one is ${action.status}.`);
    }
    await ctx.db.patch(actionId, { status: "proposed", decidedAt: undefined, executedAt: undefined });
    await logEvent(ctx, {
      ownerId: action.ownerId,
      caseId: action.caseId,
      type: "action_reopened",
      summary: `Owner undid "done": ${describe(action)}`,
      data: { actionId },
    });
    const owner = await ctx.db.get(action.ownerId);
    const threadId = action.threadId ?? owner?.agentThreadId;
    if (threadId) {
      await saveMessage(ctx, components.agent, {
        threadId,
        userId: action.ownerId,
        prompt: `${SYSTEM_NOTE_PREFIX} The owner undid "mark done" on this task, so it's open again: "${action.summary}". No reply needed.`,
      });
    }
    return null;
  },
});

// Takes a string: the id comes from an `[action:<id>]` marker the model wrote,
// and a malformed one should render nothing rather than crash the chat.
export const get = query({
  args: { actionId: v.string() },
  handler: async (ctx, { actionId }) => {
    const owner = await viewerOwner(ctx);
    const id = ctx.db.normalizeId("actions", actionId);
    const action = owner && id ? await ctx.db.get(id) : null;
    return action?.ownerId === owner?._id ? action : null;
  },
});

export const listForCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const owner = await viewerOwner(ctx);
    const caseRow = await ctx.db.get(caseId);
    if (!owner || caseRow?.ownerId !== owner._id) return [];
    return await ctx.db
      .query("actions")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .order("desc")
      .collect();
  },
});

/** The viewer's actions still waiting on them (approve, reject or mark done), newest first. */
export const listOpenForOwner = query({
  args: {},
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    return await ctx.db
      .query("actions")
      .withIndex("by_owner_and_status", (q) => q.eq("ownerId", owner._id).eq("status", "proposed"))
      .order("desc")
      .take(50);
  },
});

export const execute = internalAction({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }) => {
    const action = await ctx.runQuery(internal.actions.getInternal, { actionId });
    if (!action) return null;
    const runnable =
      action.status === "approved" ||
      (action.autonomyLevel === "auto" && action.status === "proposed");
    if (!runnable) return null;

    try {
      let result: unknown;
      if (action.type === "pay_bill") {
        result = await ctx.runAction(internal.nessie.payBill, { actionId });
      } else {
        result = { note: "available in a later step" };
      }
      await ctx.runMutation(internal.actions.finish, { actionId, status: "executed", result });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.actions.finish, {
        actionId,
        status: "failed",
        result: { error },
      });
    }
    return null;
  },
});

// ---------- Internal helpers ----------

export const getInternal = internalQuery({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }) => await ctx.db.get(actionId),
});

/** Records execute's final status, logs it, and tells the agent. */
export const finish = internalMutation({
  args: {
    actionId: v.id("actions"),
    status: v.union(v.literal("executed"), v.literal("failed")),
    result: v.any(),
  },
  handler: async (ctx, { actionId, status, result }) => {
    // Internal: runs after execute, with no session, so no ownership check.
    const action = await ctx.db.get(actionId);
    if (!action) throw new Error(`Action not found: ${actionId}`);
    await ctx.db.patch(actionId, {
      status,
      result,
      executedAt: status === "executed" ? Date.now() : undefined,
    });
    let summary: string;
    if (status === "failed") {
      summary = `Failed ${describe(action)}: ${(result as { error: string }).error}`;
    } else if (action.type === "pay_bill") {
      const r = result as PayBillResult;
      summary = `Paid ${usd(r.amount)} to ${r.payee} from account ending ${r.accountLast4} (confirmation ${r.confirmationId})`;
    } else {
      summary = `Done: ${action.summary}`;
    }
    await logEvent(ctx, {
      ownerId: action.ownerId,
      caseId: action.caseId,
      type: status === "executed" ? "action_executed" : "action_failed",
      summary,
      data: { actionId, result },
    });
    await notifyAgent(ctx, action.ownerId, actionId);
  },
});

async function notifyAgent(ctx: MutationCtx, ownerId: Id<"owners">, actionId: Id<"actions">) {
  await ctx.runMutation(internal.agent.notifyActionResult, { ownerId, actionId });
}
