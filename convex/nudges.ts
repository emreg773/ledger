import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { complianceEvents } from "./calendarCompliance";
import { isoDateAt, nowMs } from "./clock";
import { logEvent } from "./events";
import { ownerLang, queuePush, shortDate, type Lang } from "./push";

// Telegram nudges: the only notifications Ledger starts on its own (web push
// is off, see push.ts). By each owner's demo clock, at most one Telegram
// message per demo day, listing everything waiting on the owner.
//
// What triggers one:
// - A case with a proposed action (approve, reject or mark done) escalates in
//   three levels, each sent once:
//     1 friendly:  2 days after the case opened
//     2 direct:    7 days before the deadline, or 7 days after opening if it has none
//     3 last call: 1 day before the deadline (or later)
//   A clock skip past several levels sends only the highest. No case is nudged
//   in its first day: the owner just saw it in the app.
// - A letter Ledger read that the owner hasn't opened in the app for 24 hours.
// - A compliance event on the owner's Google Calendar (calendarCompliance.ts):
//   nothing to approve, so only the deadline levels, 2 at 7 days before and 3
//   at 1 day before. Listed only within those 7 days; gone once the date passes.
//
// Never about suspicious letters. An item drops out as soon as its actions are
// approved, rejected or done, or its case is resolved. Owners without a linked
// Telegram chat get nothing (and nothing is marked sent, so linking later works).

const DAY_MS = 24 * 60 * 60 * 1000;

type Level = 0 | 1 | 2 | 3;

type Item = {
  key: string; // sentLog prefix: "nudge|case|<caseId>" or "nudge|calendar|<googleId>|<date>"
  c?: Doc<"cases">;
  eventTitle?: string; // a calendar item: the event's title, as the owner wrote it
  date?: string; // the deadline or the event's date
  decision: boolean; // has a proposed action waiting on the owner
  level: Level; // the escalation level today (0: none yet)
  newLevel: boolean; // level is above what was already sent
  unopened?: Id<"documents">; // a read letter of this case, unopened for 24 hours, not nudged yet
};

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / DAY_MS);

function levelOf(c: Doc<"cases">, now: number, todayIso: string): Level {
  const daysOpen = Math.floor((now - (c.startedAt ?? c.createdAt)) / DAY_MS);
  if (daysOpen < 1) return 0;
  if (c.deadline) {
    const left = daysBetween(todayIso, c.deadline);
    if (left <= 1) return 3;
    if (left <= 7) return 2;
  } else if (daysOpen >= 7) {
    return 2;
  }
  return daysOpen >= 2 ? 1 : 0;
}

async function wasSent(ctx: QueryCtx, ownerId: Id<"owners">, key: string) {
  return Boolean(
    await ctx.db
      .query("sentLog")
      .withIndex("by_owner_and_key", (q) => q.eq("ownerId", ownerId).eq("key", key))
      .first(),
  );
}

async function markSent(ctx: MutationCtx, ownerId: Id<"owners">, key: string, now: number) {
  if (!(await wasSent(ctx, ownerId, key))) await ctx.db.insert("sentLog", { ownerId, key, sentAt: now });
}

async function sentLevelOf(ctx: QueryCtx, ownerId: Id<"owners">, key: string) {
  for (const l of [3, 2, 1]) {
    if (await wasSent(ctx, ownerId, `${key}|${l}`)) return l;
  }
  return 0;
}

