import { v } from "convex/values";
import { z } from "zod";
import type { ModelMessage, Tool } from "ai";
import { Agent, createTool, saveMessage, stepCountIs } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { logEvent } from "./events";
import type { Id } from "./_generated/dataModel";
import { chatModel, sampleWatermarkRule } from "./models";
import { actionMarker, languageName, SYSTEM_NOTE_PREFIX } from "./shared";
import { MIN_CONFIDENCE, runExtraction, type Extraction } from "./extraction";
import { getPlaybook } from "./playbooks";
import type { Playbook } from "./playbooks/schema";
import { checkSender, type SenderCheck } from "./senderCheck";
import { checkBankHistory, type BankCheckResult, type PayBillResult } from "./nessie";
import { tryAgentRun } from "./limits";

type ReadDocumentOutput =
  | { ok: false; error: string; needsClearerPhoto: true }
  | {
      ok: true;
      caseId: Id<"cases"> | null;
      needsClearerPhoto: boolean;
      extraction: Extraction;
    };

// Brief Section 6, verbatim, with {language} filled in per run.
function buildInstructions(languageCode: string) {
  const language = languageName(languageCode);
  return `You are Ledger, a compliance agent for small business owners in the US.

How you work:
- You do the work yourself. Investigate, prepare, and draft before you ask the owner anything.
- Ask the owner only to approve an action, to sign something, or for information you cannot get yourself.
- Never give the owner a to-do list for steps you could do with your tools.

How you talk:
- Always reply in the owner's preferred language: ${language}. If earlier messages are in another
  language, just switch; don't mention or apologize for it.
- Write like a short WhatsApp message: plain words, short sentences, the key number and date first.

Accuracy and safety:
- Only state facts from the extracted document data or official playbooks. Never invent amounts,
  dates, phone numbers, email addresses, websites, or legal rules.
- If a field is missing or low-confidence, say you're not sure and ask for a clearer photo.
- Never send, pay, or message anyone other than the owner without explicit owner approval.
- Never ask the owner to type a full SSN, EIN, or bank account number.
- Audit letters, lawsuits, and unsupported documents: say so clearly and recommend a licensed
  professional (CPA, enrolled agent, or lawyer).
- End explanations of legal or tax documents with one short line saying this is not legal or tax advice.

${STEP2_RULES}${sampleWatermarkRule()}`;
}

// Step 2 workflow (Step 2 brief, Track A, Section 6). The code enforces what it can:
// propose_action refuses pay_bill for suspicious, unverified, already-paid or
// unaffordable cases, and fixes the amount and account from the case.
const STEP2_RULES = `Investigating:
- Investigate before you speak: verify the sender, load the playbook, and check the bank first.
- Lead with the most important fact: is the letter real, the amount, the deadline, and whether it is already paid.
- Use the playbook glossary: write key terms in the owner's language with the English term in parentheses, e.g. "multa (penalty)".
- Amounts and dates must come from tool results. Never compute or reformat them yourself beyond what the tools return.
  The one exception: write an ISO date in words in the owner's language (2026-10-02 becomes "2 de octubre de 2026"),
  without changing it.
- Anything meant for an agency is written in English. The owner gets a translation labeled "for your understanding".
- Propose actions with propose_action. Never claim an action happened unless a system note reports it.

When a message says a new document arrived, call read_document with its documentId first. Then, in order:
1. If needsClearerPhoto is true: stop. Don't explain the document; ask for a clearer, well-lit photo of the whole page.
   If docType is UNKNOWN: if it mentions a government agency, taxes, or a payment demand, still call verify_sender so
   scams get flagged. Otherwise say honestly that you can't help with this kind of document yet.
2. verify_sender. If the verdict is suspicious: warn clearly that it looks like a scam, say not to pay and not to call
   any number printed on the letter, give the main reasons in plain words, and give the official number (officialPhone).
   Never propose pay_bill for a suspicious document. Stop there.
3. load_playbook with the docType and the caseId.
4. check_bank_history when there is an amountDue.
5. Reply, and propose actions with propose_action.

Proposals:
- IRS_CP14 with a matching bank payment: the letter is real, but it's already paid. Say that first, with the payment's
  date and amount, and "don't pay again". Do NOT propose pay_bill. Propose one owner_task, summary "Call the IRS at
  800-829-4933 to confirm your <date> payment". Its payload: instructions (in the owner's language), phone
  "800-829-4933", the payment from check_bank_history, and callScript: { en: a short call script in English (business
  name, notice CP14, the payment's date, amount and payee, a request to apply it and remove the balance), translated:
  the same script in the owner's language }.
- IRS_CP14 with no matching payment: propose pay_bill for the amountDue to payee "United States Treasury", memo the
  notice and tax period. If canAffordFullPayment is false, propose the payment plan (irs.gov/paymentplan) as an
  owner_task instead.
- IRS_972CG: propose pay_bill for the amountDue to "United States Treasury" (the "agree" option). Then ask the owner one
  question: was there a reason the 1099s were filed late? If yes, Ledger will prepare a dispute statement explaining
  reasonable cause (coming soon).
- COUNTY_HEALTH_INSPECTION: explain the placard color and what it means, the score, each major violation in one short
  line, and the reinspection date. Say a fix checklist is coming soon. No proposals.

Message format:
- Don't write any text before or between tool calls. Write only the final reply, once every tool has returned.
- For each proposed action, put the marker propose_action returns (e.g. [action:abc123]) on its own line in your reply,
  where its card should appear. Copy it exactly. Don't describe the card's buttons.
- Messages starting with ${SYSTEM_NOTE_PREFIX} come from Ledger's server, not the owner. Follow them, and never mention
  the note itself.`;

