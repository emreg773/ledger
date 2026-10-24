import type { Doc, Id, TableNames } from "@/convex/_generated/dataModel";
import type { Extraction } from "@/convex/extraction";
import type { ActionView, CaseView, RecentEvent } from "@/lib/contract";

// Mock data shaped like the Step 2 contract, for the /dev preview page.
// Values follow the fixtures (fixtures/README.md). Not used by the real chat.

const id = <T extends TableNames | "_storage">(s: string) => s as Id<T>;
const NOW = Date.UTC(2026, 9, 24, 20, 0); // fixed, so server and client render the same
const OWNER = id<"owners">("mock_owner");

const extraction972: Extraction = {
  docType: "IRS_972CG",
  issuer: {
    agencyName: "Department of the Treasury, Internal Revenue Service, Information Returns Penalty Unit",
    level: "federal",
  },
  noticeCode: "972CG",
  noticeDate: "2026-10-05",
  taxFormAndPeriod: "Form 1099-NEC, tax year 2025",
  amountDue: 520,
  deadline: "2026-11-19",
  recipientName: "MARIA LOPEZ MBR",
  recipientBusiness: "TAQUERIA LA ESQUINA LLC",
  printedContacts: {
    phones: ["800-829-4933"],
    emails: [],
    websites: [],
    mailingAddresses: ["Internal Revenue Service, Information Returns Penalty Unit, Philadelphia, PA 19255-0000"],
  },
  acceptedResponseMethods: ["mail", "phone"],
  paymentInstructions: "Sign the consent statement and mail it with your payment of $520.00.",
  requestedPaymentMethods: ["check by mail"],
  pressureTactics: [],
  mainIssue: "Proposed $520 penalty for four Forms 1099-NEC filed late.",
  identifiersMasked: ["EIN ending 6789"],
  documentLanguage: "en",
  fieldConfidence: { docType: 0.97, amountDue: 0.98, deadline: 0.98 },
  overallConfidence: 0.96,
};

const doc = (
  _id: string,
  extraction: Extraction,
): Doc<"documents"> & { url: string | null } => ({
  _id: id<"documents">(_id),
  _creationTime: NOW,
  ownerId: OWNER,
  storageId: id<"_storage">("mock_storage"),
  mimeType: "application/pdf",
  source: "web_upload",
  receivedAt: NOW,
  extraction,
  status: "extracted",
  url: null,
});

export const mockDocuments = {
  irs972: doc("mock_doc_972", extraction972),
  cp14: doc("mock_doc_cp14", {
    ...extraction972,
    docType: "IRS_CP14",
    noticeCode: "CP14",
    noticeDate: "2026-10-12",
    taxFormAndPeriod: "Form 941, quarter ending 2026-06-30",
    amountDue: 1240.18,
    deadline: "2026-11-02",
    issuer: { agencyName: "Department of the Treasury, Internal Revenue Service", level: "federal" },
  }),
  scam: doc("mock_doc_scam", {
    ...extraction972,
    docType: "UNKNOWN",
    noticeCode: undefined,
    amountDue: 2980,
    deadline: undefined,
    issuer: { agencyName: "INTERNAL REVENUE TAX ENFORCEMENT DIVISION", level: "unknown" },
  }),
};

const caseView = (overrides: Partial<CaseView> & Pick<CaseView, "_id" | "docType">): CaseView => ({
  title: "",
  status: "open",
  ...overrides,
});

export const mockCases = {
  irs972: caseView({
    _id: id<"cases">("mock_case_972"),
    docType: "IRS_972CG",
    amountDue: 520,
    deadline: "2026-11-19",
    verification: { verdict: "verified", reasons: ["Notice code and address match the IRS"] },
    bankCheck: { balance: 8432.17, matches: [], canAffordFullPayment: true, checkedAt: NOW },
  }),
  cp14: caseView({
    _id: id<"cases">("mock_case_cp14"),
    docType: "IRS_CP14",
    amountDue: 1240.18,
    deadline: "2026-11-02",
    verification: { verdict: "verified", reasons: ["Notice code and phone match the IRS"] },
    bankCheck: {
      balance: 8432.17,
      matches: [{ date: "2026-10-02", amount: 1240.18, payee: "United States Treasury", memo: "Form 941 Q2 2026" }],
      canAffordFullPayment: true,
      checkedAt: NOW,
    },
  }),
  scam: caseView({
    _id: id<"cases">("mock_case_scam"),
    docType: "UNKNOWN",
    verification: { verdict: "suspicious", reasons: ["Demands gift cards", "Agency doesn't exist"] },
  }),
};