const shiftIso = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Everything waiting on the owner today, with what's new since the last nudge. */
async function waitingItems(ctx: QueryCtx, ownerId: Id<"owners">, now: number, todayIso: string) {
  const items = new Map<string, Item>();
  const nudgeable = (c: Doc<"cases"> | null): c is Doc<"cases"> =>
    Boolean(c && c.ownerId === ownerId && c.status !== "resolved" && c.verification?.verdict !== "suspicious");

  const cases = await ctx.db
    .query("cases")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const c of cases) {
    if (!nudgeable(c)) continue;
    const pending = await ctx.db
      .query("actions")
      .withIndex("by_case", (q) => q.eq("caseId", c._id))
      .filter((q) => q.eq(q.field("status"), "proposed"))
      .first();
    if (!pending) continue;
    const key = `nudge|case|${c._id}`;
    const level = levelOf(c, now, todayIso);
    const sentLevel = await sentLevelOf(ctx, ownerId, key);
    items.set(key, { key, c, date: c.deadline, decision: true, level, newLevel: level > sentLevel });
  }

  // Letters read at least a day ago that the owner never opened. Only rows with
  // extractedAt: older letters predate open tracking.
  const read = await ctx.db
    .query("documents")
    .withIndex("by_owner_and_status", (q) => q.eq("ownerId", ownerId).eq("status", "extracted"))
    .collect();
  for (const doc of read) {
    if (doc.openedAt !== undefined || doc.extractedAt === undefined || !doc.caseId) continue;
    if (now - doc.extractedAt < DAY_MS) continue;
    if (await wasSent(ctx, ownerId, `nudge|unopened|${doc._id}`)) continue;
    const existing = items.get(`nudge|case|${doc.caseId}`);
    if (existing) {
      existing.unopened = doc._id;
      continue;
    }
    const c = await ctx.db.get(doc.caseId);
    if (!nudgeable(c)) continue;
    const key = `nudge|case|${c._id}`;
    items.set(key, { key, c, date: c.deadline, decision: false, level: 0, newLevel: false, unopened: doc._id });
  }

  // Compliance events on the owner's Google Calendar in the next 7 days.
  for (const e of await complianceEvents(ctx, ownerId, todayIso, shiftIso(todayIso, 7))) {
    const key = `nudge|calendar|${e.key}`;
    const level: Level = daysBetween(todayIso, e.date) <= 1 ? 3 : 2;
    const sentLevel = await sentLevelOf(ctx, ownerId, key);
    items.set(key, { key, eventTitle: e.title, date: e.date, decision: false, level, newLevel: level > sentLevel });
  }
  return [...items.values()];
}

// ---------- Text ----------
// Plain text for Telegram. Facts only from the case: the letter's friendly
// name, the amount and the deadline. Never an identifier or the letter's text.

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "su aviso del IRS (CP14)", "您的卫生检查", "your letter". */
function caseName(docType: string, lang: Lang): string {
  if (docType === "COUNTY_HEALTH_INSPECTION") {
    return {
      en: "your health inspection",
      es: "su inspección de salud",
      zh: "您的卫生检查",
      vi: "đợt kiểm tra vệ sinh của bạn",
      ko: "위생 점검",
      tr: "sağlık denetiminiz",
    }[lang];
  }
  const code = docType.startsWith("IRS_") ? docType.slice(4) : undefined;
  return code
    ? {
        en: `your IRS notice (${code})`,
        es: `su aviso del IRS (${code})`,
        zh: `您的 IRS 通知 (${code})`,
        vi: `thông báo IRS (${code}) của bạn`,
        ko: `IRS 통지서(${code})`,
        tr: `IRS bildiriminiz (${code})`,
      }[lang]
    : { en: "your letter", es: "su carta", zh: "您的来信", vi: "thư của bạn", ko: "편지", tr: "mektubunuz" }[lang];
}

/**
 * "su aviso del IRS (CP14) vence en 2 días", "您的 IRS 通知 (CP14) 将在 2 天后到期",
 * "IRS 통지서(CP14) 마감이 2일 남았습니다". Far dates read "vence el 2 nov".
 */
