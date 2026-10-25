import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOwner, viewerOwner } from "./access";
import { logEvent } from "./events";
import { SUPPORTED_TYPES } from "./extraction";
import { ownerLang, type Lang } from "./push";

// Telegram (Step 4 brief B, Section 3). The owner sends a photo or file of a
// letter to the Ledger bot, and Ledger reads it like an upload; the bot also
// sends the result and, from nudges.ts, every notification. It doesn't
// hold conversations: any other message gets one fixed reply.
//
// Env (Convex): TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET.
// One bot for the team, so its webhook points at one deployment at a time:
// npm run telegram:webhook (scripts/telegram-webhook.ts).
//
// Bot API: https://core.telegram.org/bots/api (setWebhook with secret_token,
// the X-Telegram-Bot-Api-Secret-Token header, getFile, sendMessage).

const API = "https://api.telegram.org";
const LINK_TTL_MS = 60 * 60_000;
const MAX_BYTES = 10 * 1024 * 1024;
const LANGS: Lang[] = ["en", "es", "zh", "vi", "ko", "tr"];

const site = () => process.env.SITE_URL ?? "";
const token = () => {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
};

// ---------- Replies ----------
// Plain text (no Markdown parsing, so nothing needs escaping). Spanish uses "usted".

const REPLIES = {
  connected: {
    en: "Connected to Ledger!\nI'll message you here when there is something that requires your attention, at most once a day. You can also send me documents here.\n\nTip: send it as a file to keep it sharper than a photo.",
    es: "¡Conectado a Ledger!\nLe escribiré aquí cuando haya algo que requiera su atención, como máximo una vez al día. También puede enviarme documentos aquí.\n\nConsejo: envíelo como archivo para que se vea más nítido que una foto.",
    zh: "已连接 Ledger！\n有需要您处理的事情时，我会在这里通知您，每天最多一次。您也可以在这里给我发送文件。\n\n提示：以文件形式发送会比照片更清晰。",
    vi: "Đã kết nối với Ledger!\nTôi sẽ nhắn bạn tại đây khi có việc cần bạn chú ý, tối đa một lần mỗi ngày. Bạn cũng có thể gửi tài liệu cho tôi tại đây.\n\nMẹo: gửi dưới dạng tệp sẽ rõ nét hơn gửi ảnh.",
    ko: "Ledger에 연결되었습니다!\n확인이 필요한 일이 있으면 하루에 한 번까지 여기로 알려 드릴게요. 여기로 서류를 보내실 수도 있습니다.\n\n팁: 사진 대신 파일로 보내면 더 선명합니다.",
    tr: "Ledger'a bağlandı!\nİlgilenmeniz gereken bir şey olduğunda size buradan, günde en fazla bir kez yazacağım. Bana buradan belge de gönderebilirsiniz.\n\nİpucu: dosya olarak gönderirseniz fotoğraftan daha net olur.",
  },
  badCode: {
    en: "This link has expired. Open Ledger and tap Connect Telegram again.",
    es: "Este enlace venció. Abra Ledger y toque Conectar Telegram otra vez.",
    zh: "此链接已过期。请打开 Ledger，再次点击“连接 Telegram”。",
    vi: "Liên kết này đã hết hạn. Hãy mở Ledger và nhấn Kết nối Telegram lại.",
    ko: "이 링크는 만료되었습니다. Ledger를 열고 텔레그램 연결을 다시 눌러 주세요.",
    tr: "Bu linkin süresi dolmuş. Ledger'ı açıp Telegram'ı bağla'ya yeniden dokunun.",
  },
  unlinked: {
    en: "Open Ledger and tap Connect Telegram first: {site}",
    es: "Primero abra Ledger y toque Conectar Telegram: {site}",
    zh: "请先打开 Ledger 并点击“连接 Telegram”：{site}",
    vi: "Trước tiên, hãy mở Ledger và nhấn Kết nối Telegram: {site}",
    ko: "먼저 Ledger를 열고 텔레그램 연결을 눌러 주세요: {site}",
    tr: "Önce Ledger'ı açıp Telegram'ı bağla'ya dokunun: {site}",
  },
  reading: {
    en: "Got it. I'm reading it now…",
    es: "Recibido. Lo estoy leyendo ahora…",
    zh: "收到了，我正在阅读…",
    vi: "Đã nhận. Tôi đang đọc…",
    ko: "받았습니다. 지금 읽고 있어요…",
    tr: "Aldım. Şimdi okuyorum…",
  },
  unsupported: {
    en: "I can read photos and PDFs. Please send the letter as a photo, or as a PDF or image file.",
    es: "Puedo leer fotos y PDF. Envíe la carta como foto, o como archivo PDF o de imagen.",
    zh: "我可以读取照片和 PDF。请以照片、PDF 或图片文件的形式发送信件。",
    vi: "Tôi đọc được ảnh và PDF. Hãy gửi thư dưới dạng ảnh, hoặc tệp PDF hay tệp ảnh.",
    ko: "사진과 PDF를 읽을 수 있습니다. 서류를 사진이나 PDF, 이미지 파일로 보내 주세요.",
    tr: "Fotoğraf ve PDF okuyabiliyorum. Mektubu fotoğraf olarak ya da PDF veya resim dosyası olarak gönderin.",
  },
  tooLarge: {
    en: "That file is over 10 MB. Please send a smaller photo or PDF.",
    es: "Ese archivo pesa más de 10 MB. Envíe una foto o un PDF más pequeño.",
    zh: "该文件超过 10 MB。请发送较小的照片或 PDF。",
    vi: "Tệp này lớn hơn 10 MB. Hãy gửi ảnh hoặc PDF nhỏ hơn.",
    ko: "파일이 10MB를 넘습니다. 더 작은 사진이나 PDF를 보내 주세요.",
    tr: "Bu dosya 10 MB'tan büyük. Daha küçük bir fotoğraf ya da PDF gönderin.",
  },
  tooManyPages: {
    en: "I can read up to 10 pages of one letter at once, 25 MB in all. Please send fewer pages.",
    es: "Puedo leer hasta 10 páginas de una carta a la vez, 25 MB en total. Envíe menos páginas.",
    zh: "一封信我一次最多可以读取 10 页，总共不超过 25 MB。请少发几页。",
    vi: "Tôi đọc được tối đa 10 trang của một lá thư mỗi lần, tổng cộng 25 MB. Hãy gửi ít trang hơn.",
    ko: "한 서류는 한 번에 최대 10페이지, 총 25MB까지 읽을 수 있습니다. 페이지 수를 줄여서 보내 주세요.",
    tr: "Bir mektubun en fazla 10 sayfasını, toplam 25 MB'ı bir kerede okuyabilirim. Lütfen daha az sayfa gönderin.",
  },
  busy: {
    en: "Ledger is busy right now. Please send it again in a little while.",
    es: "Ledger está ocupado en este momento. Vuelva a enviarlo en un rato.",
    zh: "Ledger 现在有点忙，请稍后再发送。",
    vi: "Ledger đang bận. Hãy gửi lại sau ít phút.",
    ko: "지금 Ledger가 바쁩니다. 잠시 후 다시 보내 주세요.",
    tr: "Ledger şu an meşgul. Lütfen biraz sonra tekrar gönderin.",
  },
  failed: {
    en: "I couldn't get that file. Please try sending it again.",
    es: "No pude recibir ese archivo. Intente enviarlo de nuevo.",
    zh: "我没能接收这个文件，请重新发送。",
    vi: "Tôi không nhận được tệp đó. Hãy thử gửi lại.",
    ko: "파일을 받지 못했습니다. 다시 보내 주세요.",
    tr: "Dosyayı alamadım. Lütfen tekrar göndermeyi deneyin.",
  },
  other: {
    en: "To chat with Ledger, open the app: {site}\nTo send a letter, send a photo or a file here.",
    es: "Para conversar con Ledger, abra la app: {site}\nPara enviar una carta, mande una foto o un archivo aquí.",
    zh: "如需与 Ledger 对话，请打开应用：{site}\n如需发送信件，请在这里发送照片或文件。",
    vi: "Để trò chuyện với Ledger, hãy mở ứng dụng: {site}\nĐể gửi thư, hãy gửi ảnh hoặc tệp tại đây.",
    ko: "Ledger와 대화하려면 앱을 여세요: {site}\n서류를 보내려면 여기로 사진이나 파일을 보내 주세요.",
    tr: "Ledger ile konuşmak için uygulamayı açın: {site}\nMektup göndermek için buraya fotoğraf ya da dosya gönderin.",
  },
  disconnected: {
    en: "This chat is no longer connected to Ledger.",
    es: "Este chat ya no está conectado a Ledger.",
    zh: "此聊天已与 Ledger 断开连接。",
    vi: "Cuộc trò chuyện này không còn kết nối với Ledger.",
    ko: "이 채팅은 더 이상 Ledger에 연결되어 있지 않습니다.",
    tr: "Bu sohbet artık Ledger'a bağlı değil.",
  },
} satisfies Record<string, Record<Lang, string>>;

