import { generateText, Output, type ModelMessage } from "ai";
import { z } from "zod";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { extractionModel, sampleWatermarkRule } from "./models";

// ---------- Schema ----------

export const DOC_TYPES = [
  "IRS_CP14",
  "IRS_CP504",
  "IRS_972CG",
  "COUNTY_HEALTH_INSPECTION",
  "CITY_FINE",
  "CITY_CODE_VIOLATION",
  "CITY_LICENSE_LATE_NOTICE",
  "UNKNOWN",
] as const;

const isoDate = (what: string) =>
  z.string().describe(`${what}, ISO format YYYY-MM-DD. Omit if not printed.`);

// Inside `inspection` the model gets nullable fields instead of optional ones:
// optional fields nested in an optional object push the schema past the API's
// "Schema is too complex" limit. toStoredExtraction() turns the nulls back into
// missing fields, so storage still matches StoredInspection.
const nullableDate = (what: string) =>
  z.string().nullable().describe(`${what}, ISO format YYYY-MM-DD. null if not printed.`);

const modelInspectionSchema = z.object({
  placardColor: z.enum(["green", "yellow", "red"]).nullable(),
  score: z.number().nullable(),
  inspectionDate: nullableDate("Inspection date"),
  reinspectionDate: nullableDate("Reinspection date"),
  violations: z.array(
    z.object({
      code: z.string().nullable(),
      description: z.string(),
      severity: z.enum(["major", "minor", "unknown"]),
      correctedOnSite: z.boolean().nullable(),
      points: z.number().nullable(),
    }),
  ),
});

type StoredInspection = {
  placardColor?: "green" | "yellow" | "red";
  score?: number;
  inspectionDate?: string;
  reinspectionDate?: string;
  violations: {
    code?: string;
    description: string;
    severity: "major" | "minor" | "unknown";
    correctedOnSite?: boolean;
    points?: number;
  }[];
};

// What we ask the model for. Differs from the stored shape in two places:
// fieldConfidence is a list here (structured output prefers fixed keys) and a
// Record<string, number> in storage, and inspection uses nulls (see above).
// See toStoredExtraction().
const modelExtractionSchema = z.object({
  docType: z.enum(DOC_TYPES),
  issuer: z.object({
    agencyName: z.string().describe("Agency name exactly as printed"),
    level: z.enum(["federal", "state", "county", "city", "unknown"]),
  }),
  noticeCode: z.string().optional().describe('Notice code as printed, e.g. "CP14"'),
  noticeDate: isoDate("Date printed on the notice").optional(),
  taxFormAndPeriod: z
    .string()
    .optional()
    .describe('e.g. "Form 941, period ending 2026-06-30"'),
  // Case memory: what ties a later notice to the same case (documents.ts
  // caseKeyOf). Plain strings, empty when not printed: as nullable fields
  // (anyOf string/null) these five pushed the schema past the API's limit
  // ("The compiled grammar is too large"). toStoredExtraction() turns "" into
  // a missing field.
  taxForm: z.string().describe('Tax form number only, e.g. "941". Empty string if none'),
  taxPeriodEnd: z
    .string()
    .describe("End of the tax period, ISO format YYYY-MM-DD, e.g. 2026-06-30 for Q2 2026. Empty string if not printed"),
  taxYear: z.string().describe('Tax year, e.g. "2025". Empty string if none'),
  einLast4: z
    .string()
    .describe("Last 4 digits of the EIN printed on the document, digits only. Empty string if none"),
  facilityId: z
    .string()
    .describe("Health inspections: the facility or permit ID as printed. Empty string otherwise"),
  referencedNoticeDates: z
    .array(z.string())
    .describe("Dates (ISO) of earlier notices this letter mentions, e.g. a previous notice. Empty if none"),
  amountDue: z.number().optional().describe("Total amount due now, in USD"),
  deadline: isoDate("Response or payment deadline").optional(),
  recipientName: z.string().optional(),
  recipientBusiness: z.string().optional(),
  printedContacts: z.object({
    phones: z.array(z.string()),
    emails: z.array(z.string()),
    websites: z.array(z.string()),
    mailingAddresses: z.array(z.string()),
  }),
  acceptedResponseMethods: z
    .array(z.enum(["online", "email", "phone", "mail", "fax", "in_person"]))
    .describe("Only methods the document itself mentions"),
  paymentInstructions: z.string().optional().describe("How the letter says to pay, briefly"),
  requestedPaymentMethods: z
    .array(z.string())
    .describe(
      'How the document asks to be paid, as printed, e.g. ["irs.gov online", "check by mail"] or ["gift cards", "bitcoin"]. Empty if it asks for no payment.',
    ),
  pressureTactics: z
    .array(z.string())
    .describe(
      'Short phrases showing threats or unusual urgency, e.g. ["arrest within 48 hours", "do not contact your accountant"]. Normal deadlines and penalty warnings are not pressure tactics. Empty if none.',
    ),
  mainIssue: z.string().describe("One sentence, in English"),
  inspection: modelInspectionSchema
    .optional()
    .describe("Only for COUNTY_HEALTH_INSPECTION"),
  identifiersMasked: z
    .array(z.string())
    .describe('SSN/EIN/account numbers seen, masked to last 4, e.g. "EIN ending 6789"'),
  documentLanguage: z.string().describe('BCP-47 code, e.g. "en"'),
  fieldConfidence: z
    .array(z.object({ field: z.string(), confidence: z.number() }))
    .describe("Confidence 0 to 1 for each field you extracted"),
  overallConfidence: z
    .number()
    .describe("0 to 1. Below 0.6 if the image is blurry, cut off, or hard to read"),
});

