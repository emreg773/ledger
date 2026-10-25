import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { notificationCategory } from "./schema";
import { requireOwner, viewerOwner } from "./access";
import { MIN_CONFIDENCE } from "./extraction";

// Web push (Step 3 brief, Section 7). Track B's service worker subscribes and
// calls saveSubscription; Track A sends every push (notifyOwner → pushNode.send).
//
// Web push is OFF for now (WEB_PUSH below): notifications are Telegram nudges
// (nudges.ts), and queuePush only records them for the notification center.
// Everything else stays so it can come back: the subscriptions table, these
// mutations, pushNode.ts, public/sw.js, lib/push.ts (usePush) and the VAPID
// keys. To bring it back, set WEB_PUSH to true and put usePush back in the UI.
const WEB_PUSH = false;

export const pushKind = v.union(
  v.literal("document_read"),
  v.literal("action_needed"),
  v.literal("action_done"),
  v.literal("document_failed"),
  v.literal("test"),
  // Step 4. Its text comes from the caller (queuePush's `text` option).
  v.literal("nudge"), // nudges.ts
);

/** Upserts by endpoint. A browser that was another owner's (a shared device) moves to this one. */
export const saveSubscription = mutation({
  args: {
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, { endpoint, keys, userAgent }) => {
    const owner = await requireOwner(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ownerId: owner._id, keys, userAgent });
    } else {
      await ctx.db.insert("pushSubscriptions", {
        ownerId: owner._id,
        endpoint,
        keys,
        userAgent,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

export const removeSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const owner = await requireOwner(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing && existing.ownerId === owner._id) await ctx.db.delete(existing._id);
    return null;
  },
});

/** For "Notifications on". 0 when signed out. */
export const mySubscriptionCount = query({
  args: {},
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    if (!owner) return 0;
    const subs = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .collect();
    return subs.length;
  },
});

/** Sends "Notifications are on" to the caller's devices. */
export const sendTest = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    await queuePush(ctx, owner, "test", null, null);
    return null;
  },
});

/** Builds the message for an owner and sends it to their devices. Track A's triggers only. */
export const notifyOwner = internalMutation({
  args: {
    ownerId: v.id("owners"),
    kind: pushKind,
    caseId: v.optional(v.id("cases")),
    actionId: v.optional(v.id("actions")),
  },
  handler: async (ctx, { ownerId, kind, caseId, actionId }) => {
    const owner = await ctx.db.get(ownerId);
    if (!owner) return null;
    const c = caseId ? await ctx.db.get(caseId) : null;
    const action = actionId ? await ctx.db.get(actionId) : null;
    await queuePush(
      ctx,
      owner,
      kind,
      c && c.ownerId === ownerId ? c : null,
      action && action.ownerId === ownerId ? action : null,
    );
    return null;
  },
});

export const subscriptionsFor = internalQuery({
  args: { ownerId: v.id("owners") },
  handler: async (ctx, { ownerId }) =>
    await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect(),
});

export const deleteSubscription = internalMutation({
  args: { subscriptionId: v.id("pushSubscriptions") },
  handler: async (ctx, { subscriptionId }) => {
    if (await ctx.db.get(subscriptionId)) await ctx.db.delete(subscriptionId);
  },
});

// ---------- Messages ----------
// Facts only from the case and the action: the friendly document name, the
// amount, the deadline, the verdict, the last 4 of the account. Never an SSN,
// EIN, full account number or the letter's text: pushes cross Google's and
// Apple's servers and show on lock screens.

export type PushKind = Infer<typeof pushKind>;
export type Lang = "en" | "es" | "zh" | "vi" | "ko" | "tr";
const PUSH_LANGS: readonly string[] = ["en", "es", "zh", "vi", "ko", "tr"];

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** "Nov 2", "2 nov", "11月2日", "2 thg 11", "11월 2일", "2 Kas". */
export function shortDate(iso: string, lang: Lang): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  switch (lang) {
    case "en":
      return `${MONTHS_EN[m - 1]} ${d}`;
    case "es":
      return `${d} ${MONTHS_ES[m - 1]}`;
    case "zh":
      return `${m}月${d}日`;
    case "vi":
      return `${d} thg ${m}`;
    case "ko":
      return `${m}월 ${d}일`;
    case "tr":
      return `${d} ${MONTHS_TR[m - 1]}`;
  }
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function docName(c: Doc<"cases"> | null, lang: Lang): string {
  const isIrs = c?.docType.startsWith("IRS_");
  const isInspection = c?.docType === "COUNTY_HEALTH_INSPECTION";
  return {
    en: isIrs ? "IRS letter" : isInspection ? "health inspection" : "letter",
    es: isIrs ? "carta del IRS" : isInspection ? "inspección de salud" : "carta",
    zh: isIrs ? "IRS 来信" : isInspection ? "卫生检查报告" : "来信",
    vi: isIrs ? "thư của IRS" : isInspection ? "biên bản kiểm tra vệ sinh" : "thư",
    ko: isIrs ? "IRS 편지" : isInspection ? "위생 점검 보고서" : "편지",
    tr: isIrs ? "IRS mektubunuzu" : isInspection ? "sağlık denetiminizi" : "mektubunuzu",
  }[lang];
}

