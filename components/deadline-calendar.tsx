"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarPlus, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { openCase } from "@/components/notification-center";
import { countdown, formatMoney, localeFor } from "@/lib/format";
import { docTypeName, useI18n } from "@/lib/i18n";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";

// The home screen's calendar: every open letter's deadline on a month grid,
// plus the owner's own Google Calendar events (a dot under the day) once they
// connect it. Tapping a marked day lists both; a letter opens in the chat, a
// Google event opens in Google Calendar.

type CaseRow = Pick<Doc<"cases">, "_id" | "docType" | "title" | "deadline" | "amountDue" | "status">;
type GoogleEvent = Pick<Doc<"calendarEvents">, "_id" | "title" | "date" | "time" | "htmlLink" | "business">;
type CalendarStatus =
  | { connected: false }
  | { connected: true; calendarName?: string; lastSyncedAt?: number; error?: string };

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DeadlineCalendar({
  cases,
  filter = "business",
  preview,
}: {
  cases: CaseRow[];
  /** The owner's setting: only business-looking Google events, or all of them. */
  filter?: "business" | "all";
  /** /dev only: mock Google events instead of the backend. */
  preview?: { status: CalendarStatus; events: GoogleEvent[] };
}) {
  const { t, language } = useI18n();
  const today = useToday();
  const locale = localeFor(language);
  // US calendars start on Sunday; Spanish and Turkish ones on Monday.
  const weekStart = language === "en" ? 0 : 1;

  const open = cases.filter((c) => c.deadline && c.status !== "resolved");
  const byDay = new Map<string, CaseRow[]>();
  for (const c of open) byDay.set(c.deadline!, [...(byDay.get(c.deadline!) ?? []), c]);

  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const shown = month ?? (today ? { y: today.getFullYear(), m: today.getMonth() } : null);
  const range = shown && {
    from: iso(new Date(shown.y, shown.m, 1)),
    to: iso(new Date(shown.y, shown.m + 1, 0)),
  };
  const fetchedStatus = useQuery(api.googleCalendar.status, preview ? "skip" : {});
  const fetchedEvents = useQuery(api.googleCalendar.events, preview || !range ? "skip" : range);
  const status = preview ? preview.status : fetchedStatus;
  // Events synced before the business flag existed (undefined) still show.
  const googleEvents = (preview ? preview.events : (fetchedEvents ?? [])).filter(
    (e) => filter === "all" || e.business !== false,
  );
  const eventsByDay = new Map<string, GoogleEvent[]>();
  for (const e of googleEvents) eventsByDay.set(e.date, [...(eventsByDay.get(e.date) ?? []), e]);

  if (!today || !shown) return <div className="h-80" />;
  const todayIso = iso(today);

  const first = new Date(shown.y, shown.m, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(shown.y, shown.m + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(shown.y, shown.m, i + 1)),
  ];
  while (cells.length % 7) cells.push(null);

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2026, 1, 1 + ((weekStart + i) % 7))),
  );
  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(first);
  const step = (delta: number) => {
    const d = new Date(shown.y, shown.m + delta, 1);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
    setSelected(null);
  };

  // Under the grid: what's due and what's on the selected day, or the next deadlines.
  const listedEvents = selected ? (eventsByDay.get(selected) ?? []) : [];
  const listed = selected
    ? (byDay.get(selected) ?? [])
    : open.filter((c) => c.deadline! >= todayIso).sort((a, b) => a.deadline!.localeCompare(b.deadline!)).slice(0, 3);
  const overdue = open.filter((c) => c.deadline! < todayIso).length;

  return (
    <section className="ledger-card p-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:p-3.5" aria-label={t("home.calendar")}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl leading-none first-letter:uppercase">{monthTitle}</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={t("home.prevMonth")} onClick={() => step(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("home.nextMonth")} onClick={() => step(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 border-t-2 border-double border-foreground/70 pt-2 text-center lg:mt-2 lg:pt-1.5 text-[11px] font-medium text-muted-foreground uppercase">
        {weekdays.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = iso(d);
          const due = byDay.get(key);
          const events = eventsByDay.get(key);
          const isPast = key < todayIso;
          return (
            <button
              key={i}
              type="button"
              disabled={!due && !events}
              onClick={() => setSelected(selected === key ? null : key)}
              aria-pressed={selected === key}
              aria-label={
                [
                  due && t("home.dueOn", { date: key, count: due.length }),
                  events && t("cal.eventsOn", { count: events.length }),
                ]
                  .filter(Boolean)
                  .join(", ") || undefined
              }
              className={cn(
                "relative mx-auto flex size-9 items-center justify-center rounded-md font-mono text-sm tabular-nums lg:size-8 [@media(min-width:64rem)_and_(max-height:46rem)]:size-7",
                key === todayIso && "ring-2 ring-foreground",
                due && !isPast && "bg-gold font-semibold text-gold-foreground",
                due && isPast && "bg-destructive font-semibold text-white",
                selected === key && "outline-2 outline-offset-2 outline-foreground",
                !due && !events && "text-foreground/70",
              )}
            >
              {d.getDate()}
              {events && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-0.5 size-1 rounded-full",
                    due ? "bg-current" : "bg-foreground",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 border-t pt-3 lg:mt-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pt-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase">
          {selected ? t("home.dueThatDay") : overdue > 0 ? t("home.upcomingOverdue", { count: overdue }) : t("home.upcoming")}
        </h3>
        {listed.length === 0 && listedEvents.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("home.noDeadlines")}</p>
        ) : (
          <ul className="mt-1 divide-y">
            {listed.map((c) => {
              const due = countdown(c.deadline!, language, today);
              return (
                <li key={c._id}>
                  <button
                    type="button"
                    onClick={() => openCase(c._id)}
                    className="flex w-full items-center justify-between gap-3 py-2 text-left hover:opacity-80"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{docTypeName(t, c.docType)}</span>
                      <span className={cn("text-xs", due.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                        {due.overdue ? t("doc.overdue") : t("notif.due", { when: due.label })}
                      </span>
                    </span>
                    {c.amountDue !== undefined && (
                      <span className="shrink-0 font-mono text-sm tabular-nums">{formatMoney(c.amountDue, language)}</span>
                    )}
                  </button>
                </li>
              );
            })}
            {listedEvents.map((e) => (
              <li key={e._id}>
                <a
                  href={e.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center gap-3 py-2 text-left hover:opacity-80"
                >
                  <span className="w-11 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                    {e.time ?? t("cal.allDay")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{e.title || t("cal.untitled")}</span>
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("cal.openInGoogle")} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <GoogleCalendarLine status={status} filter={filter} preview={Boolean(preview)} />
    </section>
  );
}

/** Connect, reconnect or disconnect Google Calendar, at the bottom of the card. */
function GoogleCalendarLine({
  status,
  filter,
  preview,
}: {
  status: CalendarStatus | null | undefined;
  filter: "business" | "all";
  preview: boolean;
}) {
  const { t } = useI18n();
  const startConnect = useMutation(api.googleCalendar.startConnect);
  const disconnect = useMutation(api.googleCalendar.disconnect);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<"connected" | "error" | "scope" | "cancelled" | null>(null);

  // Google sends the owner back to /?calendar=connected (or =error).
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("calendar");
    if (result !== "connected" && result !== "error") return;
    const reason = url.searchParams.get("reason");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is only readable after mount
    setNotice(result === "error" && (reason === "scope" || reason === "cancelled") ? reason : result);
    url.searchParams.delete("calendar");
    url.searchParams.delete("reason");
    window.history.replaceState(null, "", url);
  }, []);

  async function connect() {
    if (preview) return;
    setPending(true);
    try {
      window.location.href = await startConnect({});
    } catch (e) {
      console.error(e);
      setNotice("error");
      setPending(false);
    }
  }

  if (!status) return null;
  const broken = status.connected && status.error;
  return (
    <div className="mt-2 border-t pt-2 text-xs">
      {notice === "error" && <p className="pb-1 text-destructive">{t("cal.connectError")}</p>}
      {notice === "scope" && <p className="pb-1 text-destructive">{t("cal.scopeMissing")}</p>}
      {notice === "cancelled" && <p className="pb-1 text-muted-foreground">{t("cal.cancelled")}</p>}
      {notice === "connected" && status.connected && !status.lastSyncedAt && (
        <p className="pb-1 text-muted-foreground">{t("cal.syncing")}</p>
      )}
      {!status.connected || broken ? (
        <div className="flex items-center justify-between gap-2">
          <span className={broken ? "text-destructive" : "text-muted-foreground"}>
            {broken ? t("cal.revoked") : t("cal.pitch")}
          </span>
          <Button variant="outline" size="sm" className="shrink-0" disabled={pending} onClick={() => void connect()}>
            {pending ? <Loader2 className="animate-spin" /> : <CalendarPlus />}
            {broken ? t("cal.reconnect") : t("cal.connect")}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span className="min-w-0 truncate">
            <span className="mr-1 inline-block size-1.5 rounded-full bg-foreground align-middle" aria-hidden />
            {t("cal.connected", { name: status.calendarName ?? "Google" })}
            {" · "}
            {filter === "all" ? t("cal.filterAll") : t("cal.filterBusiness")}
          </span>
          <Button
            variant="link"
            size="sm"
            className="h-auto shrink-0 p-0 text-xs text-muted-foreground"
            onClick={() => !preview && void disconnect({})}
          >
            {t("cal.disconnect")}
          </Button>
        </div>
      )}
    </div>
  );
}
