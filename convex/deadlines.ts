import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { viewerOwner } from "./access";
import { isoDateAt, nowMs } from "./clock";
import { GENERAL_DATES } from "./generalDates";
import { ownerLang, queuePush, type Lang } from "./push";
import { logEvent } from "./events";

// Deadline reminders (Step 4 brief, Section 5). Three sources, one list:
// open cases with a deadline, general form due dates (generalDates.ts), and
// compliance events from the owner's Google Calendar (Person B's
// calendarCompliance.ts). Reminders go out 7 and 2 days before, on the day,
// and 1 day after (open cases only), once each (sentLog), by the demo clock.

export type UpcomingItem = {
  key: string;
  date: string; // ISO date
  title: string; // English; docType or form lets the UI translate it
  source: "case" | "general" | "calendar";
  caseId?: string;
  link?: string;
  docType?: string;
  form?: string;
  amountDue?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

async function collectItems(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<"owners">,
  fromIso: string,
  toIso: string,
): Promise<UpcomingItem[]> {
  const items: UpcomingItem[] = [];
  const cases = await ctx.db
    .query("cases")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const c of cases) {
    if (c.status === "resolved" || !c.deadline || c.deadline < fromIso || c.deadline > toIso) continue;
    items.push({
      key: `case|${c._id}`,
      date: c.deadline,
      title: c.title,
      source: "case",
      caseId: c._id,
      docType: c.docType,
      amountDue: c.amountDue,
    });
  }
  for (const g of GENERAL_DATES) {
    if (g.date < fromIso || g.date > toIso) continue;
    items.push({
      key: g.key,
      date: g.date,
      title: `Form ${g.form} due (${g.period})`,
      source: "general",
      link: g.link,
      form: g.form,
    });
  }
  const calendar = await ctx.runQuery(internal.calendarCompliance.list, { ownerId, fromIso, toIso });
  for (const e of calendar) {
    items.push({ key: `calendar|${e.key}`, date: e.date, title: e.title, source: "calendar", link: e.link });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** The signed-in owner's deadlines between two ISO dates (Person B's Upcoming panel uses it too). */
export const upcoming = query({
  args: { fromIso: v.string(), toIso: v.string() },
  handler: async (ctx, { fromIso, toIso }): Promise<UpcomingItem[]> => {
    const owner = await viewerOwner(ctx);
    if (!owner) return [];
    return await collectItems(ctx, owner._id, fromIso, toIso);
  },
});

// ---------- Reminders ----------

// Days relative to the due date. +1 (overdue) only for cases still open.
const OFFSETS = [-7, -2, 0, 1] as const;
const LOOKBACK_DAYS = 90;

const shiftIso = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / DAY_MS);

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  tr: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
};
function shortDate(iso: string, lang: Lang): string {
  const [, m, d] = iso.split("-").map(Number);
  return lang === "en" ? `${MONTHS.en[m - 1]} ${d}` : `${d} ${MONTHS[lang][m - 1]}`;
}
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "su aviso del IRS (CP14)", "Formulario 941", or the calendar event's title. */
function itemName(item: UpcomingItem, lang: Lang): string {
  if (item.source === "general") {
    return { en: `Form ${item.form}`, es: `Formulario ${item.form}`, tr: `${item.form} formu` }[lang];
  }
  if (item.source === "calendar") return item.title;
  const code = item.docType?.startsWith("IRS_") ? item.docType.slice(4) : undefined;
  if (item.docType === "COUNTY_HEALTH_INSPECTION") {
    return { en: "your health inspection", es: "su inspección de salud", tr: "sağlık denetiminiz" }[lang];
  }
  return code
    ? { en: `your IRS notice (${code})`, es: `su aviso del IRS (${code})`, tr: `IRS bildiriminiz (${code})` }[lang]
    : { en: "your letter", es: "su carta", tr: "mektubunuz" }[lang];
}

