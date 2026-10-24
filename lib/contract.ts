import type { Doc, Id } from "@/convex/_generated/dataModel";

// Shapes from the Step 2 contract (docs/ledger-step2-B.md, Section 8) that
// Track A owns. The UI is built against these until Track A's versions land;
// then these types can be replaced by the real Doc<"cases"> fields.

export type Verdict = "verified" | "suspicious" | "unverified";

// TODO: after schema PR, confirm the matches shape against cases.bankCheck.
export type BankMatch = { date: string; amount: number; description?: string };

export type CaseView = Pick<
  Doc<"cases">,
  "_id" | "docType" | "title" | "amountDue" | "deadline" | "status"
> & {
  verification?: { verdict: Verdict; reasons: string[] };
  bankCheck?: {
    balance: number;
    matches: BankMatch[];
    canAffordFullPayment: boolean;
    checkedAt: number;
  };
};

/** What events.listRecentForOwner returns. */
export type RecentEvent = {
  _id: string;
  type: string;
  summary: string;
  caseId?: Id<"cases">;
  at: number;
};

// TODO: after schema PR, drop the widening: owner_task will be in Doc<"actions">["type"].
export type ActionView = Omit<Doc<"actions">, "type"> & {
  type: Doc<"actions">["type"] | "owner_task";
};

export type PayBillPayload = {
  amount: number;
  payee: string;
  accountLast4: string;
  memo?: string;
  dueDate?: string;
};

export type OwnerTaskPayload = {
  instructions: string;
  callScript?: { en: string; translated: string };
  phone?: string;
};

export type PayBillResult = {
  confirmationId: string;
  paidAt: number;
  amount: number;
  payee: string;
  accountLast4: string;
};
