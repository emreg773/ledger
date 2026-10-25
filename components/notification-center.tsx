"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Bell,
  CircleCheck,
  ClipboardList,
  Mail,
  Pin,
  Search,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { NotificationView } from "@/convex/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { countdown, timeAgo } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { splitPinned } from "@/lib/notifications";
import { useNow, useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";

// Notification center: every notification Ledger sent, searchable, filtered by
// category, with time-sensitive ones (open action, deadline within 14 days)
// pinned on top. Tapping one opens its letter in the chat.

type Category = NotificationView["category"];

const CATEGORIES: { value: Category; label: MessageKey; icon: LucideIcon; tone: string }[] = [
  { value: "needs_action", label: "notif.cat.needs_action", icon: ClipboardList, tone: "text-amber-600 dark:text-amber-400" },
  { value: "alert", label: "notif.cat.alert", icon: TriangleAlert, tone: "text-destructive" },
  { value: "letter", label: "notif.cat.letter", icon: Mail, tone: "text-sky-600 dark:text-sky-400" },
  { value: "done", label: "notif.cat.done", icon: CircleCheck, tone: "text-emerald-600 dark:text-emerald-400" },
];
const categoryInfo = (c: Category) => CATEGORIES.find((x) => x.value === c)!;

/** Asks the chat to scroll to a case's letter (components/chat.tsx listens). */
export function openCase(caseId: string) {
  window.dispatchEvent(new CustomEvent("ledger:open-case", { detail: caseId }));
}

export function NotificationCenter() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const unread = useQuery(api.notifications.unreadCount) ?? 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="relative"
            aria-label={unread > 0 ? t("notif.openUnread", { count: unread }) : t("notif.open")}
          />
        }
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        {open && (
          <NotificationList
            title={<SheetTitle className="text-base">{t("notif.title")}</SheetTitle>}
            description={<SheetDescription className="sr-only">{t("notif.description")}</SheetDescription>}
            className="pr-12"
            onNavigate={() => setOpen(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Search, category chips and the list, with time-sensitive ones pinned on top. */
export function NotificationList({
  title,
  description,
  className,
  onNavigate,
  previewItems,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  onNavigate?: () => void;
  /** /dev only: mock notifications instead of the backend, filtered here. */
  previewItems?: NotificationView[];
}) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const today = useToday();
  const now = useNow();
  const markAllRead = useMutation(api.notifications.markAllRead);
  const markRead = useMutation(api.notifications.markRead);

  // Search after a short pause in typing, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), 250);
    return () => clearTimeout(timer);
  }, [input]);

  const fetched = useQuery(
    api.notifications.list,
    previewItems ? "skip" : { search: search || undefined, category: category ?? undefined },
  );
  const items = previewItems
    ? previewItems.filter(
        (n) =>
          (!category || n.category === category) &&
          (!search || n.searchText.toLowerCase().includes(search.toLowerCase())),
      )
    : fetched;
  const { pinned, rest } = splitPinned(items ?? [], today);
  const hasUnread = (items ?? []).some((n) => n.readAt === undefined);

  function select(n: NotificationView) {
    if (n.readAt === undefined) void markRead({ notificationId: n._id });
    if (n.caseId) {
      onNavigate?.();
      openCase(n.caseId);
    }
  }

  return (
    <>
      <div className={cn("flex flex-col gap-3 border-b p-4", className)}>
        <div className="flex items-center justify-between gap-2">
          {title}
          {hasUnread && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void markAllRead({})}>
              {t("notif.markAllRead")}
            </Button>
          )}
        </div>
        {description}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("notif.search")}
            aria-label={t("notif.search")}
            className="h-10 pl-9 text-base sm:text-sm"
          />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="radiogroup" aria-label={t("notif.categories")}>
          <Chip active={category === null} onClick={() => setCategory(null)}>
            {t("notif.cat.all")}
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c.value} active={category === c.value} onClick={() => setCategory(c.value)}>
              <c.icon className={cn("size-3.5", category !== c.value && c.tone)} />
              {t(c.label)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {items === undefined ? null : items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {search || category ? t("notif.noResults") : t("notif.empty")}
          </p>
        ) : (
          <>
            {pinned.length > 0 && (
              <section aria-label={t("notif.pinned")} className="mb-3">
                <h3 className="flex items-center gap-1.5 px-2 pb-1.5 text-xs font-medium text-amber-700 uppercase dark:text-amber-400">
                  <Pin className="size-3.5" /> {t("notif.pinned")}
                </h3>
                <ul className="space-y-1.5">
                  {pinned.map((n) => (
                    <Item key={n._id} n={n} pinned today={today} now={now} onSelect={select} />
                  ))}
                </ul>
              </section>
            )}
            {rest.length > 0 && (
              <section aria-label={t("notif.all")}>
                {pinned.length > 0 && (
                  <h3 className="px-2 pb-1.5 text-xs font-medium text-muted-foreground uppercase">
                    {t("notif.all")}
                  </h3>
                )}
                <ul className="space-y-0.5">
                  {rest.map((n) => (
                    <Item key={n._id} n={n} today={today} now={now} onSelect={select} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function Item({
  n,
  pinned = false,
  today,
  now,
  onSelect,
}: {
  n: NotificationView;
  pinned?: boolean;
  today: Date | null;
  now: number | null;
  onSelect: (n: NotificationView) => void;
}) {
  const { t, language } = useI18n();
  const info = categoryInfo(n.category);
  const unread = n.readAt === undefined;
  const due = pinned && n.case?.deadline && today ? countdown(n.case.deadline, language, today) : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(n)}
        className={cn(
          "flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted",
          pinned && "border border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:hover:bg-amber-950/60",
        )}
      >
        <info.icon className={cn("mt-0.5 size-4 shrink-0", info.tone)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
              {n.title}
            </span>
            <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(n.createdAt).toISOString()}>
              {now !== null && timeAgo(n.createdAt, Math.max(now, n.createdAt), language)}
            </time>
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">{n.body}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
            <span className="text-muted-foreground">{t(info.label)}</span>
            {due && (
              <span className={cn("font-medium", due.overdue ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
                · {due.overdue ? t("doc.overdue") : t("notif.due", { when: due.label })}
              </span>
            )}
          </div>
        </div>
        {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-500" aria-label={t("notif.unread")} />}
      </button>
    </li>
  );
}