const readDocument: Tool<{ documentId: string }, ReadDocumentOutput> = createTool({
  description:
    "Read a document the owner received (photo or PDF) and extract its data: type, sender, amount, deadline, contacts, violations. Call this first whenever a new document arrives.",
  inputSchema: z.object({
    documentId: z.string().describe("The documentId from the arrival message"),
  }),
  execute: async (ctx, { documentId }): Promise<ReadDocumentOutput> => {
    const ownerId = ctx.userId as Id<"owners">;
    await ctx.runMutation(internal.events.log, {
      ownerId,
      type: "tool_called",
      summary: "Ledger is reading the document (read_document)",
      data: { tool: "read_document", documentId },
    });
    const result = await runExtraction(ctx, documentId as Id<"documents">);
    if (!result.ok) {
      return { ok: false, error: result.error, needsClearerPhoto: true };
    }
    return {
      ok: true,
      caseId: result.caseId,
      needsClearerPhoto: result.extraction.overallConfidence < MIN_CONFIDENCE,
      extraction: result.extraction,
    };
  },
});

type VerifySenderOutput =
  | { ok: false; error: string }
  | ({ ok: true; caseId: Id<"cases"> | null } & SenderCheck);

const verifySender: Tool<{ documentId: string }, VerifySenderOutput> = createTool({
  description:
    "Check whether a document really comes from the agency it names: matches printed phones, websites and emails against the official contacts list, and looks for scam red flags (gift cards, crypto, threats, 555 numbers, names imitating a real agency). Call right after read_document.",
  inputSchema: z.object({ documentId: z.string() }),
  execute: async (ctx, { documentId }): Promise<VerifySenderOutput> => {
    const ownerId = ctx.userId as Id<"owners">;
    const doc = await ctx.runQuery(internal.documents.getInternal, {
      documentId: documentId as Id<"documents">,
    });
    if (!doc || doc.ownerId !== ownerId) return { ok: false, error: "Document not found" };
    const extraction = doc.extraction as Extraction | undefined;
    if (!extraction) return { ok: false, error: "Read the document first (read_document)" };
    await ctx.runMutation(internal.events.log, {
      ownerId,
      caseId: doc.caseId,
      type: "tool_called",
      summary: "Ledger is checking the sender (verify_sender)",
      data: { tool: "verify_sender", documentId },
    });
    const check = checkSender(extraction);
    const { caseId } = await ctx.runMutation(internal.senderCheck.saveSenderCheck, {
      documentId: doc._id,
      verification: { verdict: check.verdict, reasons: check.reasons },
      agency: check.agency,
    });
    return { ok: true, caseId, ...check };
  },
});

type LoadPlaybookOutput = { ok: false; error: string } | { ok: true; playbook: Playbook };