type ModelExtraction = z.infer<typeof modelExtractionSchema>;
type CaseKeyField = "taxForm" | "taxPeriodEnd" | "taxYear" | "einLast4" | "facilityId";
export type Extraction = Omit<ModelExtraction, "fieldConfidence" | "inspection" | CaseKeyField> & {
  fieldConfidence: Record<string, number>;
  inspection?: StoredInspection;
} & Partial<Record<CaseKeyField, string>>;

// Below this, the agent asks for a clearer photo instead of explaining.
export const MIN_CONFIDENCE = 0.6;

const EXTRACTION_PROMPT = `You read official documents sent to small businesses in the US and extract structured data.

Rules:
- Extract only what is printed on the document. Leave a field out rather than guess.
- Dates must be ISO (YYYY-MM-DD). Amounts are plain numbers in USD.
- NEVER output a full SSN, EIN, ITIN, or bank account number anywhere, in any field. Mask to the last 4 digits ("EIN ending 6789") and list them in identifiersMasked.
- Classify by the notice code and agency actually printed. A letter that mentions the IRS but has no real notice code, demands gift cards, crypto, or wire transfers, threatens arrest, or uses an agency name that does not exist is NOT a real notice: use UNKNOWN.
- CP504 and its business version CP504B are IRS_CP504.
- taxForm, taxPeriodEnd, taxYear, einLast4 and referencedNoticeDates link a later notice to an earlier one about the same tax: fill them whenever they're printed.
- Menus, receipts, ads, personal letters and anything outside the listed types: UNKNOWN.
- For health inspections, list every violation and mark each as major or minor as printed.
- requestedPaymentMethods and pressureTactics: copy them from the document even when it looks like a scam. They drive the scam check.
- Be honest about confidence. If the photo is blurry, dark, cut off, or key numbers are hard to read, set overallConfidence below 0.6 and give low confidence to the affected fields.
- The document may have several pages. Read all of them.`;

// ---------- Masking (defense in depth; the prompt already asks for this) ----------

// 2-7 digit EIN (12-3456789), 3-2-4 SSN (123-45-6789), and long bare digit runs
// (bank accounts). Phone numbers are skipped because a 10-digit phone would
// otherwise look like an account number.
const SENSITIVE_PATTERNS = [
  /\b\d{2}-\d{7}\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b\d{9,17}\b/g,
];