type ReplyKey = keyof typeof REPLIES;
const reply = (key: ReplyKey, lang: Lang) => REPLIES[key][lang].replace("{site}", site());

/** The language for a chat that isn't linked yet, from the Telegram user's app language. */
const langOf = (code: string | undefined): Lang =>
  LANGS.find((l) => code?.toLowerCase().startsWith(l)) ?? "en";

async function send(chatId: string, text: string) {
  const res = await fetch(`${API}/bot${token()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
  });
  if (!res.ok) console.warn("Telegram sendMessage failed", res.status, await res.text());
}

// ---------- For the UI ----------

/** Whether the viewer's account has a Telegram chat linked, and whether the bot is set up at all. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const owner = await viewerOwner(ctx);
    return {
      linked: Boolean(owner?.telegramChatId),
      available: Boolean(process.env.TELEGRAM_BOT_USERNAME),
    };
  },
});

/** A deep link that links this account when the owner presses Start in Telegram. */
export const createLinkCode = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    const username = process.env.TELEGRAM_BOT_USERNAME;
    if (!username) throw new ConvexError({ code: "telegram_not_configured", message: "Telegram isn't set up" });
    // Telegram's start parameter allows A-Z, a-z, 0-9, _ and -, up to 64 characters.
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => alphabet[b % alphabet.length]).join("");
    await ctx.db.insert("telegramLinkCodes", { ownerId: owner._id, code, createdAt: Date.now() });
    return `https://t.me/${username.replace(/^@/, "")}?start=${code}`;
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    if (!owner.telegramChatId) return null;
    await ctx.scheduler.runAfter(0, internal.telegram.sendToChat, {
      chatId: owner.telegramChatId,
      text: reply("disconnected", ownerLang(owner)),
    });
    await ctx.db.patch(owner._id, { telegramChatId: undefined });
    await logEvent(ctx, { ownerId: owner._id, type: "telegram_disconnected", summary: "Telegram disconnected" });
    return null;
  },
});

