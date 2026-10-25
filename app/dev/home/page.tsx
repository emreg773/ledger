"use client";

import { useState } from "react";
import { LANGUAGES } from "@/convex/shared";
import { Home } from "@/components/home";
import { I18nProvider } from "@/lib/i18n";
import {
  fakePush,
  mockActions,
  mockCalendar,
  mockCases,
  mockDocuments,
  mockNotifications,
  mockOwner,
} from "@/lib/mocks";

// The home screen with mock data, full width. /dev/home in development only
// (app/dev/layout.tsx returns 404 in production).

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
        documents={Object.values(mockDocuments)}
        hasConversation
        push={fakePush("default")}
        onOpenConversation={() => {}}
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
