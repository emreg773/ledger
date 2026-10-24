import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOwner, viewerOwner } from "./access";
import { MIN_CONFIDENCE } from "./extraction";

// Web push (Step 3 brief, Section 7). Track B's service worker subscribes and
// calls saveSubscription; Track A sends every push (notifyOwner → pushNode.send).

export const pushKind = v.union(
  v.literal("document_read"),
  v.literal("action_needed"),
  v.literal("action_done"),
  v.literal("document_failed"),
  v.literal("test"),
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

type PushKind = Infer<typeof pushKind>;
type Lang = "en" | "es" | "tr";

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  tr: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
};

function shortDate(iso: string, lang: Lang): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return lang === "en" ? `${MONTHS.en[m - 1]} ${d}` : `${d} ${MONTHS[lang][m - 1]}`;
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function docName(c: Doc<"cases"> | null, lang: Lang): string {
  const isIrs = c?.docType.startsWith("IRS_");
  const isInspection = c?.docType === "COUNTY_HEALTH_INSPECTION";
  return {
    en: isIrs ? "IRS letter" : isInspection ? "health inspection" : "letter",
    es: isIrs ? "carta del IRS" : isInspection ? "inspección de salud" : "carta",
    tr: isIrs ? "IRS mektubunuzu" : isInspection ? "sağlık denetiminizi" : "mektubunuzu",
  }[lang];
}

/** "Ledger read your IRS letter: it's already paid", or with the amount and deadline. */
function readLine(c: Doc<"cases"> | null, lang: Lang): string {
  const name = docName(c, lang);
  const lead = { en: `Ledger read your ${name}`, es: `Ledger leyó su ${name}`, tr: `Ledger ${name} okudu` }[lang];
  if (c?.verification?.verdict === "suspicious") {
    return `${lead}: ${{ en: "it looks like a scam. Don't pay.", es: "parece una estafa. No pague.", tr: "dolandırıcılık gibi görünüyor. Ödeme yapmayın." }[lang]}`;
  }
  if (c?.bankCheck && c.bankCheck.matches.length > 0) {
    return `${lead}: ${{ en: "it's already paid", es: "ya está pagada", tr: "zaten ödenmiş" }[lang]}`;
  }
  const facts: string[] = [];
  if (c?.amountDue !== undefined) facts.push(usd(c.amountDue));
  if (c?.deadline) {
    const date = shortDate(c.deadline, lang);
    facts.push({ en: `due ${date}`, es: `vence el ${date}`, tr: `son gün ${date}` }[lang]);
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
      const next = { en: "Tap to review the next step.", es: "Toque para revisar el siguiente paso.", tr: "Sonraki adımı görmek için dokunun." }[lang];
      return { body: `${readLine(c, lang)}. ${next}`, summary: `${readLine(c, "en")} (action needed)` };
    }
    case "action_done": {
      if (action?.status === "executed" && action.type === "pay_bill") {
        const r = action.result as { amount: number; accountLast4: string };
        const body = {
          en: `Paid ${usd(r.amount)} from the account ending ${r.accountLast4}.`,
          es: `Pagado: ${usd(r.amount)} de la cuenta que termina en ${r.accountLast4}.`,
          tr: `${usd(r.amount)}, sonu ${r.accountLast4} ile biten hesaptan ödendi.`,
        }[lang];
        return { body, summary: `Paid ${usd(r.amount)} from account ending ${r.accountLast4}` };
      }
      if (action?.status === "failed") {
        const body = {
          en: "Something didn't go through. Nothing was paid. Tap to see.",
          es: "Algo no se completó. No se pagó nada. Toque para ver.",
          tr: "Bir işlem tamamlanamadı. Hiçbir ödeme yapılmadı. Görmek için dokunun.",
        }[lang];
        return { body, summary: "Action failed" };
      }
      const body = { en: "Done. Tap to see what's next.", es: "Listo. Toque para ver qué sigue.", tr: "Tamamlandı. Sırada ne olduğunu görmek için dokunun." }[lang];
      return { body, summary: "Action done" };
    }
    case "document_failed": {
      const body = {
        en: "Ledger couldn't read your document. Try a clearer photo.",
        es: "Ledger no pudo leer su documento. Intente con una foto más clara.",
        tr: "Ledger belgenizi okuyamadı. Daha net bir fotoğraf deneyin.",
      }[lang];
      return { body, summary: "Could not read the document" };
    }
    case "test": {
      const body = { en: "Notifications are on.", es: "Las notificaciones están activadas.", tr: "Bildirimler açık." }[lang];
      return { body, summary: "Test notification" };
    }
  }
}

async function queuePush(
  ctx: MutationCtx,
  owner: Doc<"owners">,
  kind: PushKind,
  c: Doc<"cases"> | null,
  action: Doc<"actions"> | null,
) {
  const hasDevice = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
    .first();
  if (!hasDevice) return;
  const lang: Lang = owner.preferredLanguage === "es" || owner.preferredLanguage === "tr" ? owner.preferredLanguage : "en";
  const { body, summary } = message(kind, lang, c, action);
  await ctx.scheduler.runAfter(0, internal.pushNode.send, {
    ownerId: owner._id,
    caseId: c?._id,
    payload: {
      title: "Ledger",
      body,
      url: c ? `/?case=${c._id}` : "/",
      tag: c ? `case-${c._id}` : `ledger-${kind}`,
    },
    summary,
  });
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
    if (doc.status === "failed" || (confidence !== undefined && confidence < MIN_CONFIDENCE)) {
      await queuePush(ctx, owner, "document_failed", c, null);
      return null;
    }
    const proposed = c
      ? (
          await ctx.db
            .query("actions")
            .withIndex("by_case", (q) => q.eq("caseId", c._id))
            .collect()
        ).some((a) => a.createdAt >= startedAt)
      : false;
    await queuePush(ctx, owner, proposed ? "action_needed" : "document_read", c, null);
    return null;
  },
});
