// Numbers and dates for the UI, in the owner's locale. The model never formats
// numbers for the UI; it all goes through here.

const LOCALES: Record<string, string> = {
  es: "es-US",
  en: "en-US",
  zh: "zh-CN",
  vi: "vi-VN",
  ko: "ko-KR",
  tr: "tr-TR",
};

export function localeFor(language: string): string {
  return LOCALES[language] ?? language;
}

export function formatMoney(amount: number, language: string): string {
  return new Intl.NumberFormat(localeFor(language), { style: "currency", currency: "USD" }).format(
    amount,
  );
}

/** "2026-11-19" is a calendar date; parse it as local midnight so it never shifts a day. */
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(iso: string, language: string): string {
  return new Intl.DateTimeFormat(localeFor(language), { dateStyle: "medium" }).format(
    parseIsoDate(iso),
  );
}

/** Short date without the year, e.g. "Oct 2" / "2 oct". */
export function formatShortDate(iso: string, language: string): string {
  return new Intl.DateTimeFormat(localeFor(language), { month: "short", day: "numeric" }).format(
    parseIsoDate(iso),
  );
}

export function formatDateTime(ms: number, language: string): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ms);
}

/** Whole days from today (midnight) to an ISO date; negative when it's past. */
export function daysUntil(iso: string, today: Date): number {
  return Math.round((parseIsoDate(iso).getTime() - today.getTime()) / 86_400_000);
}

/** "5 minutes ago", "yesterday", "3 days ago". */
export function timeAgo(ms: number, now: number, language: string): string {
  const rtf = new Intl.RelativeTimeFormat(localeFor(language), { numeric: "auto" });
  const minutes = Math.round((ms - now) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

/**
 * Days until a deadline. Returns the localized "in 9 days" / "tomorrow" /
 * "today", or overdue: true (the caller shows its own translated "Overdue").
 */
export function countdown(
  iso: string,
  language: string,
  today: Date, // midnight, from useToday()
): { overdue: boolean; label: string } {
  const days = daysUntil(iso, today);
  if (days < 0) return { overdue: true, label: "" };
  const rtf = new Intl.RelativeTimeFormat(localeFor(language), { numeric: "auto" });
  return { overdue: false, label: rtf.format(days, "day") };
}