function whenLine(name: string, days: number, iso: string, lang: Lang): string {
  const date = shortDate(iso, lang);
  const n = Math.abs(days);
  if (days === 0) {
    return { en: `${name} is due today`, es: `${name} vence hoy`, zh: `${name}今天到期`, vi: `${name} đến hạn hôm nay`, ko: `${name} 마감이 오늘입니다`, tr: `${name}: son gün bugün` }[lang];
  }
  if (days === 1) {
    return { en: `${name} is due tomorrow`, es: `${name} vence mañana`, zh: `${name}明天到期`, vi: `${name} đến hạn ngày mai`, ko: `${name} 마감이 내일입니다`, tr: `${name}: son gün yarın` }[lang];
  }
  if (days > 1 && days <= 7) {
    return {
      en: `${name} is due in ${n} days`,
      es: `${name} vence en ${n} días`,
      zh: `${name}将在 ${n} 天后到期`,
      vi: `${name} đến hạn sau ${n} ngày`,
      ko: `${name} 마감이 ${n}일 남았습니다`,
      tr: `${name}: son güne ${n} gün kaldı`,
    }[lang];
  }
  if (days < 0) {
    return {
      en: `${name} was due ${n} day${n === 1 ? "" : "s"} ago`,
      es: `${name} venció hace ${n} día${n === 1 ? "" : "s"}`,
      zh: `${name}已逾期 ${n} 天`,
      vi: `${name} đã quá hạn ${n} ngày`,
      ko: `${name} 마감이 ${n}일 지났습니다`,
      tr: `${name}: son gün ${n} gün önce geçti`,
    }[lang];
  }
  return { en: `${name} is due ${date}`, es: `${name} vence el ${date}`, zh: `${name}${date}到期`, vi: `${name} đến hạn ${date}`, ko: `${name} 마감은 ${date}입니다`, tr: `${name}: son gün ${date}` }[lang];
}

const REASONS = {
  decision: { en: "needs your decision", es: "necesita su decisión", zh: "需要您决定", vi: "cần bạn quyết định", ko: "결정이 필요합니다", tr: "kararınızı bekliyor" },
  unopened: { en: "you haven't opened it yet", es: "aún no lo ha abierto", zh: "您还没有打开", vi: "bạn chưa mở", ko: "아직 열어보지 않았습니다", tr: "henüz açmadınız" },
  calendar: { en: "on your calendar", es: "en su calendario", zh: "在您的日历上", vi: "trong lịch của bạn", ko: "캘린더 일정", tr: "takviminizde" },
} satisfies Record<string, Record<Lang, string>>;

// By the highest level in the message. An unopened letter alone reads as friendly.
const HEADERS: Record<1 | 2 | 3, Record<Lang, string>> = {
  1: {
    en: "Hi {name}, a few things in Ledger are waiting for you:",
    es: "Hola, {name}. Tiene algunos pendientes en Ledger:",
    zh: "{name}，您好！Ledger 里有几件事在等您处理：",
    vi: "Chào {name}, có vài việc trong Ledger đang chờ bạn:",
    ko: "{name}님, Ledger에서 확인을 기다리는 일이 있습니다:",
    tr: "Merhaba {name}, Ledger'da sizi bekleyen birkaç şey var:",
  },
  2: {
    en: "{name}, these need your attention soon:",
    es: "{name}, esto necesita su atención pronto:",
    zh: "{name}，以下事项需要您尽快处理：",
    vi: "{name}, những việc này cần bạn xử lý sớm:",
    ko: "{name}님, 곧 처리해야 할 일이 있습니다:",
    tr: "{name}, bunlarla yakında ilgilenmeniz gerekiyor:",
  },
  3: {
    en: "Last call, {name}: a deadline is about to pass.",
    es: "Último aviso, {name}: un plazo está por vencer.",
    zh: "{name}，最后提醒：有一项期限即将到期。",
    vi: "Nhắc lần cuối, {name}: sắp hết hạn.",
    ko: "{name}님, 마지막 알림입니다: 마감이 임박했습니다.",
    tr: "Son çağrı, {name}: bir son tarih geçmek üzere.",
  },
};

// The notification center's headline.
const TITLES: Record<1 | 2 | 3, Record<Lang, string>> = {
  1: { en: "Don't forget", es: "No lo olvide", zh: "别忘了", vi: "Đừng quên", ko: "잊지 마세요", tr: "Unutmayın" },
  2: { en: "Needs your attention", es: "Necesita su atención", zh: "需要您处理", vi: "Cần bạn xử lý", ko: "확인이 필요합니다", tr: "İlginizi bekliyor" },
  3: { en: "Last call", es: "Último aviso", zh: "最后提醒", vi: "Nhắc lần cuối", ko: "마지막 알림", tr: "Son çağrı" },
};

const OPEN = { en: "Open Ledger:", es: "Abra Ledger:", zh: "打开 Ledger：", vi: "Mở Ledger:", ko: "Ledger 열기:", tr: "Ledger'ı açın:" };