const loadPlaybook: Tool<{ docType: string; caseId?: string }, LoadPlaybookOutput> = createTool({
  description:
    "Load the official playbook for a document type: what it means, key facts, the owner's options, when to escalate, and a bilingual glossary. Only state legal facts that are in it.",
  inputSchema: z.object({
    docType: z.string().describe('e.g. "IRS_CP14"'),
    caseId: z.string().optional().describe("The caseId from read_document"),
  }),
  execute: async (ctx, { docType, caseId }): Promise<LoadPlaybookOutput> => {
    const ownerId = ctx.userId as Id<"owners">;
    const playbook = getPlaybook(docType);
    const id = caseId ? (caseId as Id<"cases">) : undefined;
    if (id) {
      const found = await ctx.runQuery(internal.cases.getInternal, { caseId: id });
      if (!found || found.case.ownerId !== ownerId) return { ok: false, error: "Case not found" };
      if (playbook) await ctx.runMutation(internal.cases.setPlaybook, { caseId: id, docType });
    }
    await ctx.runMutation(internal.events.log, {
      ownerId,
      caseId: id,
      type: "playbook_loaded",
      summary: playbook
        ? `Loaded the official playbook: ${playbook.title} (source: ${playbook.sources.join(", ")})`
        : `No playbook for ${docType} yet`,
      data: { docType },
    });
    return playbook ? { ok: true, playbook } : { ok: false, error: `No playbook for ${docType} yet` };
  },
});

type CheckBankOutput = { ok: false; error: string } | ({ ok: true } & BankCheckResult);

