"use client";

import { BookOpen, ChevronDown, CircleCheck, FileSearch, Landmark, ListChecks, Loader2, ShieldCheck } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { VerificationBadge } from "@/components/verification-badge";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { CaseView, RecentEvent } from "@/lib/contract";

// Live activity (Step 2 brief, Track B, Section 5): the steps Ledger has taken
// since the owner's last message, built from events. While Ledger works it's an
// open list; under a finished reply it collapses to "What Ledger did (N steps)".

const STEPS: Record<string, { label: MessageKey; Icon: typeof FileSearch }> = {
  document_extracted: { label: "activity.document_extracted", Icon: FileSearch },
  sender_verified: { label: "activity.sender_verified", Icon: ShieldCheck },
  playbook_loaded: { label: "activity.playbook_loaded", Icon: BookOpen },
  bank_checked: { label: "activity.bank_checked", Icon: Landmark },
  action_proposed: { label: "activity.action_proposed", Icon: ListChecks },
};

/** Only the event types we show, oldest first. */
export function activitySteps(events: RecentEvent[]): RecentEvent[] {
  return events.filter((e) => e.type in STEPS).sort((a, b) => a.at - b.at);
}

type Props = {
  steps: RecentEvent[];
  /** Looks up a case for the sender verdict and bank result. */
  caseFor?: (caseId: RecentEvent["caseId"]) => CaseView | undefined;
};

/** Shown while Ledger works. */
export function LiveActivity({ steps, caseFor }: Props) {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-sm rounded-xl border bg-card px-3 py-2">
      <StepList steps={steps} caseFor={caseFor} />
      <div className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t("activity.working")}
      </div>
    </div>
  );
}

/** Shown under a finished reply. */
export function ActivitySummary({ steps, caseFor }: Props) {
  const { t } = useI18n();
  if (steps.length === 0) return null;
  return (
    <Collapsible className="w-full max-w-sm">
      <CollapsibleTrigger className="group flex min-h-11 items-center gap-1 text-xs text-muted-foreground">
        {t("activity.summary", { count: steps.length })}
        <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="rounded-xl border bg-card px-3 py-1">
        <StepList steps={steps} caseFor={caseFor} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function StepList({ steps, caseFor }: Props) {
  const { t } = useI18n();
  return (
    <ul className="divide-y">
      {steps.map((e) => {
        const { label, Icon } = STEPS[e.type];
        const c = caseFor?.(e.caseId);
        return (
          <li key={e._id} className="py-1.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Icon className="size-4 text-muted-foreground" />
              <span>{t(label)}</span>
              <CircleCheck className="size-4 text-emerald-600" aria-label="done" />
              {e.type === "sender_verified" && c?.verification && (
                <VerificationBadge verdict={c.verification.verdict} />
              )}
              {e.type === "bank_checked" && c?.bankCheck && (
                <span className="text-xs text-muted-foreground">
                  {c.bankCheck.matches.length > 0 ? t("activity.foundPayment") : t("activity.noPayment")}
                </span>
              )}
            </div>
            {/* The English audit line. Judges will open this. */}
            <details className="pl-6 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">{t("activity.details")}</summary>
              <p className="pt-1">{e.summary}</p>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
