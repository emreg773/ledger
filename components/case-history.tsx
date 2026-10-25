"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { FileText, History, Landmark, Link2, ListChecks, Loader2, Phone } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { TimelineItem } from "@/convex/cases";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { docTypeName, useI18n, type T } from "@/lib/i18n";
import { formatDate, formatMoney } from "@/lib/format";

// Case memory (Step 4): every notice, bank payment, action and link of a case,
// oldest first, from cases.timeline. Opened from the document card.

export function CaseHistoryButton({ caseId }: { caseId: Id<"cases"> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="link" size="sm" className="h-auto px-0 text-xs" />}>
        <History className="size-3.5" /> {t("caseHistory.open")}
      </SheetTrigger>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-base">{t("caseHistory.title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("caseHistory.description")}</SheetDescription>
        </SheetHeader>
        {open && <Timeline caseId={caseId} />}
      </SheetContent>
    </Sheet>
  );
}

function Timeline({ caseId }: { caseId: Id<"cases"> }) {
  const { t, language } = useI18n();
  const items = useQuery(api.cases.timeline, { caseId });
  if (items === undefined) {
    return (
      <div className="flex justify-center p-6">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (items === null || items.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t("caseHistory.empty")}</p>;
  }
  return (
    <ol className="relative space-y-4 overflow-y-auto p-4 pl-10">
      <span className="absolute top-6 bottom-6 left-[1.4rem] w-px bg-border" aria-hidden />
      {items.map((item, i) => {
        const { Icon, tone } = iconFor(item);
        return (
          <li key={i} className="relative">
            <span
              className={`absolute top-0 -left-[1.6rem] flex size-6 items-center justify-center rounded-full border bg-background ${tone}`}
            >
              <Icon className="size-3.5" />
            </span>
            <div className="text-xs text-muted-foreground">{formatDate(item.date, language)}</div>
            <div className="text-sm font-medium">{headline(item, t, language)}</div>
            {line(item, t, language) && <div className="text-xs text-muted-foreground">{line(item, t, language)}</div>}
          </li>
        );
      })}
    </ol>
  );
}

function iconFor(item: TimelineItem) {
  switch (item.kind) {
    case "document":
      return { Icon: FileText, tone: "text-foreground" };
    case "bank_payment":
      return { Icon: Landmark, tone: "text-emerald-600" };
    case "action":
      return {
        Icon: item.actionType === "owner_task" ? Phone : ListChecks,
        tone: item.status === "executed" ? "text-emerald-600" : "text-muted-foreground",
      };
    case "event":
      return { Icon: Link2, tone: "text-muted-foreground" };
  }
}

function headline(item: TimelineItem, t: T, language: string): string {
  switch (item.kind) {
    case "document":
      return item.docType ? docTypeName(t, item.docType) : item.title;
    case "bank_payment":
      return t("caseHistory.bankPayment", {
        amount: item.amount !== undefined ? formatMoney(item.amount, language) : "",
        payee: item.payee ?? "",
      });
    case "action":
      return t(actionKey(item));
    case "event":
      return item.eventType === "case_linked" ? t("caseHistory.linked") : t("caseHistory.opened");
  }
}

function actionKey(item: TimelineItem) {
  const task = item.actionType === "owner_task";
  switch (item.status) {
    case "executed":
      return task ? "caseHistory.taskDone" : "caseHistory.actionDone";
    case "rejected":
      return "caseHistory.actionRejected";
    case "failed":
      return "caseHistory.actionFailed";
    default:
      return task ? "caseHistory.taskOpen" : "caseHistory.actionOpen";
  }
}

/** The second line: amount and due date for notices, the agent's summary for actions. */
function line(item: TimelineItem, t: T, language: string): string | undefined {
  switch (item.kind) {
    case "document": {
      const parts = [
        item.noticeCode,
        item.amount !== undefined ? formatMoney(item.amount, language) : undefined,
        item.dueDate ? t("doc.due", { date: formatDate(item.dueDate, language) }) : undefined,
      ].filter(Boolean);
      return parts.join(" · ") || undefined;
    }
    case "bank_payment":
      return item.detail;
    case "action":
      return item.title; // the summary, in English as proposed
    case "event":
      return undefined;
  }
}