const checkBank: Tool<{ caseId: string }, CheckBankOutput> = createTool({
  description:
    "Check the owner's business bank account: the balance, and any payment to the agency in the last 120 days for the amount due (within $1). Call when the case has an amountDue.",
  inputSchema: z.object({ caseId: z.string() }),
  execute: async (ctx, { caseId }): Promise<CheckBankOutput> => {
    const ownerId = ctx.userId as Id<"owners">;
    await ctx.runMutation(internal.events.log, {
      ownerId,
      caseId: caseId as Id<"cases">,
      type: "tool_called",
      summary: "Ledger is checking the bank account (check_bank_history)",
      data: { tool: "check_bank_history" },
    });
    try {
      return { ok: true, ...(await checkBankHistory(ctx, ownerId, caseId as Id<"cases">)) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

const proposeInput = z.object({
  caseId: z.string(),
  type: z.enum(["pay_bill", "owner_task"]),
  summary: z.string().describe('One short English line, e.g. "Call the IRS at 800-829-4933 to confirm your Oct 2 payment"'),
  payload: z.object({
    amount: z.number().optional().describe("pay_bill: the amountDue from read_document"),
    payee: z.string().optional().describe('pay_bill: e.g. "United States Treasury"'),
    memo: z.string().optional().describe('pay_bill: e.g. "CP14, Form 941, period ending 2026-06-30"'),
    instructions: z.string().optional().describe("owner_task: what the owner should do, in the owner's language"),
    phone: z.string().optional().describe("owner_task: the official number to call"),
    callScript: z
      .object({ en: z.string(), translated: z.string() })
      .optional()
      .describe("owner_task: the call script in English, and the same in the owner's language"),
    payment: z
      .object({ date: z.string(), amount: z.number(), payee: z.string(), memo: z.string().optional() })
      .optional()
      .describe("owner_task: the matching payment from check_bank_history, if any"),
  }),
});
type ProposeInput = z.infer<typeof proposeInput>;
type ProposeOutput = { ok: false; error: string } | { ok: true; actionId: string; marker: string };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const proposeAction: Tool<ProposeInput, ProposeOutput> = createTool({
  description:
    "Propose an action for the owner to approve (pay_bill) or do themselves (owner_task). Returns a marker to put on its own line in your reply, where the action card appears. Proposing does not execute anything.",
  inputSchema: proposeInput,
  execute: async (ctx, { caseId, type, summary, payload }): Promise<ProposeOutput> => {
    const ownerId = ctx.userId as Id<"owners">;
    const found = await ctx.runQuery(internal.cases.getInternal, { caseId: caseId as Id<"cases"> });
    if (!found || found.case.ownerId !== ownerId) return { ok: false, error: "Case not found" };
    const { case: c, owner, actions } = found;

    // The same proposal twice (a re-upload, a retry) reuses the open card.
    const open = actions.find((a) => a.type === type && a.status === "proposed");
    if (open) return { ok: true, actionId: open._id, marker: actionMarker(open._id) };

    let finalPayload: Record<string, unknown>;
    if (type === "pay_bill") {
      const refuse = (error: string): ProposeOutput => ({ ok: false, error });
      if (!c.verification) return refuse("Run verify_sender first.");
      if (c.verification.verdict !== "verified") {
        return refuse(`The sender is ${c.verification.verdict}. Never propose a payment for this document.`);
      }
      if (!c.bankCheck) return refuse("Run check_bank_history first.");
      if (c.bankCheck.matches.length > 0) {
        return refuse("The bank already shows a matching payment. Don't propose paying again.");
      }
      if (!c.bankCheck.canAffordFullPayment) {
        return refuse("The balance doesn't cover the amount due. Propose the payment plan as an owner_task.");
      }
      if (c.amountDue === undefined) return refuse("The case has no amount due.");
      if (payload.amount !== undefined && Math.abs(payload.amount - c.amountDue) > 0.005) {
        return refuse(`The amount must be the amount due on the notice: ${c.amountDue}.`);
      }
      if (!payload.payee) return refuse("payee is required.");
      if (!owner?.accountLast4) return refuse("No bank account linked.");
      // Amount, account and due date come from the case and the owner, never the model.
      finalPayload = {
        amount: c.amountDue,
        payee: payload.payee,
        accountLast4: owner.accountLast4,
        memo: payload.memo,
        dueDate: c.deadline,
      };
      summary = `Pay ${usd(c.amountDue)} to ${payload.payee}`;
    } else {
      if (!payload.instructions) return { ok: false, error: "instructions are required for an owner_task." };
      finalPayload = {
        instructions: payload.instructions,
        phone: payload.phone,
        callScript: payload.callScript,
        payment: payload.payment,
      };
    }

    const actionId: Id<"actions"> = await ctx.runMutation(internal.actions.propose, {
      ownerId,
      caseId: c._id,
      type,
      summary,
      payload: finalPayload,
    });
    return { ok: true, actionId, marker: actionMarker(actionId) };
  },
});

export const ledgerAgent = new Agent(components.agent, {
  name: "Ledger",
  languageModel: chatModel,
  tools: {
    read_document: readDocument,
    verify_sender: verifySender,
    load_playbook: loadPlaybook,
    check_bank_history: checkBank,
    propose_action: proposeAction,
  },
  // read, verify, playbook, bank, up to two proposals, then the reply. Headroom for retries.
  stopWhen: stepCountIs(12),
  // Thinking blocks from earlier turns fail the API's signature check ("bound to
  // a different conversation"), which broke every reply after the first. Drop
  // them from history; the current turn's tool loop keeps its own, as required.
  contextHandler: async (_ctx, { search, recent, inputMessages, inputPrompt, existingResponses }) => [
    ...[...search, ...recent].map(withoutReasoning),
    ...inputMessages,
    ...inputPrompt,
    ...existingResponses,
  ],
});

function withoutReasoning(message: ModelMessage): ModelMessage {
  if (message.role !== "assistant" || typeof message.content === "string") return message;
  return { ...message, content: message.content.filter((part) => part.type !== "reasoning") };
}

/** Runs the agent on the owner's thread, answering the given prompt message. */
export const respond = internalAction({
  args: {
    ownerId: v.id("owners"),
    promptMessageId: v.string(),
    // Set when this run was started by a new document.
    documentId: v.optional(v.id("documents")),
    // Set when this run is the follow-up reply to an action (notifyActionResult).
    afterActionId: v.optional(v.id("actions")),
  },
  handler: async (ctx, { ownerId, promptMessageId, documentId, afterActionId }) => {
    const owner = await ctx.runQuery(internal.owners.get, { ownerId });
    if (!owner) throw new Error(`Owner not found: ${ownerId}`);

    const startedAt = Date.now();
    try {
      await ledgerAgent.generateText(
        ctx,
        { threadId: owner.agentThreadId, userId: ownerId },
        { promptMessageId, instructions: buildInstructions(owner.preferredLanguage) },
      );
      // Push only for runs the owner didn't start by typing (they're already looking).
      if (documentId || afterActionId) {
        await ctx.runMutation(internal.push.afterAgentRun, { ownerId, documentId, afterActionId, startedAt });
      }
    } catch (e) {
      // Don't leave the owner staring at "working...": record the failure
      // and post a short note in the thread.
      const error = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.agent.recordFailure, {
        ownerId,
        threadId: owner.agentThreadId,
        promptMessageId,
        documentId,
        error,
      });
    }
  },
});

export const recordFailure = internalMutation({
  args: {
    ownerId: v.id("owners"),
    threadId: v.string(),
    promptMessageId: v.string(),
    documentId: v.optional(v.id("documents")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.documentId) {
      const doc = await ctx.db.get(args.documentId);
      if (doc && (doc.status === "received" || doc.status === "extracting")) {
        await ctx.db.patch(doc._id, { status: "failed", error: args.error });
      }
    }
    await logEvent(ctx, {
      ownerId: args.ownerId,
      type: "agent_failed",
      summary: `Ledger could not finish: ${args.error.slice(0, 200)}`,
      data: { documentId: args.documentId },
    });
    if (args.documentId) {
      const doc = await ctx.db.get(args.documentId);
      await ctx.runMutation(internal.push.notifyOwner, {
        ownerId: args.ownerId,
        kind: "document_failed",
        caseId: doc?.caseId,
      });
    }
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      userId: args.ownerId,
      promptMessageId: args.promptMessageId,
      message: { role: "assistant", content: "⚠️ Ledger hit a problem and couldn't finish. Please try again in a minute." },
    });
  },
});

/**
 * Called by Track B's executor after an action reaches a final status (executed,
 * failed, rejected, or an owner task marked done). Adds a system note to the
 * thread and schedules a short reply in the owner's language.
 */
export const notifyActionResult = internalMutation({
  args: { ownerId: v.id("owners"), actionId: v.id("actions") },
  handler: async (ctx, { ownerId, actionId }) => {
    const action = await ctx.db.get(actionId);
    const owner = await ctx.db.get(ownerId);
    if (!action || !owner || action.ownerId !== ownerId) return null;
    const c = await ctx.db.get(action.caseId);

    // Amounts and ids come from the action's stored result, so the reply can't drift.
    let note: string;
    if (action.status === "executed" && action.type === "pay_bill") {
      const r = action.result as PayBillResult;
      note = `The payment ran: paid ${usd(r.amount)} to ${r.payee} from the account ending ${r.accountLast4}. Confirmation #${r.confirmationId}. Tell the owner in one or two short sentences, with the amount, the account's last 4 digits and the confirmation number.`;
    } else if (action.status === "executed" && action.type === "owner_task") {
      note = `The owner marked this task done: "${action.summary}". Thank them in one short sentence.`;
    } else if (action.status === "executed") {
      note = `"${action.summary}" is recorded; this kind of action becomes available in a later step. Say so in one short sentence.`;
    } else if (action.status === "failed") {
      const error = (action.result as { error?: string } | undefined)?.error ?? "unknown error";
      note = `This action failed: "${action.summary}" (${error}). Nothing was paid or sent. Tell the owner in one or two short sentences and offer to try again.`;
    } else if (action.status === "rejected") {
      const alternative =
        action.type === "pay_bill" && c?.docType === "IRS_972CG"
          ? " Ask whether they'd like Ledger to prepare a dispute statement explaining reasonable cause instead."
          : " Ask what they'd like to do instead.";
      note = `The owner declined: "${action.summary}". Nothing was paid or sent. Confirm it in one short sentence.${alternative}`;
    } else {
      return null;
    }

    // The global daily cap also covers follow-up replies. Over it, the card still
    // shows the result; only the chat reply (and its push) is skipped.
    if (!(await tryAgentRun(ctx, ownerId))) return null;
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: owner.agentThreadId,
      userId: ownerId,
      prompt: `${SYSTEM_NOTE_PREFIX} ${note} Don't propose new actions in this reply.`,
    });
    await ctx.scheduler.runAfter(0, internal.agent.respond, {
      ownerId,
      promptMessageId: messageId,
      // A push follows the reply for executed and failed actions, not rejections.
      afterActionId: action.status === "rejected" ? undefined : actionId,
    });
    return null;
  },
});