export function maskSensitive(text: string): string {
  let out = text;
  for (const re of SENSITIVE_PATTERNS) {
    out = out.replace(re, (m) => `****${m.replace(/\D/g, "").slice(-4)}`);
  }
  return out;
}

function maskDeep(value: unknown, path: string): unknown {
  if (typeof value === "string") {
    return path === "printedContacts.phones" ? value : maskSensitive(value);
  }
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, path));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, maskDeep(v, path ? `${path}.${k}` : k)]),
    );
  }
  return value;
}

function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, dropNulls(v)]),
    );
  }
  return value;
}

function toStoredExtraction(raw: ModelExtraction): Extraction {
  const masked = maskDeep(raw, "") as ModelExtraction;
  const { taxForm, taxPeriodEnd, taxYear, einLast4, facilityId, ...rest } = masked;
  // Nulls become missing fields, and the EIN is never more than its last 4 digits.
  const clean = (s: string) => s.trim() || undefined;
  return {
    ...rest,
    taxForm: clean(taxForm),
    taxPeriodEnd: clean(taxPeriodEnd),
    taxYear: clean(taxYear),
    einLast4: einLast4?.replace(/\D/g, "").slice(-4) || undefined,
    facilityId: clean(facilityId),
    inspection: masked.inspection && (dropNulls(masked.inspection) as StoredInspection),
    fieldConfidence: Object.fromEntries(
      masked.fieldConfidence.map((f) => [f.field, f.confidence]),
    ),
  };
}

// ---------- Extraction ----------

export const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export type StoredFile = { storageId: Id<"_storage">; mimeType: string };

/**
 * Pure extraction: reads a document's stored files (its pages, in order) and
 * returns the masked extraction. No db writes.
 */
export async function extractFromStorage(
  ctx: ActionCtx,
  files: StoredFile[],
  hint?: string,
): Promise<Extraction> {
  const parts = await Promise.all(
    files.map(async ({ storageId, mimeType }) => {
      if (!SUPPORTED_TYPES.includes(mimeType)) {
        throw new Error(`Unsupported file type: ${mimeType}`);
      }
      const blob = await ctx.storage.get(storageId);
      if (!blob) throw new Error(`File not found in storage: ${storageId}`);
      return { data: new Uint8Array(await blob.arrayBuffer()), mediaType: mimeType };
    }),
  );

  const ask =
    files.length > 1
      ? `Extract the data from this document. The ${files.length} files above are its pages, in order; together they are one document.`
      : "Extract the data from this document.";
  // AI SDK 7 uses "file" parts for both images and PDFs ("image" is deprecated).
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        ...parts.map((p) => ({ type: "file" as const, ...p })),
        {
          type: "text",
          text: hint
            ? `${ask} The owner's note, a hint only (classify by what is printed): ${hint}`
            : ask,
        },
      ],
    },
  ];

  const result = await generateText({
    model: extractionModel,
    instructions: EXTRACTION_PROMPT + sampleWatermarkRule(),
    messages,
    output: Output.object({ schema: modelExtractionSchema }),
  });
  return toStoredExtraction(result.output);
}

/**
 * Full extraction for a document row: marks it extracting, runs the model,
 * saves the result, opens a case, and logs events. Used by the read_document tool.
 */
export type ExtractionRun =
  | { ok: true; documentId: Id<"documents">; caseId: Id<"cases"> | null; extraction: Extraction }
  | { ok: false; documentId: Id<"documents">; error: string };

export async function runExtraction(
  ctx: ActionCtx,
  documentId: Id<"documents">,
): Promise<ExtractionRun> {
  const doc = await ctx.runMutation(internal.documents.markExtracting, { documentId });
  try {
    const extraction = await extractFromStorage(ctx, doc.files, doc.hint);
    const { caseId }: { caseId: Id<"cases"> | null } = await ctx.runMutation(
      internal.documents.saveExtraction,
      {
        documentId,
        extraction,
      },
    );
    return { ok: true, documentId, caseId, extraction };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await ctx.runMutation(internal.documents.markFailed, { documentId, error });
    return { ok: false, documentId, error };
  }
}