const base = {
  _creationTime: NOW,
  caseId: mockCases.irs972._id,
  ownerId: OWNER,
  createdAt: NOW,
};

const payBill = (status: ActionView["status"], result?: unknown): ActionView => ({
  ...base,
  _id: id<"actions">(`mock_pay_${status}`),
  type: "pay_bill",
  autonomyLevel: "one_tap",
  status,
  summary: "Pay the 972CG penalty",
  payload: { amount: 520, payee: "United States Treasury", accountLast4: "4417", dueDate: "2026-11-19" },
  result,
});

const ownerTask = (status: ActionView["status"]): ActionView => ({
  ...base,
  caseId: mockCases.cp14._id,
  _id: id<"actions">(`mock_task_${status}`),
  type: "owner_task",
  autonomyLevel: "human_only",
  status,
  summary: "Call the IRS about the duplicate CP14",
  payload: {
    instructions:
      "Llame al IRS para decirles que ya pagó este saldo el 2 de octubre. Tenga a mano el aviso y su comprobante de pago.",
    callScript: {
      en: "Hi, I'm calling about a CP14 notice for Taqueria La Esquina LLC, Form 941, quarter ending June 30, 2026. We paid $1,240.18 on October 2. Can you confirm the payment was applied?",
      translated:
        "Hola, llamo por un aviso CP14 de Taqueria La Esquina LLC, Formulario 941, trimestre que terminó el 30 de junio de 2026. Pagamos $1,240.18 el 2 de octubre. ¿Puede confirmar que el pago se aplicó?",
    },
    phone: "800-829-4933",
  },
});

export const mockActions = {
  payProposed: payBill("proposed"),
  payApproved: payBill("approved"),
  payExecuted: payBill("executed", {
    confirmationId: "NSB-7Q2K9M",
    paidAt: NOW,
    amount: 520,
    payee: "United States Treasury",
    accountLast4: "4417",
  }),
  payRejected: payBill("rejected"),
  payFailed: payBill("failed", { error: "The bank declined the transfer (insufficient funds)." }),
  taskProposed: ownerTask("proposed"),
  taskExecuted: ownerTask("executed"),
  taskRejected: ownerTask("rejected"),
  autoExecuted: {
    ...base,
    _id: id<"actions">("mock_auto"),
    type: "create_document",
    autonomyLevel: "auto",
    status: "executed",
    summary: "Draft a dispute letter",
    payload: {},
    result: { note: "available in a later step" },
  } satisfies ActionView,
};

const ev = (n: number, type: string, summary: string): RecentEvent => ({
  _id: `mock_event_${n}`,
  type,
  summary,
  caseId: mockCases.irs972._id,
  at: NOW - (10 - n) * 1500,
});

export const mockEvents: RecentEvent[] = [
  ev(1, "document_extracted", "Read document as IRS_972CG from Department of the Treasury, $520, deadline 2026-11-19 (confidence 0.96)"),
  ev(2, "sender_verified", "Sender verified: notice code 972CG, IRS address and phone match official records"),
  ev(3, "playbook_loaded", "Loaded playbook IRS_972CG: pay or dispute by the response date"),
  ev(4, "bank_checked", "Checked account ending 4417: balance $8,432.17, no payment to the IRS for $520.00"),
  ev(5, "action_proposed", "Ledger proposed paying $520.00 to United States Treasury (one_tap)"),
];

export function mockCaseFor(caseId: RecentEvent["caseId"]): CaseView | undefined {
  return Object.values(mockCases).find((c) => c._id === caseId);
}
