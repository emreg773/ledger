import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { logEvent } from "./events";
import { findAgency } from "./officialContacts";
import { caseNotices } from "./documents";
import { nowMs } from "./clock";

// Nessie bank (Capital One's sandbox API), live or mock, chosen by NESSIE_MODE.
//
// Live: the key goes in a ?key= query parameter (checked against the official
// SDK, github.com/nessieisreal/nessie-javascript-sdk). Past outgoing payments are
// **bills** (GET/POST /accounts/{id}/bills): a bill has a free-text payee, an
// amount, a payment date and a status, which is exactly "a payment to X on Y".
// Purchases need a merchant id and withdrawals have no payee, so bills fit best.
// The memo goes in the bill's nickname.
//
// Mock: the mockBankAccounts and mockBankBills tables, same shapes. The demo
// works with NESSIE_MODE=mock when Nessie is down.

export type BankPayment = { date: string; amount: number; payee: string; memo?: string };
export type BankSnapshot = { balance: number; accountLast4: string; payments: BankPayment[] };

export type PayBillResult = {
  confirmationId: string;
  paidAt: number;
  amount: number;
  payee: string;
  accountLast4: string;
};

export const isLive = () => process.env.NESSIE_MODE === "live";
// HTTPS only: plain http:// (as in the SDK) no longer connects.
const BASE_URL = () => process.env.NESSIE_BASE_URL ?? "https://api.nessieisreal.com";

// ---------- Demo data ----------

const DEMO_BALANCE = 4800;
const DEMO_ACCOUNT_NUMBER = "0000000000004417";
const TREASURY_PAYMENT: BankPayment = {
  date: "2026-10-02",
  amount: 1240.18,
  payee: "United States Treasury",
  memo: "Form 941 Q2 2026",
};
const SUPPLIER_PAYMENTS: BankPayment[] = [
  { date: "2026-09-05", amount: 612.4, payee: "Bay Area Produce Co.", memo: "Weekly produce" },
  { date: "2026-09-12", amount: 845.75, payee: "Oakland Meat Supply", memo: "Carnitas and asada" },
  { date: "2026-09-19", amount: 588.1, payee: "Bay Area Produce Co.", memo: "Weekly produce" },
  { date: "2026-09-26", amount: 214.3, payee: "PaperPro Restaurant Supply", memo: "To-go boxes and napkins" },
  { date: "2026-10-09", amount: 902.6, payee: "Oakland Meat Supply", memo: "Carnitas and asada" },
  { date: "2026-10-16", amount: 640.25, payee: "Bay Area Produce Co.", memo: "Weekly produce" },
];