// ---------- Sending (for other files) ----------

/** Plain text to the owner's linked chat; nothing if there isn't one. */
export const sendMessage = internalAction({
  args: { ownerId: v.id("owners"), text: v.string() },
  handler: async (ctx, { ownerId, text }) => {
    const owner = await ctx.runQuery(internal.owners.get, { ownerId });
    if (owner?.telegramChatId) await send(owner.telegramChatId, text);
    return null;
  },
});

export const sendToChat = internalAction({
  args: { chatId: v.string(), text: v.string() },
  handler: async (_ctx, { chatId, text }) => {
    await send(chatId, text);
    return null;
  },
});

/**
 * The answer to a letter sent on Telegram: the same title and body as the
 * notification center, plus a link that opens the chat at this letter (its
 * card shows the attachment and the caption, like a web upload with a note).
 */
export const notifyDocumentResult = internalAction({
  args: {
    ownerId: v.id("owners"),
    documentId: v.id("documents"),
    caseId: v.optional(v.id("cases")),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { ownerId, documentId, title, body }) => {
    const owner = await ctx.runQuery(internal.owners.get, { ownerId });
    if (!owner?.telegramChatId) return null;
    const link = `${site()}/?doc=${documentId}`;
    await send(owner.telegramChatId, `${title}\n\n${body}\n\n${link}`);
    return null;
  },
});

