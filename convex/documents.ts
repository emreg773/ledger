import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { logEvent } from "./events";
import { MIN_CONFIDENCE, type Extraction } from "./extraction";

// Short titles for cases, in English. The agent translates when it talks.
const CASE_TITLES: Record<string, string> = {
  IRS_CP14: "IRS tax bill (CP14)",
  IRS_CP504: "IRS final notice before collection (CP504)",
  IRS_972CG: "IRS proposed penalty (972CG)",
  COUNTY_HEALTH_INSPECTION: "Health inspection",
  CITY_FINE: "City fine",
  CITY_CODE_VIOLATION: "City code violation",
  CITY_LICENSE_LATE_NOTICE: "Late business license notice",
};

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Documents for the chat UI, with a viewable URL for each file. */
export const listForOwner = query({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(50);
    return await Promise.all(
      docs.map(async (d) => ({ ...d, url: await ctx.storage.getUrl(d.storageId) })),
    );
  },
});

export const markExtracting = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);
    await ctx.db.patch(documentId, { status: "extracting", error: undefined });
    return doc;
  },
});

export const markFailed = internalMutation({
  args: { documentId: v.id("documents"), error: v.string() },
  handler: async (ctx, { documentId, error }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) return;
    await ctx.db.patch(documentId, { status: "failed", error });
    await logEvent(ctx, {
      ownerId: doc.ownerId,
      type: "document_failed",
      summary: `Could not read the document: ${error}`,
      data: { documentId },
    });
  },
});

/** Saves the extraction and opens a case when we know what the document is. */
export const saveExtraction = internalMutation({
  args: { documentId: v.id("documents"), extraction: v.any() },
  handler: async (ctx, args) => {
    const extraction = args.extraction as Extraction;
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error(`Document not found: ${args.documentId}`);

    await ctx.db.patch(doc._id, { status: "extracted", extraction });

    const amount = extraction.amountDue !== undefined ? `, $${extraction.amountDue}` : "";
    const deadline = extraction.deadline ? `, deadline ${extraction.deadline}` : "";
    await logEvent(ctx, {
      ownerId: doc.ownerId,
      type: "document_extracted",
      summary: `Read document as ${extraction.docType} from ${extraction.issuer.agencyName}${amount}${deadline} (confidence ${extraction.overallConfidence})`,
      data: { documentId: doc._id, docType: extraction.docType },
    });

    // No case for unknown documents or unreadable photos; the agent asks
    // for a clearer photo instead, and the retake gets its own document row.
    if (extraction.docType === "UNKNOWN" || extraction.overallConfidence < MIN_CONFIDENCE) {
      return { caseId: null };
    }

    const title = CASE_TITLES[extraction.docType] ?? extraction.docType;
    const caseFields = {
      docType: extraction.docType,
      title,
      amountDue: extraction.amountDue,
      deadline: extraction.deadline,
    };

    // Idempotent: re-reading a document updates its case instead of opening a second one.
    // Re-uploading the same letter (a new file, so a new document row) joins the
    // open case for the same notice: same type, amount and deadline.
    const existing =
      (await ctx.db
        .query("cases")
        .withIndex("by_document", (q) => q.eq("documentId", doc._id))
        .first()) ??
      (await ctx.db
        .query("cases")
        .withIndex("by_owner", (q) => q.eq("ownerId", doc.ownerId))
        .order("desc")
        .take(50)
        .then((cases) =>
          cases.find(
            (c) =>
              c.status !== "resolved" &&
              c.docType === extraction.docType &&
              c.amountDue === extraction.amountDue &&
              c.deadline === extraction.deadline,
          ),
        ));
    if (existing) {
      await ctx.db.patch(existing._id, caseFields);
      await ctx.db.patch(doc._id, { caseId: existing._id });
      await logEvent(ctx, {
        ownerId: doc.ownerId,
        caseId: existing._id,
        type: "case_updated",
        summary:
          existing.documentId === doc._id
            ? `Updated case from a re-read: ${title}`
            : `Same notice uploaded again; kept the existing case: ${title}`,
        data: { documentId: doc._id },
      });
      return { caseId: existing._id };
    }

    const caseId = await ctx.db.insert("cases", {
      ownerId: doc.ownerId,
      documentId: doc._id,
      ...caseFields,
      status: "open",
      createdAt: Date.now(),
    });
    await ctx.db.patch(doc._id, { caseId });
    await logEvent(ctx, {
      ownerId: doc.ownerId,
      caseId,
      type: "case_opened",
      summary: `Opened case: ${title}`,
      data: { documentId: doc._id },
    });
    return { caseId };
  },
});

export const getInternal = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => await ctx.db.get(documentId),
});
