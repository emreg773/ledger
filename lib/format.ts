// Numbers and dates for the UI, in the owner's locale. The model never formats
// numbers for the UI; it all goes through here.

const LOCALES: Record<string, string> = {
  es: "es-US",
  en: "en-US",
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

/**
 * Days until a deadline. Returns the localized "in 9 days" / "tomorrow" /
 * "today", or overdue: true (the caller shows its own translated "Overdue").
 */
export function countdown(
  iso: string,
  language: string,
  today: Date, // midnight, from useToday()
): { overdue: boolean; label: string } {
  const days = Math.round((parseIsoDate(iso).getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { overdue: true, label: "" };
  const rtf = new Intl.RelativeTimeFormat(localeFor(language), { numeric: "auto" });
  return { overdue: false, label: rtf.format(days, "day") };
}
