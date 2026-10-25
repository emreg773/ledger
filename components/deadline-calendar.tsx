"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { openCase } from "@/components/notification-center";
import { countdown, formatMoney, localeFor } from "@/lib/format";
import { docTypeName, useI18n } from "@/lib/i18n";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";

// The home screen's calendar: every open letter's deadline on a month grid.
// Tapping a marked day lists what's due; tapping a letter opens it in the chat.

type CaseRow = Pick<Doc<"cases">, "_id" | "docType" | "title" | "deadline" | "amountDue" | "status">;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DeadlineCalendar({ cases }: { cases: CaseRow[] }) {
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
  if (!today) return <div className="h-80" />;
  const shown = month ?? { y: today.getFullYear(), m: today.getMonth() };
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

  // Under the grid: what's due on the selected day, or the next deadlines.
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
          const isPast = key < todayIso;
          return (
            <button
              key={i}
              type="button"
              disabled={!due}
              onClick={() => setSelected(selected === key ? null : key)}
              aria-pressed={selected === key}
              aria-label={due ? t("home.dueOn", { date: key, count: due.length }) : undefined}
              className={cn(
                "relative mx-auto flex size-9 items-center justify-center rounded-md font-mono text-sm tabular-nums lg:size-8 [@media(min-width:64rem)_and_(max-height:46rem)]:size-7",
                key === todayIso && "ring-2 ring-foreground",
                due && !isPast && "bg-gold font-semibold text-gold-foreground",
                due && isPast && "bg-destructive font-semibold text-white",
                selected === key && "outline-2 outline-offset-2 outline-foreground",
                !due && "text-foreground/70",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-3 border-t pt-3 lg:mt-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pt-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase">
          {selected ? t("home.dueThatDay") : overdue > 0 ? t("home.upcomingOverdue", { count: overdue }) : t("home.upcoming")}
        </h3>
        {listed.length === 0 ? (
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
          </ul>
        )}
      </div>
    </section>
  );
}
