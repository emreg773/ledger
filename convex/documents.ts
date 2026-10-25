import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { logEvent } from "./events";
import { MIN_CONFIDENCE, type Extraction } from "./extraction";
import { requireOwner, viewerOwner } from "./access";
import { nowMs } from "./clock";

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

// ---------- Case memory (Step 4) ----------

/**
 * Letters with the same key belong to one case. Null when a key part is
 * missing: then the letter opens its own case, as before Step 4.
 */
export function caseKeyOf(x: Extraction): string | undefined {
  const all = (...parts: (string | undefined)[]) => (parts.every(Boolean) ? parts.join("|") : undefined);
  switch (x.docType) {
    case "IRS_CP14":
    case "IRS_CP504":
      return all("IRS941", x.taxForm, x.taxPeriodEnd, x.einLast4);
    case "IRS_972CG":
      return all("IRS972CG", x.taxYear, x.einLast4);
    case "COUNTY_HEALTH_INSPECTION":
      return all("INSPECTION", x.facilityId);
    default:
      return undefined;
  }
}

/** Two extractions of the same printed notice (a re-upload or a second photo). */
function sameNotice(a: Extraction, b: Extraction): boolean {
  return a.docType === b.docType && a.noticeDate === b.noticeDate && a.amountDue === b.amountDue;
}

/** The case's distinct notices, oldest first (by notice date, then arrival). Re-uploads count once. */
export async function caseNotices(ctx: QueryCtx, caseId: Id<"cases">) {
  const docs = (
    await ctx.db
      .query("documents")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect()
  )
    .filter((d) => d.extraction)
    .map((d) => ({ doc: d, extraction: d.extraction as Extraction }))
    .sort(
      (a, b) =>
        (a.extraction.noticeDate ?? "").localeCompare(b.extraction.noticeDate ?? "") ||
        a.doc.receivedAt - b.doc.receivedAt,
    );
  const distinct: typeof docs = [];
  for (const d of docs) {
    if (!distinct.some((x) => sameNotice(x.extraction, d.extraction))) distinct.push(d);
  }
  return distinct;
}

const code = (x: Extraction) => x.noticeCode ?? x.docType.replace(/^IRS_/, "");

/** "CP504B linked to the CP14 case from 2026-10-12 (same Form 941, period 2026-06-30)" */
function linkSummary(x: Extraction, prior: Extraction | undefined): string {
  const same =
    x.docType === "IRS_972CG"
      ? `same tax year ${x.taxYear}`
      : x.docType === "COUNTY_HEALTH_INSPECTION"
        ? `same facility ${x.facilityId}`
        : `same Form ${x.taxForm}, period ${x.taxPeriodEnd}`;
  const from = prior ? `the ${code(prior)} case${prior.noticeDate ? ` from ${prior.noticeDate}` : ""}` : "an existing case";
  return `${code(x)} linked to ${from} (${same})`;
}

/** A document's files in page order: page 1, then any extra pages. */
export async function documentFiles(ctx: QueryCtx, doc: Doc<"documents">) {
  const extra = await ctx.db
    .query("documentPages")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .collect();
  return [
    { storageId: doc.storageId, mimeType: doc.mimeType },
    ...extra.map((p) => ({ storageId: p.storageId, mimeType: p.mimeType })),
  ];
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Documents for the chat UI, with a viewable URL for each file. */
export const listForOwner = query({
  // TODO(step3): ownerId is ignored and goes away once Track B's UI stops sending it.
  args: { ownerId: v.optional(v.id("owners")) },
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .order("desc")
      .take(50);
    return await Promise.all(
      docs.map(async (d) => {
        const pages = await Promise.all(
          (await documentFiles(ctx, d)).map(async (f) => ({
            mimeType: f.mimeType,
            url: await ctx.storage.getUrl(f.storageId),
          })),
        );
        return { ...d, url: pages[0].url, pages };
      }),
    );
  },
});

/** The owner had this letter's card on screen in the app. Stops its "not opened" nudge. */
export const markOpened = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const owner = await requireOwner(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.ownerId !== owner._id || doc.status !== "extracted" || doc.openedAt !== undefined) {
      return null;
    }
    await ctx.db.patch(documentId, { openedAt: await nowMs(ctx, owner._id) });
    return null;
  },
});

export const markExtracting = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);
    await ctx.db.patch(documentId, { status: "extracting", error: undefined });
    return { ...doc, files: await documentFiles(ctx, doc) };
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

    const now = await nowMs(ctx, doc.ownerId);
    await ctx.db.patch(doc._id, { status: "extracted", extraction, extractedAt: doc.extractedAt ?? now });

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
    const caseKey = caseKeyOf(extraction);
    const caseFields = {
      docType: extraction.docType,
      title,
      amountDue: extraction.amountDue,
      // A health inspection's deadline is its reinspection date.
      deadline: extraction.deadline ?? extraction.inspection?.reinspectionDate,
      ...(caseKey ? { caseKey } : {}),
    };

    // 1. Re-reading this same document: update its case.
    const sameDocument = await ctx.db
      .query("cases")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .first();
    if (sameDocument) {
      await ctx.db.patch(sameDocument._id, caseFields);
      await ctx.db.patch(doc._id, { caseId: sameDocument._id });
      await logEvent(ctx, {
        ownerId: doc.ownerId,
        caseId: sameDocument._id,
        type: "case_updated",
        summary: `Updated case from a re-read: ${title}`,
        data: { documentId: doc._id },
      });
      return { caseId: sameDocument._id };
    }

    // 2. A letter about an existing case (same case key, any status), or the
    // same notice uploaded again (Step 2's match: same type, amount, deadline).
    const existing =
      (caseKey
        ? await ctx.db
            .query("cases")
            .withIndex("by_owner_and_key", (q) => q.eq("ownerId", doc.ownerId).eq("caseKey", caseKey))
            .first()
        : null) ??
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
      const notices = await caseNotices(ctx, existing._id);
      await ctx.db.patch(doc._id, { caseId: existing._id });

      // The same notice again: it joins the case but adds nothing to its history.
      if (notices.some((n) => sameNotice(n.extraction, extraction))) {
        await logEvent(ctx, {
          ownerId: doc.ownerId,
          caseId: existing._id,
          type: "case_updated",
          summary: `Same notice uploaded again; kept the existing case: ${title}`,
          data: { documentId: doc._id, duplicate: true },
        });
        return { caseId: existing._id };
      }

      const prior = notices.at(-1);
      const escalation = prior?.extraction.docType === "IRS_CP14" && extraction.docType === "IRS_CP504";
      await ctx.db.patch(existing._id, {
        ...caseFields,
        status: "open",
        stage: escalation ? 2 : (existing.stage ?? 1),
      });
      await logEvent(ctx, {
        ownerId: doc.ownerId,
        caseId: existing._id,
        type: "case_linked",
        summary: linkSummary(extraction, prior?.extraction),
        data: { documentId: doc._id, caseKey },
      });
      return { caseId: existing._id };
    }

    // 3. A new case.
    const caseId = await ctx.db.insert("cases", {
      ownerId: doc.ownerId,
      documentId: doc._id,
      ...caseFields,
      stage: 1,
      status: "open",
      createdAt: Date.now(),
      startedAt: now,
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
