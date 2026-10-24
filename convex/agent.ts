import { v } from "convex/values";
import { z } from "zod";
import type { Tool } from "ai";
import { Agent, createTool, saveMessage, stepCountIs } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { logEvent } from "./events";
import type { Id } from "./_generated/dataModel";
import { chatModel } from "./models";
import { languageName } from "./shared";
import { MIN_CONFIDENCE, runExtraction, type Extraction } from "./extraction";

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
- Always reply in the owner's preferred language: ${language}.
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

${STEP1_RULES}`;
}

// Temporary behavior until Step 2 adds playbooks, proposals, and actions.
const STEP1_RULES = `Current abilities (more are coming):
- When a message says a new document arrived, call read_document with its documentId first.
- After reading:
  - If needsClearerPhoto is true: do not explain the document. Ask for a clearer, well-lit photo of the whole page.
  - If docType is UNKNOWN: say honestly that you can't help with this kind of document yet. If it looks like a legal or tax letter, recommend a licensed professional. If it demands gift cards, crypto, or threatens arrest, warn that it may be a scam and not to pay.
  - Otherwise: a short summary only. What the document is, who sent it, the amount, and the deadline. Then the not-legal-or-tax-advice line.
- You cannot send, pay, or schedule anything yet. Don't promise actions you can't take.`;

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

export const ledgerAgent = new Agent(components.agent, {
  name: "Ledger",
  languageModel: chatModel,
  tools: { read_document: readDocument },
  // read_document, then the reply. A little headroom for retries.
  stopWhen: stepCountIs(5),
});

/** Runs the agent on the owner's thread, answering the given prompt message. */
export const respond = internalAction({
  args: {
    ownerId: v.id("owners"),
    promptMessageId: v.string(),
    // Set when this run was started by a new document.
    documentId: v.optional(v.id("documents")),
  },
  handler: async (ctx, { ownerId, promptMessageId, documentId }) => {
    const owner = await ctx.runQuery(internal.owners.get, { ownerId });
    if (!owner) throw new Error(`Owner not found: ${ownerId}`);

    try {
      await ledgerAgent.generateText(
        ctx,
        { threadId: owner.agentThreadId, userId: ownerId },
        { promptMessageId, instructions: buildInstructions(owner.preferredLanguage) },
      );
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
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      userId: args.ownerId,
      promptMessageId: args.promptMessageId,
      message: { role: "assistant", content: "⚠️ Ledger hit a problem and couldn't finish. Please try again in a minute." },
    });
  },
});
