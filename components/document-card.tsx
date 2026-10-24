"use client";

import { ChevronDown, FileText, Loader2, AlertTriangle } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import type { Extraction } from "@/convex/extraction";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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
  const c = x.fieldConfidence ?? {};
  const violations = x.inspection?.violations ?? [];
  const major = violations.filter((v) => v.severity === "major").length;
  const minor = violations.filter((v) => v.severity === "minor").length;

  return (
    <div className="divide-y">
      <Row label="Type" value={x.docType} confidence={c.docType} />
      <Row label="Sender" value={`${x.issuer.agencyName} (${x.issuer.level})`} confidence={c.issuer} />
      <Row label="Notice code" value={x.noticeCode} confidence={c.noticeCode} />
      <Row label="Notice date" value={x.noticeDate} confidence={c.noticeDate} />
      <Row label="Form / period" value={x.taxFormAndPeriod} confidence={c.taxFormAndPeriod} />
      <Row
        label="Amount due"
        value={x.amountDue !== undefined ? `$${x.amountDue.toFixed(2)}` : undefined}
        confidence={c.amountDue}
      />
      <Row label="Deadline" value={x.deadline} confidence={c.deadline} />
      <Row label="Recipient" value={[x.recipientName, x.recipientBusiness].filter(Boolean).join(", ")} />
      <Row label="Phones" value={x.printedContacts.phones} />
      <Row label="Emails" value={x.printedContacts.emails} />
      <Row label="Websites" value={x.printedContacts.websites} />
      <Row label="Addresses" value={x.printedContacts.mailingAddresses} />
      <Row label="Respond by" value={x.acceptedResponseMethods} />
      <Row label="How to pay" value={x.paymentInstructions} />
      {x.inspection && (
        <>
          <Row label="Placard" value={x.inspection.placardColor} confidence={c["inspection.placardColor"]} />
          <Row label="Score" value={x.inspection.score} confidence={c["inspection.score"]} />
          <Row label="Inspected" value={x.inspection.inspectionDate} />
          <Row label="Reinspection" value={x.inspection.reinspectionDate} />
          <Row label="Violations" value={`${major} major, ${minor} minor`} />
          {violations.length > 0 && (
            <ul className="list-disc py-1 pl-5 text-xs">
              {violations.map((v, i) => (
                <li key={i}>
                  <span className={v.severity === "major" ? "font-medium" : ""}>
                    [{v.severity}] {v.description}
                  </span>
                  {v.correctedOnSite && <span className="text-muted-foreground"> (corrected on site)</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Row label="IDs (masked)" value={x.identifiersMasked} />
      <Row label="Main issue" value={x.mainIssue} />
      <Row label="Language" value={x.documentLanguage} />
      <Row label="Overall" value="confidence" confidence={x.overallConfidence} />
    </div>
  );
}

export function DocumentCard({ doc }: { doc: DocumentWithUrl | undefined }) {
  if (!doc) {
    return <div className="rounded-xl border bg-card p-3 text-xs text-muted-foreground">Document</div>;
  }
  const extraction = doc.extraction as Extraction | undefined;
  const isImage = doc.mimeType.startsWith("image/");
  const busy = doc.status === "received" || doc.status === "extracting";

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-xl border bg-card">
      {doc.url && isImage ? (
        <a href={doc.url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URL */}
          <img src={doc.url} alt="Uploaded document" className="max-h-56 w-full object-cover" />
        </a>
      ) : (
        <a
          href={doc.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 p-3 text-sm"
        >
          <FileText className="size-5" /> PDF document
        </a>
      )}

      <div className="flex items-center gap-2 border-t px-3 py-2 text-xs">
        {busy && <Loader2 className="size-3 animate-spin" />}
        {doc.status === "failed" && <AlertTriangle className="size-3 text-destructive" />}
        <span className="text-muted-foreground">
          {doc.status === "received" && "Received"}
          {doc.status === "extracting" && "Reading..."}
          {doc.status === "failed" && "Could not read this file"}
          {doc.status === "extracted" && extraction?.docType}
        </span>
        {extraction && extraction.overallConfidence < LOW_CONFIDENCE && (
          <Badge variant="outline" className="text-amber-600">low confidence</Badge>
        )}
      </div>

      {extraction && (
        <Collapsible className="border-t">
          <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-2 text-xs font-medium">
            What Ledger read
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