/** "Ledger read your IRS letter: it's already paid", or with the amount and deadline. */
function readLine(c: Doc<"cases"> | null, lang: Lang): string {
  const name = docName(c, lang);
  const lead = {
    en: `Ledger read your ${name}`,
    es: `Ledger leyó su ${name}`,
    zh: `Ledger 已读取您的${name}`,
    vi: `Ledger đã đọc ${name} của bạn`,
    ko: `Ledger가 ${name}을(를) 읽었습니다`,
    tr: `Ledger ${name} okudu`,
  }[lang];
  if (c?.verification?.verdict === "suspicious") {
    return `${lead}: ${{ en: "it looks like a scam. Don't pay.", es: "parece una estafa. No pague.", zh: "这看起来是诈骗，请不要付款。", vi: "có vẻ là lừa đảo. Đừng thanh toán.", ko: "사기로 보입니다. 돈을 내지 마세요.", tr: "dolandırıcılık gibi görünüyor. Ödeme yapmayın." }[lang]}`;
  }
  if (c?.bankCheck && c.bankCheck.matches.length > 0) {
    return `${lead}: ${{ en: "it's already paid", es: "ya está pagada", zh: "已经付过了", vi: "đã được thanh toán rồi", ko: "이미 납부되었습니다", tr: "zaten ödenmiş" }[lang]}`;
  }
  const facts: string[] = [];
  if (c?.amountDue !== undefined) facts.push(usd(c.amountDue));
  if (c?.deadline) {
    const date = shortDate(c.deadline, lang);
    facts.push({ en: `due ${date}`, es: `vence el ${date}`, zh: `${date}到期`, vi: `hạn ${date}`, ko: `마감 ${date}`, tr: `son gün ${date}` }[lang]);
  }
  return facts.length > 0 ? `${lead}: ${facts.join(", ")}` : lead;
}

