import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { viewerOwner } from "./access";
import { isoDateAt, nowMs } from "./clock";
import { GENERAL_DATES } from "./generalDates";
import { ownerLang, queuePush, shortDate, type Lang } from "./push";
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

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "su aviso del IRS (CP14)", "Formulario 941", "您的 IRS 通知 (CP14)", or the calendar event's title. */
function itemName(item: UpcomingItem, lang: Lang): string {
  if (item.source === "general") {
    const f = item.form;
    return { en: `Form ${f}`, es: `Formulario ${f}`, zh: `${f} 表格`, vi: `Mẫu ${f}`, ko: `${f} 양식` }[lang];
  }
  if (item.source === "calendar") return item.title;
  const code = item.docType?.startsWith("IRS_") ? item.docType.slice(4) : undefined;
  if (item.docType === "COUNTY_HEALTH_INSPECTION") {
    return {
      en: "your health inspection",
      es: "su inspección de salud",
      zh: "您的卫生检查",
      vi: "đợt kiểm tra vệ sinh của bạn",
      ko: "위생 점검",
    }[lang];
  }
  return code
    ? {
        en: `your IRS notice (${code})`,
        es: `su aviso del IRS (${code})`,
        zh: `您的 IRS 通知 (${code})`,
        vi: `thông báo IRS (${code}) của bạn`,
        ko: `IRS 통지서(${code})`,
      }[lang]
    : { en: "your letter", es: "su carta", zh: "您的来信", vi: "thư của bạn", ko: "편지" }[lang];
}

/**
 * The whole line for one item: "su aviso del IRS (CP14) vence en 2 días",
 * "您的 IRS 通知 (CP14) 将在 2 天后到期", "IRS 통지서(CP14) 마감이 2일 남았습니다".
 * Far dates read "vence el 2 nov".
 */
function whenLine(name: string, days: number, iso: string, lang: Lang): string {
  const date = shortDate(iso, lang);
  const n = Math.abs(days);
  if (days === 0) {
    return { en: `${name} is due today`, es: `${name} vence hoy`, zh: `${name}今天到期`, vi: `${name} đến hạn hôm nay`, ko: `${name} 마감이 오늘입니다` }[lang];
  }
  if (days === 1) {
    return { en: `${name} is due tomorrow`, es: `${name} vence mañana`, zh: `${name}明天到期`, vi: `${name} đến hạn ngày mai`, ko: `${name} 마감이 내일입니다` }[lang];
  }
  if (days > 1 && days <= 7) {
    return {
      en: `${name} is due in ${n} days`,
      es: `${name} vence en ${n} días`,
      zh: `${name}将在 ${n} 天后到期`,
      vi: `${name} đến hạn sau ${n} ngày`,
      ko: `${name} 마감이 ${n}일 남았습니다`,
    }[lang];
  }
  if (days < 0) {
    return {
      en: `${name} was due ${n} day${n === 1 ? "" : "s"} ago`,
      es: `${name} venció hace ${n} día${n === 1 ? "" : "s"}`,
      zh: `${name}已逾期 ${n} 天`,
      vi: `${name} đã quá hạn ${n} ngày`,
      ko: `${name} 마감이 ${n}일 지났습니다`,
    }[lang];
  }
  return { en: `${name} is due ${date}`, es: `${name} vence el ${date}`, zh: `${name}${date}到期`, vi: `${name} đến hạn ${date}`, ko: `${name} 마감은 ${date}입니다` }[lang];
}

function reminderLine(item: UpcomingItem, todayIso: string, lang: Lang): string {
  const line = whenLine(itemName(item, lang), daysBetween(todayIso, item.date), item.date, lang);
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
    const label = { en: "Reminder", es: "Recordatorio", zh: "提醒", vi: "Lời nhắc", ko: "알림" }[lang];
    const labelMany = { en: "Reminders", es: "Recordatorios", zh: "提醒", vi: "Các lời nhắc", ko: "알림" }[lang];
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
