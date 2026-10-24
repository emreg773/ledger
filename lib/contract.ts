import type { Doc, Id } from "@/convex/_generated/dataModel";

// Shapes from the Step 2 contract (docs/ledger-step2-B.md, Section 8),
// derived from the schema so they can't drift.

type Verification = NonNullable<Doc<"cases">["verification"]>;
export type Verdict = Verification["verdict"];
export type BankMatch = NonNullable<Doc<"cases">["bankCheck"]>["matches"][number];

export type CaseView = Pick<
  Doc<"cases">,
  "_id" | "docType" | "title" | "amountDue" | "deadline" | "status" | "verification" | "bankCheck"
>;

/** What events.listRecentForOwner returns. */
export type RecentEvent = {
  _id: string;
  type: string;
  summary: string;
  caseId?: Id<"cases">;
  at: number;
};

export type ActionView = Doc<"actions">;

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
