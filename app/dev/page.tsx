"use client";

import { useEffect, useState } from "react";
import { LANGUAGES } from "@/convex/shared";
import { ActionCardView } from "@/components/action-card";
import { ActivitySummary, LiveActivity } from "@/components/activity";
import { DocumentCard } from "@/components/document-card";
import { Onboarding } from "@/components/app";
import { AppMenu } from "@/components/app-menu";
import { Welcome } from "@/components/chat";
import { NotificationBanner } from "@/components/notifications";
import { I18nProvider } from "@/lib/i18n";
import type { ActionView } from "@/lib/contract";
import {
  mockActions,
  mockCaseFor,
  mockCases,
  mockDocuments,
  mockEvents,
  mockOwner,
} from "@/lib/mocks";

// Preview of every card state, from mock data shaped like lib/contract.ts.
// Lets us build and check the UI without a backend.
// The first 972CG card is live: Approve → confirm → "Paying…" → "Paid ✓".

const noop = async () => {};

export default function DevPreview() {
  const [language, setLanguage] = useState("es");
  return (
    <I18nProvider language={language}>
      <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-6">
        <header className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">Card preview (mock data)</h1>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="h-11 rounded-lg border bg-background px-2 text-sm"
            aria-label="Language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </header>

        <Section title="Onboarding">
          <div className="rounded-xl border">
            <Onboarding language={language} onLanguage={setLanguage} />
          </div>
        </Section>

        <Section title="Header menu, welcome, notification banner">
          <div className="relative flex items-center justify-between rounded-xl border px-3 py-2">
            <div className="font-semibold">{mockOwner.businessName}</div>
            <AppMenu owner={{ ...mockOwner, preferredLanguage: language }} preview />
          </div>
          <Welcome owner={mockOwner} />
          <NotificationBanner preview />
        </Section>

        <Section title="Demo flow: 972CG (interactive)">
          <LiveActivity steps={mockEvents} caseFor={mockCaseFor} />
          <DocumentCard doc={mockDocuments.irs972} caseView={mockCases.irs972} />
          <InteractivePayBill />
          <ActivitySummary steps={mockEvents} caseFor={mockCaseFor} />
        </Section>

        <Section title="Document cards">
          <DocumentCard doc={mockDocuments.cp14} caseView={mockCases.cp14} />
          <DocumentCard doc={mockDocuments.scam} caseView={mockCases.scam} />
        </Section>

        <Section title="pay_bill states">
          {(["payProposed", "payApproved", "payExecuted", "payRejected", "payFailed"] as const).map((k) => (
            <Labeled key={k} label={k}>
              <ActionCardView action={mockActions[k]} onApprove={noop} onReject={noop} onMarkDone={noop} />
            </Labeled>
          ))}
        </Section>

        <Section title="owner_task states">
          {(["taskProposed", "taskExecuted", "taskRejected"] as const).map((k) => (
            <Labeled key={k} label={k}>
              <ActionCardView action={mockActions[k]} onApprove={noop} onReject={noop} onMarkDone={noop} />
            </Labeled>
          ))}
        </Section>

        <Section title="auto action">
          <ActionCardView action={mockActions.autoExecuted} onApprove={noop} onReject={noop} onMarkDone={noop} />
        </Section>
      </div>
    </I18nProvider>
  );
}

/** Mimics the server: approve → approved, then executed 1.5 s later. */
function InteractivePayBill() {
  const [action, setAction] = useState<ActionView>(mockActions.payProposed);
  useEffect(() => {
    if (action.status !== "approved") return;
    const timer = setTimeout(
      () => setAction(mockActions.payExecuted),
      1500,
    );
    return () => clearTimeout(timer);
  }, [action.status]);
  return (
    <div className="space-y-2">
      <ActionCardView
        action={action}
        onApprove={async () => setAction({ ...action, status: "approved" })}
        onReject={async () => setAction({ ...action, status: "rejected" })}
        onMarkDone={noop}
      />
      <button type="button" className="text-xs underline" onClick={() => setAction(mockActions.payProposed)}>
        reset
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