// ---------- Webhook ----------

/** POST /telegram/webhook. Checks Telegram's secret header, then answers at once so Telegram doesn't retry. */
export const webhook = httpAction(async (ctx, request) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await request.json().catch(() => null);
  if (update?.message) {
    await ctx.scheduler.runAfter(0, internal.telegram.handleMessage, { message: update.message });
  }
  return new Response("ok", { status: 200 });
});

type TgFile = { file_id: string; file_size?: number; mime_type?: string; file_name?: string };
type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { language_code?: string };
  text?: string;
  caption?: string;
  photo?: TgFile[]; // sizes, smallest first
  document?: TgFile;
  media_group_id?: string; // set on each message of an album
};

// An album arrives as one message per photo or file. Its parts wait until none
// has arrived for this long, then are read as pages of one letter.
const ALBUM_WAIT_MS = 3_000;

async function download(ctx: ActionCtx, file: TgFile & { mimeType: string }) {
  const info = await fetch(`${API}/bot${token()}/getFile?file_id=${encodeURIComponent(file.file_id)}`);
  const path = info.ok ? ((await info.json()) as { result?: { file_path?: string } }).result?.file_path : undefined;
  if (!path) throw new Error(`getFile failed (${info.status})`);
  const res = await fetch(`${API}/file/bot${token()}/${path}`);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return await ctx.storage.store(new Blob([await res.arrayBuffer()], { type: file.mimeType }));
}

/** The reply for a file Ledger couldn't take. */
function failureReply(e: unknown): ReplyKey {
  const code = e instanceof ConvexError ? (e.data as { code?: string }).code : undefined;
  console.warn("Telegram document not ingested", code ?? e);
  switch (code) {
    case "file_too_large":
      return "tooLarge";
    case "too_many_pages":
    case "files_too_large":
      return "tooManyPages";
    case "unsupported_file":
      return "unsupported";
    case "rate_limited":
      return "busy";
    default:
      return "failed";
  }
}

export const handleMessage = internalAction({
  args: { message: v.any() },
  handler: async (ctx, { message }) => {
    const m = message as TgMessage;
    if (m.chat?.type !== "private") return null; // the bot only works in direct chats
    const chatId = String(m.chat.id);

    // /start <code>: link this chat to the owner who created the code.
    const start = m.text?.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{4,64})/);
    if (start) {
      const owner = await ctx.runMutation(internal.telegram.linkChat, { code: start[1], chatId });
      await send(chatId, owner ? reply("connected", ownerLang(owner)) : reply("badCode", langOf(m.from?.language_code)));
      return null;
    }

    const owner = await ctx.runQuery(internal.telegram.ownerByChat, { chatId });
    if (!owner) {
      await send(chatId, reply("unlinked", langOf(m.from?.language_code)));
      return null;
    }
    const lang = ownerLang(owner);

    // A photo comes in several sizes: take the largest. Telegram photos are JPEG.
    const photo = m.photo?.at(-1);
    const file: (TgFile & { mimeType: string }) | null = photo
      ? { ...photo, mimeType: "image/jpeg" }
      : m.document
        ? { ...m.document, mimeType: m.document.mime_type ?? "" }
        : null;
    if (!file) {
      await send(chatId, reply("other", lang));
      return null;
    }
    if (!SUPPORTED_TYPES.includes(file.mimeType)) {
      await send(chatId, reply("unsupported", lang));
      return null;
    }
    if ((file.file_size ?? 0) > MAX_BYTES) {
      await send(chatId, reply("tooLarge", lang));
      return null;
    }

    try {
      const storageId = await download(ctx, file);
      if (m.media_group_id) {
        // Part of an album: flushAlbum reads the whole album as one letter.
        await ctx.runMutation(internal.telegram.addAlbumPart, {
          groupId: m.media_group_id,
          ownerId: owner._id,
          chatId,
          messageId: m.message_id,
          storageId,
          mimeType: file.mimeType,
          caption: m.caption,
        });
        return null;
      }
      await send(chatId, reply("reading", lang));
      await ctx.runMutation(internal.intake.ingestDocument, {
        ownerId: owner._id,
        storageId,
        mimeType: file.mimeType,
        source: "telegram",
        sourceRef: String(m.message_id),
        hint: m.caption, // a hint only; Ledger classifies the letter itself
      });
    } catch (e) {
      await send(chatId, reply(failureReply(e), lang));
    }
    return null;
  },
});

