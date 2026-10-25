"use client";

import { useState, type ComponentProps } from "react";
import { useQuery } from "convex/react";
import { Camera, FileText, ListChecks, MessageSquare, type LucideIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import type { NotificationView } from "@/convex/notifications";
import { ActionCard } from "@/components/action-card";
import { DeadlineCalendar } from "@/components/deadline-calendar";
import { DocumentCard } from "@/components/document-card";
import { NotificationList } from "@/components/notification-center";
import { NotificationBanner } from "@/components/notifications";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { localeFor } from "@/lib/format";
import { docTypeName, useI18n, type MessageKey } from "@/lib/i18n";
import type { ActionView, CaseView } from "@/lib/contract";
import type { usePush } from "@/lib/push";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";

// The home screen, shown until the owner sends something: recent
// notifications on the left, the deadline calendar and shortcuts on the right.
// On a desktop it fits the screen: the notification list scrolls inside its
// card and nothing else does. On a phone it stacks (calendar, shortcuts,
// notifications) and the page scrolls.

type Docs = (Doc<"documents"> & { url: string | null })[];

/**
 * Files grouped by case: letters of one case together, newest first; letters
 * without a case on their own. Groups are ordered by their newest letter.
 */
function groupFiles(documents: Docs) {
  const groups = new Map<string, { key: string; caseId?: Docs[number]["caseId"]; docs: Docs }>();
  for (const d of documents) {
    const key = d.caseId ?? d._id;
    const g = groups.get(key) ?? { key, caseId: d.caseId, docs: [] };
    g.docs.push(d);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.docs.sort((a, b) => b.receivedAt - a.receivedAt);
  return [...groups.values()].sort((a, b) => b.docs[0].receivedAt - a.docs[0].receivedAt);
}

/** Opens the file picker in the composer (components/chat.tsx listens). */
export function startUpload() {
  window.dispatchEvent(new Event("ledger:upload"));
}

export function Home({
  owner,
  cases,
  documents,
  hasConversation,
  push,
  onOpenConversation,
  preview,
}: {
  owner: Doc<"owners">;
  cases: CaseView[];
  documents: Docs;
  hasConversation: boolean;
  push: ReturnType<typeof usePush>;
  onOpenConversation: () => void;
  /** /dev only: mock data instead of the backend. */
  preview?: {
    openTasks: ActionView[];
    notifications: NotificationView[];
    calendar: ComponentProps<typeof DeadlineCalendar>["preview"];
  };
}) {
  const { t, language } = useI18n();
  const today = useToday();
  const fetchedTasks = useQuery(api.actions.listOpenForOwner, preview ? "skip" : {});
  const openTasks = preview?.openTasks ?? fetchedTasks ?? [];
  const [sheet, setSheet] = useState<"files" | "tasks" | null>(null);
  const casesById = new Map(cases.map((c) => [c._id as string, c]));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 pt-6 pb-4 lg:h-full lg:px-6 lg:pt-4 lg:pb-3">
      <div className="mb-5 lg:mb-3">
        <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          {today ? new Intl.DateTimeFormat(localeFor(language), { weekday: "long", day: "numeric", month: "long" }).format(today) : " "}
        </p>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl lg:text-4xl">
          {t("home.greeting", { name: owner.name.split(" ")[0] })}
        </h1>
        {documents.length === 0 && (
          <p className="mt-2 max-w-xl text-sm text-muted-foreground lg:hidden">{t("home.firstTime")}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
          <NotificationBanner push={push} />
          <section
            className="ledger-card flex max-h-[70dvh] min-h-80 min-w-0 flex-col lg:max-h-none lg:min-h-0 lg:flex-1"
            aria-label={t("notif.title")}
          >
            <NotificationList
              title={<h2 className="font-display text-2xl leading-none">{t("home.recent")}</h2>}
              previewItems={preview?.notifications}
            />
          </section>
        </div>

        <div className="order-first flex min-w-0 flex-col gap-4 lg:order-none lg:min-h-0 lg:gap-3">
          <DeadlineCalendar cases={cases} filter={owner.calendarFilter} preview={preview?.calendar} />
          <div className="grid shrink-0 grid-cols-2 gap-3 lg:gap-2">
            <Tile icon={Camera} label="home.upload" hint="home.uploadHint" primary onClick={startUpload} />
            <Tile icon={FileText} label="home.files" count={documents.length} onClick={() => setSheet("files")} />
            <Tile icon={ListChecks} label="home.tasks" count={openTasks.length} onClick={() => setSheet("tasks")} />
            <Tile
              icon={MessageSquare}
              label="home.conversation"
              hint={hasConversation ? undefined : "home.conversationEmpty"}
              onClick={onOpenConversation}
            />
          </div>
        </div>
      </div>

      <Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          <SheetHeader className="border-b pr-12">
            <SheetTitle className="font-display text-2xl font-normal">
              {sheet === "tasks" ? t("home.tasks") : t("home.files")}
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {sheet === "files" &&
              (documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("home.filesEmpty")}</p>
              ) : (
                groupFiles(documents).map((g) => {
                  const caseView = g.caseId ? casesById.get(g.caseId) : undefined;
                  const cards = g.docs.map((d) => <DocumentCard key={d._id} doc={d} caseView={caseView} />);
                  // A case with several letters: one header, its letters newest first.
                  return caseView && g.docs.length > 1 ? (
                    <section key={g.key} className="space-y-3 border-l-2 border-foreground/70 pl-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-display text-xl leading-tight">{docTypeName(t, caseView.docType)}</h3>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t("home.caseLetters", { count: g.docs.length })}
                        </span>
                      </div>
                      {cards}
                    </section>
                  ) : (
                    cards
                  );
                })
              ))}
            {sheet === "tasks" &&
              (openTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("home.tasksEmpty")}</p>
              ) : (
                openTasks.map((a) => <ActionCard key={a._id} actionId={a._id} />)
              ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  hint,
  count,
  primary = false,
  onClick,
}: {
  icon: LucideIcon;
  label: MessageKey;
  hint?: MessageKey;
  count?: number;
  primary?: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex min-h-24 flex-col justify-between rounded-lg border-2 p-3 text-left transition-transform active:translate-y-px lg:min-h-0 lg:flex-row lg:items-center lg:gap-2 lg:px-3 lg:py-2.5",
        primary
          ? "border-foreground bg-foreground text-background"
          : "border-foreground/80 bg-card hover:bg-gold/30",
      )}
    >
      <div className="flex items-start justify-between lg:contents">
        <Icon className="size-5 shrink-0 lg:size-4" />
        {count !== undefined && (
          <span className="font-mono text-2xl leading-none tabular-nums lg:order-last lg:ml-auto lg:text-base">{count}</span>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold lg:truncate">{t(label)}</div>
        {hint && (
          <div className={cn("text-xs lg:hidden", primary ? "text-background/70" : "text-muted-foreground")}>{t(hint)}</div>
        )}
      </div>
    </button>
  );
}
