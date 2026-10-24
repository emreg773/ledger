import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";

// Nessie bank (Capital One sandbox), live or mock (NESSIE_MODE).
// STUB: payBill returns a fake confirmation so Track B can build the executor.
// The real Nessie calls and the mock dataset land in a follow-up PR.

export type PayBillResult = {
  confirmationId: string;
  paidAt: number;
  amount: number;
  payee: string;
  accountLast4: string;
};

export const getActionForPayment = internalQuery({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }) => {
    const action = await ctx.db.get(actionId);
    if (!action) return null;
    const owner = await ctx.db.get(action.ownerId);
    return { action, accountLast4: owner?.accountLast4 };
  },
});

/** Called only by Track B's executor after the owner approves a pay_bill action. */
export const payBill = internalAction({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }): Promise<PayBillResult> => {
    const found = await ctx.runQuery(internal.nessie.getActionForPayment, { actionId });
    if (!found) throw new Error(`Action not found: ${actionId}`);
    const { action } = found;
    // Defense in depth: the executor already checks this.
    if (action.status !== "approved") {
      throw new Error(`Refusing to pay: action ${actionId} is ${action.status}, not approved`);
    }
    if (action.type !== "pay_bill") {
      throw new Error(`Refusing to pay: action ${actionId} is ${action.type}, not pay_bill`);
    }
    const payload = action.payload as { amount: number; payee: string; accountLast4?: string };
    return {
      confirmationId: `STUB-${Date.now()}`,
      paidAt: Date.now(),
      amount: payload.amount,
      payee: payload.payee,
      accountLast4: found.accountLast4 ?? payload.accountLast4 ?? "0000",
    };
  },
});