function message(
  kind: PushKind,
  lang: Lang,
  c: Doc<"cases"> | null,
  action: Doc<"actions"> | null,
): { body: string; summary: string } {
  switch (kind) {
    case "document_read":
      return { body: readLine(c, lang), summary: readLine(c, "en") };
    case "action_needed": {
      const next = { en: "Tap to review the next step.", es: "Toque para revisar el siguiente paso.", zh: "点按查看下一步。", vi: "Nhấn để xem bước tiếp theo.", ko: "눌러서 다음 단계를 확인하세요.", tr: "Sonraki adımı görmek için dokunun." }[lang];
      return { body: `${readLine(c, lang)}. ${next}`, summary: `${readLine(c, "en")} (action needed)` };
    }
    case "action_done": {
      if (action?.status === "executed" && action.type === "pay_bill") {
        const r = action.result as { amount: number; accountLast4: string };
        const body = {
          en: `Paid ${usd(r.amount)} from the account ending ${r.accountLast4}.`,
          es: `Pagado: ${usd(r.amount)} de la cuenta que termina en ${r.accountLast4}.`,
          zh: `已从尾号 ${r.accountLast4} 的账户支付 ${usd(r.amount)}。`,
          vi: `Đã thanh toán ${usd(r.amount)} từ tài khoản có đuôi ${r.accountLast4}.`,
          ko: `끝자리 ${r.accountLast4} 계좌에서 ${usd(r.amount)}을(를) 납부했습니다.`,
          tr: `${usd(r.amount)}, sonu ${r.accountLast4} ile biten hesaptan ödendi.`,
        }[lang];
        return { body, summary: `Paid ${usd(r.amount)} from account ending ${r.accountLast4}` };
      }
      if (action?.status === "failed") {
        const body = {
          en: "Something didn't go through. Nothing was paid. Tap to see.",
          es: "Algo no se completó. No se pagó nada. Toque para ver.",
          zh: "有一项操作未成功，没有付款。点按查看。",
          vi: "Có việc chưa thực hiện được. Chưa có khoản nào được thanh toán. Nhấn để xem.",
          ko: "처리되지 않은 작업이 있습니다. 납부된 금액은 없습니다. 눌러서 확인하세요.",
          tr: "Bir işlem tamamlanamadı. Hiçbir ödeme yapılmadı. Görmek için dokunun.",
        }[lang];
        return { body, summary: "Action failed" };
      }
      const body = { en: "Done. Tap to see what's next.", es: "Listo. Toque para ver qué sigue.", zh: "已完成。点按查看接下来要做什么。", vi: "Xong. Nhấn để xem việc tiếp theo.", ko: "완료되었습니다. 눌러서 다음 할 일을 확인하세요.", tr: "Tamamlandı. Sırada ne olduğunu görmek için dokunun." }[lang];
      return { body, summary: "Action done" };
    }
    case "document_failed": {
      const body = {
        en: "Ledger couldn't read your document. Try a clearer photo.",
        es: "Ledger no pudo leer su documento. Intente con una foto más clara.",
        zh: "Ledger 无法读取您的文件，请换一张更清晰的照片。",
        vi: "Ledger không đọc được tài liệu của bạn. Hãy thử ảnh rõ hơn.",
        ko: "Ledger가 문서를 읽지 못했습니다. 더 선명한 사진으로 다시 시도해 주세요.",
        tr: "Ledger belgenizi okuyamadı. Daha net bir fotoğraf deneyin.",
      }[lang];
      return { body, summary: "Could not read the document" };
    }
    case "test": {
      const body = { en: "Notifications are on.", es: "Las notificaciones están activadas.", zh: "通知已开启。", vi: "Thông báo đã bật.", ko: "알림이 켜졌습니다.", tr: "Bildirimler açık." }[lang];
      return { body, summary: "Test notification" };
    }
    case "nudge": {
      // Callers pass their own text; this is only the fallback.
      const body = { en: "You have an update in Ledger.", es: "Tiene una novedad en Ledger.", zh: "Ledger 有新消息。", vi: "Bạn có cập nhật mới trong Ledger.", ko: "Ledger에 새 소식이 있습니다.", tr: "Ledger'da sizin için bir güncelleme var." }[lang];
      return { body, summary: kind };
    }
  }
}

type Category = Infer<typeof notificationCategory>;

/** The notification center's category and headline for a message. */
function heading(
  kind: Exclude<PushKind, "test">,
  lang: Lang,
  c: Doc<"cases"> | null,
  action: Doc<"actions"> | null,
): { category: Category; title: string; titleEn: string } {
  const pick = (category: Category, t: Record<Lang, string>) => ({ category, title: t[lang], titleEn: t.en });
  switch (kind) {
    case "action_needed":
      return pick("needs_action", { en: "Action needed", es: "Necesita su decisión", zh: "需要您处理", vi: "Cần bạn xử lý", ko: "확인이 필요합니다", tr: "Kararınız gerekiyor" });
    case "document_failed":
      return pick("alert", { en: "Couldn't read your document", es: "No se pudo leer su documento", zh: "无法读取您的文件", vi: "Không đọc được tài liệu", ko: "문서를 읽지 못했습니다", tr: "Belgeniz okunamadı" });
    case "document_read":
      return c?.verification?.verdict === "suspicious"
        ? pick("alert", { en: "Possible scam", es: "Posible estafa", zh: "可能是诈骗", vi: "Có thể là lừa đảo", ko: "사기 의심", tr: "Olası dolandırıcılık" })
        : pick("letter", { en: "Letter read", es: "Carta leída", zh: "信件已读取", vi: "Đã đọc thư", ko: "편지를 읽었습니다", tr: "Mektup okundu" });
    case "action_done":
      if (action?.status === "failed") {
        return pick("alert", { en: "Didn't go through", es: "No se completó", zh: "未成功", vi: "Không thành công", ko: "처리되지 않음", tr: "Tamamlanamadı" });
      }
      return action?.type === "pay_bill"
        ? pick("done", { en: "Payment made", es: "Pago realizado", zh: "已付款", vi: "Đã thanh toán", ko: "납부 완료", tr: "Ödeme yapıldı" })
        : pick("done", { en: "Done", es: "Listo", zh: "已完成", vi: "Đã xong", ko: "완료", tr: "Tamamlandı" });
    case "nudge":
      return pick("reminder", { en: "Don't forget", es: "No lo olvide", zh: "别忘了", vi: "Đừng quên", ko: "잊지 마세요", tr: "Unutmayın" });
  }
}

