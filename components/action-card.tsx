"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, ChevronDown, Copy, Loader2, Phone } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/lib/i18n";
import { countdown, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { ActionView, OwnerTaskPayload, PayBillPayload, PayBillResult } from "@/lib/contract";
import { useToday } from "@/lib/use-today";

// Approve cards (Step 2 brief, Track B, Section 4). The server enforces the
// rules; the card just never offers more than two buttons and disables them
// the moment one is tapped.

const TAP = "h-11 flex-1 text-base"; // 44 px tap targets

/** Live card for `[action:<id>]` in the chat. */
export function ActionCard({ actionId }: { actionId: string }) {
  const action = useQuery(api.actions.get, { actionId });
  const approve = useMutation(api.actions.approve);
  const reject = useMutation(api.actions.reject);
  const markDone = useMutation(api.actions.markDone);
  const reopen = useMutation(api.actions.reopen);

  if (action === undefined) return <CardShell><Loader2 className="size-4 animate-spin" /></CardShell>;
  if (action === null) return null;
  const id = action._id;
  return (
    <ActionCardView
      action={action}
      onApprove={() => approve({ actionId: id })}
      onReject={() => reject({ actionId: id })}
      onMarkDone={() => markDone({ actionId: id })}
      onUndo={() => reopen({ actionId: id })}
    />
  );
}

type Handlers = {
  onApprove: () => Promise<unknown>;
  onReject: () => Promise<unknown>;
  onMarkDone: () => Promise<unknown>;
  /** Undo "Mark done" on an owner task. */
  onUndo?: () => Promise<unknown>;
};

/** Pure view, so the /dev preview can render every state from mock data. */
export function ActionCardView({ action, ...handlers }: { action: ActionView } & Handlers) {
  if (action.type === "pay_bill") return <PayBillCard action={action} {...handlers} />;
  // Keyed by status: a fresh card (and tap guard) after Mark done or Undo.
  if (action.type === "owner_task") return <OwnerTaskCard key={action.status} action={action} {...handlers} />;
  return <GenericCard action={action} />;
}

function CardShell({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={`w-full max-w-sm rounded-xl border bg-card p-4 ${muted ? "text-muted-foreground" : ""}`}
    >
      {children}
    </div>
  );
}

/** Runs a mutation once: buttons lock on the first tap and unlock only on error. */
function useOnce() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await fn();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return { busy, failed, run };
}