function demoPayments(withoutTreasuryPayment: boolean): BankPayment[] {
  const all = withoutTreasuryPayment ? SUPPLIER_PAYMENTS : [...SUPPLIER_PAYMENTS, TREASURY_PAYMENT];
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Gives an owner a fresh sandbox bank with the demo history: mock rows in the same
 * transaction, or a new Nessie customer and account a few seconds later (live).
 * Called by onboarding, "Start over with demo data", and admin.resetDemo.
 */
export async function seedBankFor(
  ctx: MutationCtx,
  ownerId: Id<"owners">,
  opts: { withoutTreasuryPayment?: boolean } = {},
) {
  const withoutTreasuryPayment = opts.withoutTreasuryPayment ?? false;
  await deleteMockBank(ctx, ownerId);
  if (isLive()) {
    // fetch() needs an action. Until it saves the new ids, the owner has no
    // account and check_bank_history says so.
    await ctx.db.patch(ownerId, { nessieCustomerId: undefined, nessieAccountId: undefined, accountLast4: undefined });
    await ctx.scheduler.runAfter(0, internal.nessie.seedLiveBank, { ownerId, withoutTreasuryPayment });
  } else {
    await seedMockBank(ctx, ownerId, { withoutTreasuryPayment });
  }
}

/** Removes this owner's mock account and bills (other owners' are untouched). */
export async function deleteMockBank(ctx: MutationCtx, ownerId: Id<"owners">) {
  const accountId = `mock-account-${ownerId}`;
  const accounts = await ctx.db
    .query("mockBankAccounts")
    .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
    .collect();
  const bills = await ctx.db
    .query("mockBankBills")
    .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
    .collect();
  for (const row of [...accounts, ...bills]) await ctx.db.delete(row._id);
}

/** Mock mode: seeds the owner's account in the caller's transaction. */
async function seedMockBank(
  ctx: MutationCtx,
  ownerId: Id<"owners">,
  opts: { withoutTreasuryPayment: boolean },
) {
  const owner = await ctx.db.get(ownerId);
  const customerId = `mock-customer-${ownerId}`;
  const accountId = `mock-account-${ownerId}`;
  await ctx.db.insert("mockBankAccounts", {
    customerId,
    accountId,
    nickname: `${owner?.businessName ?? "Business"} checking`,
    balance: DEMO_BALANCE,
    accountNumber: DEMO_ACCOUNT_NUMBER,
  });
  for (const p of demoPayments(opts.withoutTreasuryPayment)) {
    await ctx.db.insert("mockBankBills", {
      accountId,
      payee: p.payee,
      nickname: p.memo ?? "",
      paymentDate: p.date,
      amount: p.amount,
      status: "completed",
    });
  }
  await ctx.db.patch(ownerId, {
    nessieCustomerId: customerId,
    nessieAccountId: accountId,
    accountLast4: DEMO_ACCOUNT_NUMBER.slice(-4),
  });
}

/** Live mode: creates a fresh Nessie customer, account and bill history. Scheduled by seedBankFor. */
export const seedLiveBank = internalAction({
  args: { ownerId: v.id("owners"), withoutTreasuryPayment: v.boolean() },
  handler: async (ctx, { ownerId, withoutTreasuryPayment }) => {
    const owner = await ctx.runQuery(internal.owners.get, { ownerId });
    if (!owner) return; // deleted before the seed ran
    const [firstName, ...rest] = owner.name.split(" ");
    const customer = await nessieFetch<{ objectCreated: { _id: string } }>("POST", "/customers", {
      first_name: firstName || "Owner",
      last_name: rest.join(" ") || "Ledger",
      address: {
        street_number: "1200",
        street_name: "Ejemplo Ave",
        city: "Oakland",
        state: "CA",
        zip: "94601",
      },
    });
    const customerId = customer.objectCreated._id;
    const account = await nessieFetch<{ objectCreated: { _id: string } }>(
      "POST",
      `/customers/${customerId}/accounts`,
      {
        type: "Checking",
        nickname: `${owner.businessName} checking`,
        rewards: 0,
        balance: DEMO_BALANCE,
        account_number: DEMO_ACCOUNT_NUMBER,
      },
    );
    const accountId = account.objectCreated._id;
    for (const p of demoPayments(withoutTreasuryPayment)) {
      await createLiveBill(accountId, p);
    }
    await ctx.runMutation(internal.nessie.saveOwnerAccount, {
      ownerId,
      nessieCustomerId: customerId,
      nessieAccountId: accountId,
      accountLast4: DEMO_ACCOUNT_NUMBER.slice(-4),
    });
    await ctx.runMutation(internal.events.log, {
      ownerId,
      type: "bank_seeded",
      summary: `Seeded Nessie (live) account ending ${DEMO_ACCOUNT_NUMBER.slice(-4)}`,
    });
  },
});

export const saveOwnerAccount = internalMutation({
  args: {
    ownerId: v.id("owners"),
    nessieCustomerId: v.string(),
    nessieAccountId: v.string(),
    accountLast4: v.string(),
  },
  handler: async (ctx, { ownerId, ...ids }) => {
    if (await ctx.db.get(ownerId)) await ctx.db.patch(ownerId, ids);
  },
});

// ---------- Live API ----------

async function nessieFetch<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const key = process.env.NESSIE_API_KEY;
  if (!key) throw new Error("NESSIE_API_KEY is not set (or set NESSIE_MODE=mock)");
  const res = await fetch(`${BASE_URL()}${path}?key=${encodeURIComponent(key)}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Nessie ${method} ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

type LiveBill = {
  _id: string;
  status: string;
  payee: string;
  nickname?: string;
  payment_date?: string;
  creation_date?: string;
  payment_amount: number;
};

async function createLiveBill(accountId: string, p: BankPayment): Promise<string> {
  // Community reports say GET /bills can fail unless both dates are sent.
  const created = await nessieFetch<{ objectCreated: { _id: string } }>(
    "POST",
    `/accounts/${accountId}/bills`,
    {
      status: "completed",
      payee: p.payee,
      nickname: p.memo ?? "",
      payment_date: p.date,
      recurring_date: 1,
      payment_amount: p.amount,
    },
  );
  return created.objectCreated._id;
}

// ---------- One interface for both modes ----------

export const mockSnapshot = internalQuery({
  args: { accountId: v.string() },
  handler: async (ctx, { accountId }): Promise<BankSnapshot | null> => {
    const account = await ctx.db
      .query("mockBankAccounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .unique();
    if (!account) return null;
    const bills = await ctx.db
      .query("mockBankBills")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .collect();
    return {
      balance: account.balance,
      accountLast4: account.accountNumber.slice(-4),
      payments: bills
        .filter((b) => b.status === "completed")
        .map((b) => ({ date: b.paymentDate, amount: b.amount, payee: b.payee, memo: b.nickname || undefined })),
    };
  },
});

export const mockPay = internalMutation({
  args: { accountId: v.string(), payment: v.object({ date: v.string(), amount: v.number(), payee: v.string(), memo: v.optional(v.string()) }) },
  handler: async (ctx, { accountId, payment }) => {
    const account = await ctx.db
      .query("mockBankAccounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .unique();
    if (!account) throw new Error(`Mock bank account not found: ${accountId}`);
    if (account.balance < payment.amount) throw new Error("Insufficient funds");
    await ctx.db.patch(account._id, { balance: Math.round((account.balance - payment.amount) * 100) / 100 });
    const billId = await ctx.db.insert("mockBankBills", {
      accountId,
      payee: payment.payee,
      nickname: payment.memo ?? "",
      paymentDate: payment.date,
      amount: payment.amount,
      status: "completed",
    });
    return `MOCK-${billId.slice(-8).toUpperCase()}`;
  },
});

async function getSnapshot(ctx: ActionCtx, accountId: string): Promise<BankSnapshot> {
  if (!isLive()) {
    const snapshot = await ctx.runQuery(internal.nessie.mockSnapshot, { accountId });
    if (!snapshot) throw new Error(`Mock bank account not found: ${accountId}. Run npm run reset.`);
    return snapshot;
  }
  const account = await nessieFetch<{ balance: number; account_number?: string }>("GET", `/accounts/${accountId}`);
  const bills = await nessieFetch<LiveBill[]>("GET", `/accounts/${accountId}/bills`);
  return {
    balance: account.balance,
    accountLast4: (account.account_number ?? DEMO_ACCOUNT_NUMBER).slice(-4),
    payments: bills
      .filter((b) => b.status !== "cancelled")
      .map((b) => ({
        date: (b.payment_date ?? b.creation_date ?? "").slice(0, 10),
        amount: b.payment_amount,
        payee: b.payee,
        memo: b.nickname || undefined,
      })),
  };
}

// ---------- check_bank_history ----------

const LOOKBACK_DAYS = 120;
const AMOUNT_TOLERANCE = 1.0;
const IRS_PAYEES = ["united states treasury", "us treasury", "u.s. treasury", "irs", "eftps", "internal revenue"];

function payeeMatches(payee: string, agencyName: string): boolean {
  const p = payee.toLowerCase();
  const agency = findAgency(agencyName);
  const names = agency?.agency === "IRS" ? IRS_PAYEES : (agency?.nameMatches ?? [agencyName.toLowerCase()]);
  return names.some((n) => (n === "irs" ? /\birs\b/.test(p) : p.includes(n)));
}

export const getCaseForBankCheck = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const doc = await ctx.db.get(c.documentId);
    const owner = await ctx.db.get(c.ownerId);
    // A later notice (a CP504 after a CP14) asks for more, as penalties and
    // interest grow, so a payment matching any notice of the case counts.
    const noticeAmounts = (await caseNotices(ctx, caseId))
      .map((n) => n.extraction.amountDue)
      .filter((a): a is number => a !== undefined);
    return {
      case: c,
      extraction: doc?.extraction as { issuer?: { agencyName: string }; noticeDate?: string } | undefined,
      owner,
      noticeAmounts,
      nowMs: await nowMs(ctx, c.ownerId),
    };
  },
});

export type BankCheckResult = NonNullable<Doc<"cases">["bankCheck"]> & { accountLast4: string };

export async function checkBankHistory(
  ctx: ActionCtx,
  ownerId: Id<"owners">,
  caseId: Id<"cases">,
): Promise<BankCheckResult> {
  const found = await ctx.runQuery(internal.nessie.getCaseForBankCheck, { caseId });
  if (!found || found.case.ownerId !== ownerId) throw new Error(`Case not found: ${caseId}`);
  const { case: c, extraction, owner, noticeAmounts } = found;
  if (!owner?.nessieAccountId) throw new Error("No bank account linked. Run npm run reset.");

  const snapshot = await getSnapshot(ctx, owner.nessieAccountId);
  // The demo clock decides "the last 120 days".
  const since = new Date(found.nowMs - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const amounts = [...new Set([...(c.amountDue === undefined ? [] : [c.amountDue]), ...noticeAmounts])];
  const agencyName = extraction?.issuer?.agencyName ?? "";
  const matches =
    c.amountDue === undefined
      ? []
      : snapshot.payments
          .filter((p) => p.date >= since)
          .filter((p) => amounts.some((a) => Math.abs(p.amount - a) <= AMOUNT_TOLERANCE))
          .filter((p) => payeeMatches(p.payee, agencyName))
          .sort((a, b) => b.date.localeCompare(a.date));

  const bankCheck = {
    balance: snapshot.balance,
    matches,
    canAffordFullPayment: c.amountDue === undefined || snapshot.balance >= c.amountDue,
    checkedAt: Date.now(),
  };
  await ctx.runMutation(internal.nessie.saveBankCheck, { caseId, bankCheck });
  return { ...bankCheck, accountLast4: snapshot.accountLast4 };
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const saveBankCheck = internalMutation({
  args: {
    caseId: v.id("cases"),
    bankCheck: v.object({
      balance: v.number(),
      matches: v.array(v.object({ date: v.string(), amount: v.number(), payee: v.string(), memo: v.optional(v.string()) })),
      canAffordFullPayment: v.boolean(),
      checkedAt: v.number(),
    }),
  },
  handler: async (ctx, { caseId, bankCheck }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return;
    await ctx.db.patch(caseId, { bankCheck });
    const m = bankCheck.matches[0];
    const summary = m
      ? `Found a ${usd(m.amount)} payment to ${m.payee} on ${m.date}${m.memo ? ` (${m.memo})` : ""}`
      : `No matching payment in the last ${LOOKBACK_DAYS} days; balance ${usd(bankCheck.balance)}${
          bankCheck.canAffordFullPayment ? " covers the amount due" : " does not cover the amount due"
        }`;
    await logEvent(ctx, { ownerId: c.ownerId, caseId, type: "bank_checked", summary, data: bankCheck });
  },
});

// ---------- payBill (called by the action executor) ----------

export const getActionForPayment = internalQuery({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }) => {
    const action = await ctx.db.get(actionId);
    if (!action) return null;
    const owner = await ctx.db.get(action.ownerId);
    return { action, owner, nowMs: await nowMs(ctx, action.ownerId) };
  },
});

/** Called only by the action executor (actions.ts) after the owner approves a pay_bill action. */
export const payBill = internalAction({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }): Promise<PayBillResult> => {
    const found = await ctx.runQuery(internal.nessie.getActionForPayment, { actionId });
    if (!found) throw new Error(`Action not found: ${actionId}`);
    const { action, owner } = found;
    // Defense in depth: the executor already checks this.
    if (action.status !== "approved") {
      throw new Error(`Refusing to pay: action ${actionId} is ${action.status}, not approved`);
    }
    if (action.type !== "pay_bill") {
      throw new Error(`Refusing to pay: action ${actionId} is ${action.type}, not pay_bill`);
    }
    if (!owner?.nessieAccountId) throw new Error("No bank account linked to this owner");

    const p = action.payload as { amount: number; payee: string; memo?: string };
    const payment: BankPayment = {
      date: new Date(found.nowMs).toISOString().slice(0, 10), // the demo clock's today
      amount: p.amount,
      payee: p.payee,
      memo: p.memo,
    };
    const confirmationId = isLive()
      ? await createLiveBill(owner.nessieAccountId, payment)
      : await ctx.runMutation(internal.nessie.mockPay, { accountId: owner.nessieAccountId, payment });
    return {
      confirmationId,
      paidAt: Date.now(),
      amount: p.amount,
      payee: p.payee,
      accountLast4: owner.accountLast4 ?? "",
    };
  },
});
