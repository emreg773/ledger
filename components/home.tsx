"use client";

import { useState } from "react";
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
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { ActionView, CaseView } from "@/lib/contract";
import type { usePush } from "@/lib/push";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";

// The home screen, shown until the owner sends something: recent
// notifications on the left, the deadline calendar and shortcuts on the right.
// On a phone it stacks: calendar, shortcuts, then notifications.

type Docs = (Doc<"documents"> & { url: string | null })[];

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
  preview?: { openTasks: ActionView[]; notifications: NotificationView[] };
}) {
  const { t, language } = useI18n();
  const today = useToday();
  const fetchedTasks = useQuery(api.actions.listOpenForOwner, preview ? "skip" : {});
  const openTasks = preview?.openTasks ?? fetchedTasks ?? [];
  const [sheet, setSheet] = useState<"files" | "tasks" | null>(null);
  const casesById = new Map(cases.map((c) => [c._id as string, c]));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-4 lg:px-6">
      <div className="mb-5">
        <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          {today ? new Intl.DateTimeFormat(localeFor(language), { weekday: "long", day: "numeric", month: "long" }).format(today) : " "}
        </p>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">
          {t("home.greeting", { name: owner.name.split(" ")[0] })}
        </h1>
        {documents.length === 0 && (
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t("home.firstTime")}</p>
        )}
      </div>

      <NotificationBanner push={push} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <section
          className="ledger-card flex max-h-[70dvh] min-h-80 min-w-0 flex-col lg:max-h-[calc(100dvh-15rem)]"
          aria-label={t("notif.title")}
        >
          <NotificationList
            title={<h2 className="font-display text-2xl leading-none">{t("home.recent")}</h2>}
            previewItems={preview?.notifications}
          />
        </section>

        <div className="order-first min-w-0 space-y-4 lg:order-none">
          <DeadlineCalendar cases={cases} />
          <div className="grid grid-cols-2 gap-3">
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
                [...documents]
                  .sort((a, b) => b.receivedAt - a.receivedAt)
                  .map((d) => (
                    <DocumentCard key={d._id} doc={d} caseView={d.caseId ? casesById.get(d.caseId) : undefined} />
                  ))
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
        "group flex min-h-24 flex-col justify-between rounded-lg border-2 p-3 text-left transition-transform active:translate-y-px",
        primary
          ? "border-foreground bg-foreground text-background"
          : "border-foreground/80 bg-card hover:bg-gold/30",
      )}
    >
      <div className="flex items-start justify-between">
        <Icon className="size-5" />
        {count !== undefined && (
          <span className="font-mono text-2xl leading-none tabular-nums">{count}</span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold">{t(label)}</div>
        {hint && <div className={cn("text-xs", primary ? "text-background/70" : "text-muted-foreground")}>{t(hint)}</div>}
      </div>
    </button>
  );
}
