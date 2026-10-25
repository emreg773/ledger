"use client";

import { useState } from "react";
import { LANGUAGES } from "@/convex/shared";
import { Home } from "@/components/home";
import { I18nProvider } from "@/lib/i18n";
import {
  mockActions,
  mockCalendar,
  mockCases,
  mockDocuments,
  mockNotifications,
  mockOwner,
} from "@/lib/mocks";

// The home screen with mock data, full width. /dev/home in development only
// (app/dev/layout.tsx returns 404 in production).

// Files with case links and dates: the CP14 and its CP504 follow-up in one
// case, the 972CG and the scam letter on their own.
const HOUR = 3_600_000;
const previewFiles = [
  { ...mockDocuments.cp14, caseId: mockCases.cp14._id, receivedAt: mockDocuments.cp14.receivedAt - 72 * HOUR },
  {
    ...mockDocuments.cp14,
    _id: "mock_doc_cp504" as typeof mockDocuments.cp14._id,
    caseId: mockCases.cp14._id,
    receivedAt: mockDocuments.cp14.receivedAt - 2 * HOUR,
    extraction: { ...mockDocuments.cp14.extraction, docType: "IRS_CP504", noticeCode: "CP504B", amountDue: 1262.4 },
  },
  { ...mockDocuments.irs972, caseId: mockCases.irs972._id, receivedAt: mockDocuments.irs972.receivedAt - 24 * HOUR },
  { ...mockDocuments.scam, receivedAt: mockDocuments.scam.receivedAt - 5 * HOUR },
];

export default function DevHomePreview() {
  const [language, setLanguage] = useState("es");
  return (
    <I18nProvider language={language}>
      <div className="flex justify-end gap-1 border-b px-4 py-2 text-xs">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => setLanguage(l.code)}
            className={l.code === language ? "font-semibold underline" : "text-muted-foreground"}
          >
            {l.label}
          </button>
        ))}
      </div>
      {/* The real page has a header and the chat bar around this; reserve the same space. */}
      <main className="overflow-y-auto lg:h-[calc(100dvh-11rem)]" data-preview-main>
      <Home
        owner={{ ...mockOwner, preferredLanguage: language }}
        cases={Object.values(mockCases)}
        documents={previewFiles}
        conversationCount={3}
        onOpenConversations={() => {}}
        preview={{
          openTasks: [mockActions.payProposed, mockActions.taskProposed],
          notifications: mockNotifications,
          calendar: mockCalendar,
        }}
      />
      </main>
    </I18nProvider>
  );
}