function itemLine(item: Item, todayIso: string, lang: Lang): string {
  const { c, date } = item;
  const name = c ? caseName(c.docType, lang) : `"${item.eventTitle}"`;
  let line = date ? whenLine(name, daysBetween(todayIso, date), date, lang) : name;
  if (c?.amountDue !== undefined) line += `: ${usd(c.amountDue)}`;
  line += ` (${REASONS[item.decision ? "decision" : c ? "unopened" : "calendar"][lang]})`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

// ---------- Sending ----------

/** New since the last nudge: a higher level, or a letter unopened for a day. */
const isDue = (i: Item) => (i.newLevel && i.level > 0) || Boolean(i.unopened);

/** Sends today's nudge for one owner, if anything new is due and none went out today. */
export const sendDue = internalMutation({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => {
    const owner = await ctx.db.get(ownerId);
    if (!owner?.telegramChatId) return null;
    const now = await nowMs(ctx, ownerId);
    const todayIso = isoDateAt(now);
    const dayKey = `nudge|day|${todayIso}`;
    if (await wasSent(ctx, ownerId, dayKey)) return null;

    const items = await waitingItems(ctx, ownerId, now, todayIso);
    const due = items.filter(isDue);
    if (due.length === 0) return null;

    await markSent(ctx, ownerId, dayKey, now);
    for (const item of due) {
      // Levels a clock skip jumped over count as sent too.
      for (let l = 1; l <= item.level; l++) await markSent(ctx, ownerId, `${item.key}|${l}`, now);
      if (item.unopened) await markSent(ctx, ownerId, `nudge|unopened|${item.unopened}`, now);
    }

    const level = Math.max(1, ...due.map((i) => i.level)) as 1 | 2 | 3;
    const lang = ownerLang(owner);
    // Every waiting item, nearest deadline first; no deadline last.
    const listed = items.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
    const only = listed.length === 1 ? listed[0].c : undefined;
    const lines = listed.map((i) => `• ${itemLine(i, todayIso, lang)}`);
    const site = process.env.SITE_URL ?? "";
    const link = only ? `${site}/?case=${only._id}` : site;
    const header = HEADERS[level][lang].replace("{name}", owner.name.split(" ")[0]);
    const body = `${header}\n\n${lines.join("\n")}`;
    const summary = `Telegram nudge (level ${level}): ${listed.map((i) => itemLine(i, todayIso, "en")).join("; ")}`;

    // Kept in the notification center too; delivery is the Telegram message.
    await queuePush(ctx, owner, "nudge", only ?? null, null, {
      deliver: "history_only",
      text: { title: TITLES[level][lang], body, summary },
    });
    await ctx.scheduler.runAfter(0, internal.telegram.sendMessage, {
      ownerId,
      text: site ? `${body}\n\n${OPEN[lang]} ${link}` : body,
    });
    await logEvent(ctx, {
      ownerId,
      caseId: only?._id,
      type: "nudge_sent",
      summary,
    });
    return null;
  },
});

/**
 * What today's nudge would hold, without sending it. Internal only:
 * npx convex run nudges:preview '{"ownerId": "..."}'
 */
export const preview = internalQuery({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => {
    const owner = await ctx.db.get(ownerId);
    if (!owner) return null;
    const now = await nowMs(ctx, ownerId);
    const todayIso = isoDateAt(now);
    const items = await waitingItems(ctx, ownerId, now, todayIso);
    return {
      today: todayIso,
      telegramLinked: Boolean(owner.telegramChatId),
      alreadySentToday: await wasSent(ctx, ownerId, `nudge|day|${todayIso}`),
      items: items.map((i) => ({
        key: i.key,
        line: itemLine(i, todayIso, "en"),
        level: i.level,
        due: isDue(i),
      })),
    };
  },
});

/** For the demo clock: runs right after a skip. */
export const runDue = internalAction({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) => {
    await ctx.runMutation(internal.nudges.sendDue, { ownerId });
    return null;
  },
});

/** Hourly (crons.ts): every owner with Telegram linked. */
export const runDueAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const owner of await ctx.db.query("owners").collect()) {
      if (owner.telegramChatId) await ctx.scheduler.runAfter(0, internal.nudges.runDue, { ownerId: owner._id });
    }
    return null;
  },
});