export type QueuePushOptions = {
  /** "history_only": record it in the notification center without a push (e.g. a Telegram message). */
  deliver?: "push" | "history_only";
  /** Text in the owner's language for kinds that build their own (nudges). */
  text?: { title?: string; body: string; summary: string };
  /** Tap target; defaults to the case, or the home screen. */
  url?: string;
  /** Replaces an older push with the same tag; defaults to the case. */
  tag?: string;
};

export function ownerLang(owner: Doc<"owners">): Lang {
  return PUSH_LANGS.includes(owner.preferredLanguage) ? (owner.preferredLanguage as Lang) : "en";
}

/** Records a notification for the notification center and pushes it to the owner's devices. */
export async function queuePush(
  ctx: MutationCtx,
  owner: Doc<"owners">,
  kind: PushKind,
  c: Doc<"cases"> | null,
  action: Doc<"actions"> | null,
  opts: QueuePushOptions = {},
) {
  const lang = ownerLang(owner);
  const { body, summary } = opts.text ?? message(kind, lang, c, action);
  const title = kind === "test" ? "Ledger" : (opts.text?.title ?? heading(kind, lang, c, action).title);

  // Keep every notification for the notification center, with or without a
  // device. Test pushes aren't worth keeping.
  if (kind !== "test") {
    const head = heading(kind, lang, c, action);
    const category = head.category;
    const titleEn = head.titleEn;
    await ctx.db.insert("notifications", {
      ownerId: owner._id,
      kind,
      category,
      title,
      body,
      caseId: c?._id,
      actionId: action?._id,
      searchText: [title, body, titleEn, summary, c?.docType.replace(/_/g, " ") ?? ""].join(" "),
      createdAt: Date.now(),
    });
  }

  const result = { title, body };
  if (!WEB_PUSH || opts.deliver === "history_only") return result;
  const hasDevice = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
    .first();
  if (!hasDevice) return result;
  await ctx.scheduler.runAfter(0, internal.pushNode.send, {
    ownerId: owner._id,
    caseId: c?._id,
    payload: {
      title: "Ledger",
      body,
      url: opts.url ?? (c ? `/?case=${c._id}` : "/"),
      tag: opts.tag ?? (c ? `case-${c._id}` : `ledger-${kind}`),
    },
    summary,
  });
  return result;
}

/**
 * Called at the end of agent.respond (Section 7 triggers):
 * - a document run: action_needed if it proposed actions, document_failed if
 *   reading failed, else document_read
 * - a follow-up to an executed or failed action: action_done
 */
export const afterAgentRun = internalMutation({
  args: {
    ownerId: v.id("owners"),
    documentId: v.optional(v.id("documents")),
    afterActionId: v.optional(v.id("actions")),
    startedAt: v.number(),
  },
  handler: async (ctx, { ownerId, documentId, afterActionId, startedAt }) => {
    const owner = await ctx.db.get(ownerId);
    if (!owner) return null;

    if (afterActionId) {
      const action = await ctx.db.get(afterActionId);
      // An owner task marked done gets no "Done" notification: its "Action
      // needed" notification shows as finished instead (notification-center.tsx).
      if (action?.type === "owner_task" && action.status === "executed") return null;
      if (action && (action.status === "executed" || action.status === "failed")) {
        await queuePush(ctx, owner, "action_done", await ctx.db.get(action.caseId), action);
      }
      return null;
    }
    if (!documentId) return null;
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.ownerId !== ownerId) return null;
    const c = doc.caseId ? await ctx.db.get(doc.caseId) : null;
    const confidence = (doc.extraction as { overallConfidence?: number } | undefined)?.overallConfidence;
    let kind: PushKind;
    if (doc.status === "failed" || (confidence !== undefined && confidence < MIN_CONFIDENCE)) {
      kind = "document_failed";
    } else {
      const proposed = c
        ? (
            await ctx.db
              .query("actions")
              .withIndex("by_case", (q) => q.eq("caseId", c._id))
              .collect()
          ).some((a) => a.createdAt >= startedAt)
        : false;
      kind = proposed ? "action_needed" : "document_read";
    }
    const sent = await queuePush(ctx, owner, kind, c, null);
    // A letter sent on Telegram gets its answer there too (Person B's telegram.ts).
    if (doc.source === "telegram") {
      await ctx.scheduler.runAfter(0, internal.telegram.notifyDocumentResult, {
        ownerId,
        documentId,
        caseId: c?._id,
        title: sent.title,
        body: sent.body,
      });
    }
    return null;
  },
});