/** Saves one album part. The first part schedules flushAlbum. */
export const addAlbumPart = internalMutation({
  args: {
    groupId: v.string(),
    ownerId: v.id("owners"),
    chatId: v.string(),
    messageId: v.number(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const first = !(await ctx.db
      .query("telegramAlbumParts")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .first());
    await ctx.db.insert("telegramAlbumParts", { ...args, addedAt: Date.now() });
    if (first) await ctx.scheduler.runAfter(ALBUM_WAIT_MS, internal.telegram.flushAlbum, { groupId: args.groupId });
    return null;
  },
});

/**
 * Removes and returns the album's parts in album order, once none has arrived
 * for ALBUM_WAIT_MS. Until then it checks again later and returns null.
 */
export const takeAlbum = internalMutation({
  args: { groupId: v.string() },
  handler: async (ctx, { groupId }) => {
    const parts = await ctx.db
      .query("telegramAlbumParts")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    if (parts.length === 0) return null;
    const quietFor = Date.now() - Math.max(...parts.map((p) => p.addedAt));
    if (quietFor < ALBUM_WAIT_MS) {
      await ctx.scheduler.runAfter(ALBUM_WAIT_MS - quietFor, internal.telegram.flushAlbum, { groupId });
      return null;
    }
    for (const p of parts) await ctx.db.delete(p._id);
    return parts.sort((a, b) => a.messageId - b.messageId);
  },
});

/** Reads a finished album as one letter: one document with pages, in one conversation. */
export const flushAlbum = internalAction({
  args: { groupId: v.string() },
  handler: async (ctx, { groupId }) => {
    const parts = await ctx.runMutation(internal.telegram.takeAlbum, { groupId });
    if (!parts) return null;
    const [first, ...rest] = parts;
    const owner = await ctx.runQuery(internal.owners.get, { ownerId: first.ownerId });
    if (!owner) return null;
    const lang = ownerLang(owner);
    try {
      await send(first.chatId, reply("reading", lang));
      await ctx.runMutation(internal.intake.ingestDocument, {
        ownerId: first.ownerId,
        storageId: first.storageId,
        mimeType: first.mimeType,
        extraPages: rest.map((p) => ({ storageId: p.storageId, mimeType: p.mimeType })),
        source: "telegram",
        sourceRef: String(first.messageId),
        hint: parts.find((p) => p.caption)?.caption, // Telegram puts an album's caption on one part
      });
    } catch (e) {
      await send(first.chatId, reply(failureReply(e), lang));
    }
    return null;
  },
});

/** Uses a link code once. Returns the owner, or null for an unknown or expired code. */
export const linkChat = internalMutation({
  args: { code: v.string(), chatId: v.string() },
  handler: async (ctx, { code, chatId }): Promise<Doc<"owners"> | null> => {
    const row = await ctx.db
      .query("telegramLinkCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > LINK_TTL_MS) return null;
    const owner = await ctx.db.get(row.ownerId);
    if (!owner) return null;
    // One chat, one account: a chat moved to another account leaves the old one.
    for (const other of await ownersWithChat(ctx, chatId)) {
      if (other._id !== owner._id) await ctx.db.patch(other._id, { telegramChatId: undefined });
    }
    await ctx.db.patch(owner._id, { telegramChatId: chatId });
    await logEvent(ctx, { ownerId: owner._id, type: "telegram_linked", summary: "Telegram connected" });
    return { ...owner, telegramChatId: chatId };
  },
});

export const ownerByChat = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, { chatId }) => (await ownersWithChat(ctx, chatId))[0] ?? null,
});

// No index on owners.telegramChatId (the schema is Person A's), and the owners
// table is small, so a scan is fine here.
async function ownersWithChat(ctx: QueryCtx, chatId: string) {
  return (await ctx.db.query("owners").collect()).filter((o) => o.telegramChatId === chatId);
}