/** "vence en 2 días", "vence hoy", "venció hace 1 día", or "vence el 2 de nov." for far dates. */
function whenText(days: number, iso: string, lang: Lang): string {
  if (days === 0) return { en: "is due today", es: "vence hoy", tr: "son gün bugün" }[lang];
  if (days === 1) return { en: "is due tomorrow", es: "vence mañana", tr: "son gün yarın" }[lang];
  if (days > 1 && days <= 7) return { en: `is due in ${days} days`, es: `vence en ${days} días`, tr: `${days} gün içinde son gün` }[lang];
  if (days < 0) {
    const n = -days;
    return {
      en: `was due ${n} day${n === 1 ? "" : "s"} ago`,
      es: `venció hace ${n} día${n === 1 ? "" : "s"}`,
      tr: `${n} gün önce son gündü`,
    }[lang];
  }
  const date = shortDate(iso, lang);
  return { en: `is due ${date}`, es: `vence el ${date}`, tr: `son gün ${date}` }[lang];
}

function reminderLine(item: UpcomingItem, todayIso: string, lang: Lang): string {
  const name = itemName(item, lang);
  const line = `${name} ${whenText(daysBetween(todayIso, item.date), item.date, lang)}`;
  const withAmount = item.amountDue !== undefined ? `${line}: ${usd(item.amountDue)}` : line;
  return withAmount.charAt(0).toUpperCase() + withAmount.slice(1);
}

/**
 * Sends every reminder due by the owner's demo clock that isn't in sentLog.
 * Several at once (after a clock skip) become one combined push.
 */
export const sendDue = internalMutation({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => {
    const owner = await ctx.db.get(ownerId);
    if (!owner) return null;
    const now = await nowMs(ctx, ownerId);
    const todayIso = isoDateAt(now);
    // Items whose reminders could be due: up to 7 days ahead, and back far enough
    // that a clock skip still fires the reminders it jumped over.
    const items = await collectItems(ctx, ownerId, shiftIso(todayIso, -LOOKBACK_DAYS), shiftIso(todayIso, 7));

    const due: UpcomingItem[] = [];
    for (const item of items) {
      let any = false;
      for (const offset of OFFSETS) {
        if (offset > 0 && item.source !== "case") continue;
        if (shiftIso(item.date, offset) > todayIso) continue;
        const key = `deadline|${item.key}|${offset}`;
        const sent = await ctx.db
          .query("sentLog")
          .withIndex("by_owner_and_key", (q) => q.eq("ownerId", ownerId).eq("key", key))
          .first();
        if (sent) continue;
        await ctx.db.insert("sentLog", { ownerId, key, sentAt: now });
        any = true;
      }
      if (any) due.push(item);
    }
    if (due.length === 0) return null;

    const lang = ownerLang(owner);
    const lines = due.map((i) => reminderLine(i, todayIso, lang));
    const label = { en: "Reminder", es: "Recordatorio", tr: "Hatırlatma" }[lang];
    const labelMany = { en: "Reminders", es: "Recordatorios", tr: "Hatırlatmalar" }[lang];
    const body = lines.length === 1 ? `${label}: ${lines[0]}.` : `${labelMany}: ${lines.join(" · ")}.`;
    const enLines = due.map((i) => reminderLine(i, todayIso, "en"));
    const single: Doc<"cases"> | null =
      due.length === 1 && due[0].caseId ? await ctx.db.get(due[0].caseId as Id<"cases">) : null;

    await queuePush(ctx, owner, "deadline_reminder", single, null, {
      text: { title: lines.length === 1 ? label : labelMany, body, summary: `Deadline reminder: ${enLines.join("; ")}` },
      url: single ? `/?case=${single._id}` : "/",
      tag: "ledger-deadlines",
    });
    await logEvent(ctx, {
      ownerId,
      caseId: single?._id,
      type: "deadline_reminder",
      summary: `Sent ${due.length} deadline reminder${due.length === 1 ? "" : "s"}: ${enLines.join("; ")}`,
    });
    return null;
  },
});

/** Contract (Section 7): internal action, so the demo clock and the cron can schedule it. */
export const runDue = internalAction({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => {
    await ctx.runMutation(internal.deadlines.sendDue, { ownerId });
    return null;
  },
});

/** Hourly (crons.ts): every owner's due reminders. */
export const runDueAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const owner of await ctx.db.query("owners").collect()) {
      await ctx.scheduler.runAfter(0, internal.deadlines.runDue, { ownerId: owner._id });
    }
    return null;
  },
});