function PayBillCard({ action, onApprove, onReject }: { action: ActionView } & Handlers) {
  const { t, language } = useI18n();
  const today = useToday();
  const { busy, failed, run } = useOnce();
  const [confirming, setConfirming] = useState(false);
  const p = action.payload as PayBillPayload;
  const amount = formatMoney(p.amount, language);

  if (action.status === "rejected") {
    return (
      <CardShell muted>
        <span className="text-sm">
          {t("action.notPaid")} · {amount} → {p.payee}
        </span>
      </CardShell>
    );
  }
  if (action.status === "approved") {
    return (
      <CardShell>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin" /> {t("action.paying")}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {amount} → {p.payee}
        </div>
      </CardShell>
    );
  }
  if (action.status === "executed") {
    const r = action.result as PayBillResult;
    return (
      <CardShell>
        <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">
          {t("action.paid")}
        </div>
        <div className="mt-1 text-sm">
          {formatMoney(r.amount, language)} → {r.payee}
        </div>
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <div>{t("action.confirmation", { id: r.confirmationId })}</div>
          <div>{formatDateTime(r.paidAt, language)}</div>
          <SandboxLabel />
        </div>
      </CardShell>
    );
  }
  if (action.status === "failed") {
    return (
      <CardShell>
        <div className="text-sm font-medium">{t("action.failed")}</div>
        {(action.result as { error?: string } | undefined)?.error && (
          <div className="mt-1 text-xs text-muted-foreground">
            {(action.result as { error: string }).error}
          </div>
        )}
        <div className="mt-2 text-sm text-muted-foreground">{t("action.failedHint")}</div>
      </CardShell>
    );
  }

  // proposed
  const due = p.dueDate && today ? countdown(p.dueDate, language, today) : null;
  return (
    <CardShell>
      <div className="text-3xl font-semibold tracking-tight">{amount}</div>
      <div className="mt-1 text-sm font-medium">{p.payee}</div>
      <div className="text-sm text-muted-foreground">
        {t("action.from", { last4: p.accountLast4 })} · <SandboxLabel />
      </div>
      {p.dueDate && (
        <div className={`mt-1 text-sm ${due?.overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
          {t("doc.due", { date: formatDate(p.dueDate, language) })}
          {due && ` · ${due.overdue ? t("doc.overdue") : due.label}`}
        </div>
      )}
      {failed && <div className="mt-2 text-xs text-destructive">{t("action.error")}</div>}
      <div className="mt-4 flex gap-2">
        <Button className={TAP} disabled={busy} onClick={() => setConfirming(true)}>
          {t("action.approve")}
        </Button>
        <Button className={TAP} variant="outline" disabled={busy} onClick={() => run(onReject)}>
          {t("action.reject")}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("action.confirmTitle", { amount, payee: p.payee, last4: p.accountLast4 })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("action.confirmBody")} <SandboxLabel />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                void run(onApprove);
              }}
            >
              {t("action.confirm", { amount })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardShell>
  );
}

function OwnerTaskCard({ action, onMarkDone, onUndo }: { action: ActionView } & Handlers) {
  const { t } = useI18n();
  const { busy, failed, run } = useOnce();
  const p = action.payload as OwnerTaskPayload;

  if (action.status === "rejected") {
    return (
      <CardShell muted>
        <span className="text-sm">
          {t("action.skipped")} · {p.instructions}
        </span>
      </CardShell>
    );
  }
  if (action.status === "executed") {
    return (
      <CardShell>
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{t("action.done")}</div>
          {onUndo && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(onUndo)}>
              {t("action.undo")}
            </Button>
          )}
        </div>
        <div className="mt-1 text-sm text-muted-foreground line-through">{p.instructions}</div>
        {failed && <div className="mt-2 text-xs text-destructive">{t("action.error")}</div>}
      </CardShell>
    );
  }

  return (
    <CardShell>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("action.task")}
      </div>
      <p className="mt-1 text-sm">{p.instructions}</p>
      {p.checklist && p.checklist.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {p.checklist.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}

      {p.callScript && (
        <Collapsible className="mt-3 rounded-lg border">
          <CollapsibleTrigger className="group flex h-11 w-full items-center justify-between px-3 text-sm font-medium">
            {t("action.callScript")}
            <ChevronDown className="size-4 transition-transform group-data-[panel-open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 px-3 pb-3">
            <Script label={t("action.scriptEnglish")} text={p.callScript.en} />
            <Script label={t("action.scriptTranslated")} text={p.callScript.translated} />
          </CollapsibleContent>
        </Collapsible>
      )}

      {failed && <div className="mt-2 text-xs text-destructive">{t("action.error")}</div>}
      {/* Stacked: a phone number doesn't fit beside another button at 390 px. */}
      <div className="mt-4 flex flex-col gap-2">
        {p.phone && (
          <a
            href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}
            className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border text-base font-medium"
          >
            <Phone className="size-4" /> {t("action.call", { phone: p.phone })}
          </a>
        )}
        <Button className="h-11 text-base" disabled={busy} onClick={() => run(onMarkDone)}>
          {t("action.markDone")}
        </Button>
      </div>
    </CardShell>
  );
}

function Script({ label, text }: { label: string; text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-11"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? t("action.copied") : t("action.copy")}
        </Button>
      </div>
      <p className="whitespace-pre-wrap rounded-md bg-muted p-2 text-sm">{text}</p>
    </div>
  );
}

/** Types without a card of their own yet (auto actions). */
function GenericCard({ action }: { action: ActionView }) {
  const { t } = useI18n();
  const later = (action.result as { note?: string } | undefined)?.note !== undefined;
  return (
    <CardShell muted={action.status === "rejected"}>
      <div className="text-sm">{action.summary}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {action.status === "executed" && (later ? t("action.later") : t("action.done"))}
        {action.status === "rejected" && t("action.skipped")}
        {action.status === "failed" && t("action.failed")}
        {(action.status === "proposed" || action.status === "approved") && (
          <Loader2 className="inline size-3 animate-spin" />
        )}
      </div>
    </CardShell>
  );
}

/** Nessie is a sandbox: say so wherever a payment shows, so nobody thinks real money moved. */
function SandboxLabel() {
  const { t } = useI18n();
  return (
    <span className="rounded bg-amber-100 px-1 py-px text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      {t("bank.sandbox")}
    </span>
  );
}
