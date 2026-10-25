"use client";

import { ChevronDown, FileText, Loader2, AlertTriangle } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import type { Extraction } from "@/convex/extraction";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { VerificationBadge } from "@/components/verification-badge";
import { CaseHistoryButton } from "@/components/case-history";
import { docTypeName, useI18n } from "@/lib/i18n";
import { countdown, formatDate, formatMoney, formatShortDate } from "@/lib/format";
import type { CaseView } from "@/lib/contract";
import { useToday } from "@/lib/use-today";

type DocumentWithUrl = Doc<"documents"> & { url: string | null };

const LOW_CONFIDENCE = 0.6;

function Confidence({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  const low = value < LOW_CONFIDENCE;
  return (
    <span className={low ? "text-amber-600 font-medium" : "text-muted-foreground"}>
      {Math.round(value * 100)}%
    </span>
  );
}

function Row({
  label,
  value,
  confidence,
}: {
  label: string;
  value: React.ReactNode;
  confidence?: number;
}) {
  if (value === undefined || value === null || value === "" ||
      (Array.isArray(value) && value.length === 0)) {
    return null;
  }
  return (
    <div className="grid grid-cols-[7.5rem_1fr_auto] gap-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words">{Array.isArray(value) ? value.join(", ") : value}</span>
      <Confidence value={confidence} />
    </div>
  );
}

function ExtractionDetails({ x }: { x: Extraction }) {
  const { t, language } = useI18n();
  const c = x.fieldConfidence ?? {};
  const violations = x.inspection?.violations ?? [];
  const major = violations.filter((v) => v.severity === "major").length;
  const minor = violations.filter((v) => v.severity === "minor").length;
  const date = (iso: string | undefined) => (iso ? formatDate(iso, language) : undefined);

  return (
    <div className="divide-y">
      <Row label={t("field.type")} value={docTypeName(t, x.docType)} confidence={c.docType} />
      <Row label={t("field.sender")} value={`${x.issuer.agencyName} (${x.issuer.level})`} confidence={c.issuer} />
      <Row label={t("field.noticeCode")} value={x.noticeCode} confidence={c.noticeCode} />
      <Row label={t("field.noticeDate")} value={date(x.noticeDate)} confidence={c.noticeDate} />
      <Row label={t("field.formPeriod")} value={x.taxFormAndPeriod} confidence={c.taxFormAndPeriod} />
      <Row
        label={t("field.amountDue")}
        value={x.amountDue !== undefined ? formatMoney(x.amountDue, language) : undefined}
        confidence={c.amountDue}
      />
      <Row label={t("field.deadline")} value={date(x.deadline)} confidence={c.deadline} />
      <Row label={t("field.recipient")} value={[x.recipientName, x.recipientBusiness].filter(Boolean).join(", ")} />
      <Row label={t("field.phones")} value={x.printedContacts.phones} />
      <Row label={t("field.emails")} value={x.printedContacts.emails} />
      <Row label={t("field.websites")} value={x.printedContacts.websites} />
      <Row label={t("field.addresses")} value={x.printedContacts.mailingAddresses} />
      <Row label={t("field.respondBy")} value={x.acceptedResponseMethods} />
      <Row label={t("field.howToPay")} value={x.paymentInstructions} />
      {x.inspection && (
        <>
          <Row label={t("field.placard")} value={x.inspection.placardColor} confidence={c["inspection.placardColor"]} />
          <Row label={t("field.score")} value={x.inspection.score} confidence={c["inspection.score"]} />
          <Row label={t("field.inspected")} value={date(x.inspection.inspectionDate)} />
          <Row label={t("field.reinspection")} value={date(x.inspection.reinspectionDate)} />
          <Row label={t("field.violations")} value={t("field.violationCounts", { major, minor })} />
          {violations.length > 0 && (
            <ul className="list-disc py-1 pl-5 text-xs">
              {violations.map((v, i) => (
                <li key={i}>
                  <span className={v.severity === "major" ? "font-medium" : ""}>
                    [{v.severity === "major" ? t("field.major") : t("field.minor")}] {v.description}
                  </span>
                  {v.correctedOnSite && (
                    <span className="text-muted-foreground"> ({t("field.correctedOnSite")})</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Row label={t("field.ids")} value={x.identifiersMasked} />
      <Row label={t("field.mainIssue")} value={x.mainIssue} />
      <Row label={t("field.language")} value={x.documentLanguage} />
      <Row label={t("field.overall")} value=" " confidence={x.overallConfidence} />
    </div>
  );
}

/** Verification badge, deadline countdown, and the bank check line, from the case. */
function CaseLines({ caseView, extraction }: { caseView: CaseView; extraction?: Extraction }) {
  const { t, language } = useI18n();
  const today = useToday();
  const deadline = caseView.deadline ?? extraction?.deadline;
  const due = deadline && today ? countdown(deadline, language, today) : null;
  const paid = caseView.bankCheck?.matches[0];
  return (
    <div className="space-y-1.5 border-t px-3 py-2 text-xs">
      {/* Case memory: an escalation joined this case, and its full history. */}
      <div className="flex flex-wrap items-center gap-2">
        {(caseView.stage ?? 1) >= 2 && (
          <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
            {t("caseHistory.secondNotice")}
          </Badge>
        )}
        <CaseHistoryButton caseId={caseView._id} />
      </div>
      {caseView.verification && (
        <div className="flex flex-wrap items-center gap-2">
          <VerificationBadge verdict={caseView.verification.verdict} />
          {caseView.verification.verdict === "suspicious" && (
            <span className="font-medium text-red-700 dark:text-red-400">{t("verify.suspiciousHint")}</span>
          )}
        </div>
      )}
      {deadline && (
        <div className={due?.overdue ? "font-medium text-destructive" : "text-muted-foreground"}>
          {t("doc.due", { date: formatDate(deadline, language) })}
          {due && ` · ${due.overdue ? t("doc.overdue") : due.label}`}
        </div>
      )}
      {caseView.bankCheck && (
        <div className={paid ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
          {paid ? t("bank.alreadyPaid", { date: formatShortDate(paid.date, language) }) : t("bank.noMatch")}
          <span className="font-normal text-muted-foreground"> · {t("bank.sandbox")}</span>
        </div>
      )}
    </div>
  );
}

export function DocumentCard({
  doc,
  caseView,
}: {
  doc: DocumentWithUrl | undefined;
  // The chat looks this up from documents.caseId; /dev passes mocks.
  caseView?: CaseView;
}) {
  const { t } = useI18n();
  if (!doc) {
    return <div className="rounded-xl border bg-card p-3 text-xs text-muted-foreground">{t("doc.received")}</div>;
  }
  const extraction = doc.extraction as Extraction | undefined;
  const isImage = doc.mimeType.startsWith("image/");
  const busy = doc.status === "received" || doc.status === "extracting";

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-xl border bg-card">
      {doc.url && isImage ? (
        <a href={doc.url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URL */}
          <img src={doc.url} alt={t("doc.image")} className="max-h-56 w-full object-cover" />
        </a>
      ) : (
        <a
          href={doc.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 p-3 text-sm"
        >
          <FileText className="size-5" /> {t("doc.pdf")}
        </a>
      )}

      {/* The note the owner sent with the document. */}
      {doc.hint && <p className="whitespace-pre-wrap border-t px-3 py-2 text-sm">{doc.hint}</p>}

      <div className="flex items-center gap-2 border-t px-3 py-2">
        {busy && <Loader2 className="size-3 animate-spin" />}
        {doc.status === "failed" && <AlertTriangle className="size-3 text-destructive" />}
        {doc.status === "extracted" && extraction ? (
          <div className="min-w-0">
            <div className="text-sm font-medium">{docTypeName(t, extraction.docType)}</div>
            {/* Raw code in small text, for judges. */}
            <div className="font-mono text-[10px] text-muted-foreground">{extraction.docType}</div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {doc.status === "received" && t("doc.received")}
            {doc.status === "extracting" && t("doc.reading")}
            {doc.status === "failed" && t("doc.failed")}
          </span>
        )}
        {extraction && extraction.overallConfidence < LOW_CONFIDENCE && (
          <Badge variant="outline" className="ml-auto text-amber-600">{t("doc.lowConfidence")}</Badge>
        )}
      </div>

      {caseView && <CaseLines caseView={caseView} extraction={extraction} />}

      {extraction && (
        <Collapsible className="border-t">
          <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between px-3 py-2 text-xs font-medium">
            {t("doc.whatLedgerRead")}
            <ChevronDown className="size-4 transition-transform group-data-[panel-open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3">
            <ExtractionDetails x={extraction} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
