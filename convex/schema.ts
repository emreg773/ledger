import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Full Ledger schema (all 8 steps). Tables marked "Step N" are unused until then.
// Threads and messages live in the Agent component, not here.

export const documentSource = v.union(
  v.literal("web_upload"),
  v.literal("gmail"),
  v.literal("whatsapp"),
);

export const documentStatus = v.union(
  v.literal("received"),
  v.literal("extracting"),
  v.literal("extracted"),
  v.literal("failed"),
);

export const caseStatus = v.union(
  v.literal("open"),
  v.literal("awaiting_owner"),
  v.literal("in_progress"),
  v.literal("resolved"),
  v.literal("escalated"),
);

export const actionType = v.union(
  v.literal("send_email"),
  v.literal("send_whatsapp"),
  v.literal("pay_bill"),
  v.literal("create_document"),
  v.literal("add_calendar_event"),
  v.literal("schedule_followup"),
  // Step 2: a human-only step (a call, a signature). Instructions are in the payload.
  v.literal("owner_task"),
);

export const autonomyLevel = v.union(
  v.literal("auto"),
  v.literal("one_tap"),
  v.literal("human_only"),
);

export const actionStatus = v.union(
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("executed"),
  v.literal("failed"),
);

export const taskStatus = v.union(
  v.literal("open"),
  v.literal("sent"),
  v.literal("proof_received"),
  v.literal("verified"),
  v.literal("rejected"),
);

export const verificationVerdict = v.union(
  v.literal("verified"),
  v.literal("suspicious"),
  v.literal("unverified"),
);

// Step 2: result of verify_sender, saved on the case.
export const caseVerification = v.object({
  verdict: verificationVerdict,
  reasons: v.array(v.string()),
});

// Step 2: result of check_bank_history, saved on the case.
export const bankPaymentMatch = v.object({
  date: v.string(), // ISO date
  amount: v.number(),
  payee: v.string(),
  memo: v.optional(v.string()),
});

export const caseBankCheck = v.object({
  balance: v.number(),
  matches: v.array(bankPaymentMatch),
  canAffordFullPayment: v.boolean(),
  checkedAt: v.number(),
});

export default defineSchema({
  // Step 3: Convex Auth (users, sessions, accounts, ...). One owner per user.
  ...authTables,

  owners: defineTable({
    userId: v.optional(v.id("users")), // TODO(step3): required once dev owners without it are wiped
    name: v.string(),
    businessName: v.string(),
    preferredLanguage: v.string(), // BCP-47, e.g. "es"
    city: v.string(),
    county: v.string(),
    state: v.string(),
    email: v.optional(v.string()),
    whatsappNumber: v.optional(v.string()),
    agentThreadId: v.string(),
    // Step 2: Nessie bank account (live or mock)
    nessieCustomerId: v.optional(v.string()),
    nessieAccountId: v.optional(v.string()),
    accountLast4: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"])
    .index("by_whatsappNumber", ["whatsappNumber"]),

  // Step 3: web push subscriptions, one row per browser/device.
  pushSubscriptions: defineTable({
    ownerId: v.id("owners"),
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    userAgent: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_endpoint", ["endpoint"]),

  // Step 5
  staff: defineTable({
    ownerId: v.id("owners"),
    name: v.string(),
    role: v.string(),
    preferredLanguage: v.string(),
    whatsappNumber: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_whatsappNumber", ["whatsappNumber"]),

  documents: defineTable({
    ownerId: v.id("owners"),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    source: documentSource,
    sourceRef: v.optional(v.string()), // e.g. Gmail message ID
    receivedAt: v.number(),
    // Validated by the zod schema in convex/extraction.ts before it's saved.
    extraction: v.optional(v.any()),
    status: documentStatus,
    error: v.optional(v.string()),
    // Set when the extraction opens (or updates) a case, so the UI can link them.
    caseId: v.optional(v.id("cases")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_and_status", ["ownerId", "status"])
    .index("by_source_and_sourceRef", ["source", "sourceRef"]),

  cases: defineTable({
    ownerId: v.id("owners"),
    documentId: v.id("documents"),
    docType: v.string(),
    title: v.string(),
    amountDue: v.optional(v.number()),
    deadline: v.optional(v.string()), // ISO date
    status: caseStatus,
    createdAt: v.number(),
    // Step 2: the investigation results
    verification: v.optional(caseVerification),
    bankCheck: v.optional(caseBankCheck),
    playbookDocType: v.optional(v.string()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_and_status", ["ownerId", "status"])
    .index("by_document", ["documentId"]),

  // Step 2: proposed and executed actions. This is how approvals work.
  actions: defineTable({
    caseId: v.id("cases"),
    ownerId: v.id("owners"),
    type: actionType,
    autonomyLevel: autonomyLevel,
    status: actionStatus,
    summary: v.string(),
    payload: v.any(),
    result: v.optional(v.any()),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    executedAt: v.optional(v.number()),
    // The agent message whose [action:<id>] marker shows this action's card.
    threadMessageId: v.optional(v.string()),
  })
    .index("by_case", ["caseId"])
    .index("by_owner_and_status", ["ownerId", "status"]),

  // Step 6: staff work items
  tasks: defineTable({
    caseId: v.id("cases"),
    ownerId: v.id("owners"),
    staffId: v.optional(v.id("staff")),
    description: v.string(),
    descriptionTranslated: v.optional(v.string()),
    status: taskStatus,
    proofStorageId: v.optional(v.id("_storage")),
    verificationNote: v.optional(v.string()),
  })
    .index("by_case", ["caseId"])
    .index("by_staff_and_status", ["staffId", "status"])
    .index("by_owner_and_status", ["ownerId", "status"]),

  // Step 3
  generatedDocuments: defineTable({
    caseId: v.id("cases"),
    ownerId: v.id("owners"),
    kind: v.union(v.literal("pdf"), v.literal("docx")),
    purpose: v.string(), // e.g. "dispute_letter", "kitchen_checklist"
    storageId: v.id("_storage"),
    createdAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_owner", ["ownerId"]),

  // Step 2: mock Nessie bank (NESSIE_MODE=mock). Same shapes as the live API's
  // accounts and bills, so the demo works when Nessie is down.
  mockBankAccounts: defineTable({
    customerId: v.string(),
    accountId: v.string(),
    nickname: v.string(),
    balance: v.number(),
    accountNumber: v.string(),
  }).index("by_accountId", ["accountId"]),

  mockBankBills: defineTable({
    accountId: v.string(),
    payee: v.string(),
    nickname: v.string(), // the memo
    paymentDate: v.string(), // ISO date
    amount: v.number(),
    status: v.string(), // "completed", like Nessie's bill status
  }).index("by_accountId", ["accountId"]),

  // Append-only audit log. Never patch or delete rows here.
  events: defineTable({
    ownerId: v.id("owners"),
    caseId: v.optional(v.id("cases")),
    type: v.string(), // e.g. "document_received", "tool_called"
    summary: v.string(), // readable reason
    data: v.optional(v.any()),
    at: v.number(),
  })
    .index("by_owner", ["ownerId", "at"])
    .index("by_case", ["caseId", "at"]),
});
