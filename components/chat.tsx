"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useMutation, useQuery } from "convex/react";
import { useUIMessages } from "@convex-dev/agent/react";
import imageCompression from "browser-image-compression";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, Camera, FileText, History, Loader2, Plus, SendHorizontal, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { DOCUMENT_MARKER, SYSTEM_NOTE_PREFIX } from "@/convex/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DocumentCard } from "@/components/document-card";
import { ActionCard } from "@/components/action-card";
import { ActivitySummary, LiveActivity, activitySteps } from "@/components/activity";
import { AppMenu } from "@/components/app-menu";
import { DemoClockBanner } from "@/components/demo-clock";
import { Home } from "@/components/home";
import { ConversationsDialog } from "@/components/conversations";
import { NotificationCenter } from "@/components/notification-center";
import { errorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { splitReply } from "@/lib/markers";
import type { RecentEvent } from "@/lib/contract";

const MAX_BYTES = 10 * 1024 * 1024;
// Matches convex/intake.ts: several files sent together are pages of one document.
const MAX_PAGES = 10;

export function Chat({ owner }: { owner: Doc<"owners"> }) {
  // The home screen, or one conversation. New conversations start from the home
  // screen's message box or Telegram (convex/conversations.ts).
  const [view, setView] = useState<"home" | "conversation">("home");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const conversations = useQuery(api.conversations.list, {});
  const { results: messages } = useUIMessages(
    api.chat.listThreadMessages,
    threadId ? { threadId } : "skip",
    { initialNumItems: 50, stream: true },
  );
  const documents = useQuery(api.documents.listForOwner, {});
  const docsById = new Map((documents ?? []).map((d) => [d._id as string, d]));
  // Letters from before conversation history belong to the owner's first thread.
  const threadOf = (d: { threadId?: string }) => d.threadId ?? owner.agentThreadId;
  const openConversation = (id: string) => {
    setThreadId(id);
    setView("conversation");
    setHistoryOpen(false);
  };
  const events: RecentEvent[] = useQuery(api.events.listRecentForOwner, { limit: 100 }) ?? [];
  const cases = useQuery(api.cases.listForOwner, {});
  const casesById = new Map((cases ?? []).map((c) => [c._id as string, c]));
  const caseFor = (caseId: RecentEvent["caseId"]) => (caseId ? casesById.get(caseId) : undefined);

  // Messages to show: user messages, and assistant messages that have text.
  // Tool calls and results are hidden; the document card shows what was read.
  // Server notes to the agent ("the payment ran") are hidden too.
  const visible = messages.filter(
    (m) =>
      (m.role === "user" && !m.text.startsWith(SYSTEM_NOTE_PREFIX)) ||
      (m.role === "assistant" && m.text.trim() !== ""),
  );

  // Working = a document is still being processed, a reply is in progress,
  // or the last thing in the thread is the owner's message.
  const working =
    (documents ?? []).some(
      (d) => threadOf(d) === threadId && (d.status === "received" || d.status === "extracting"),
    ) ||
    messages.some((m) => m.status === "pending" || m.status === "streaming") ||
    visible.at(-1)?.role === "user";

  // Steps since the owner's latest message or document.
  const lastUserAt = visible.findLast((m) => m.role === "user")?._creationTime ?? 0;
  const liveSteps = activitySteps(events.filter((e) => e.at >= lastUserAt));
  // Steps between one user message and the next, shown under that window's last reply.
  const stepsBetween = (from: number, to: number) =>
    activitySteps(events.filter((e) => e.at >= from && e.at < to));

  // A Telegram link opens /?doc=<documentId> or /?case=<caseId>, and the
  // notification list and calendar send "ledger:open-case": open the
  // conversation, scroll to that letter once it has loaded, highlight it, and
  // skip the usual scroll to the bottom.
  const deepLink = useRef<string | null>(null); // a CSS selector for the letter
  const [scrollRequest, setScrollRequest] = useState(0);
  // The letter to open, until the documents have loaded and its conversation is known.
  const [target, setTarget] = useState<{ docId?: string; caseId?: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const docId = params.get("doc");
    const caseId = params.get("case");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL only exists after mount
    if (docId || caseId) setTarget({ docId: docId ?? undefined, caseId: caseId ?? undefined });
    const onOpen = (e: Event) => setTarget({ caseId: (e as CustomEvent<string>).detail });
    window.addEventListener("ledger:open-case", onOpen);
    return () => window.removeEventListener("ledger:open-case", onOpen);
  }, []);
  useEffect(() => {
    if (!target || documents === undefined) return;
    // A case's newest letter (the list is newest first).
    const doc = target.docId ? docsById.get(target.docId) : documents.find((d) => d.caseId === target.caseId);
    deepLink.current = target.docId
      ? `[data-document-id="${CSS.escape(target.docId)}"]`
      : `[data-case-id="${CSS.escape(target.caseId ?? "")}"]`;
    /* eslint-disable react-hooks/set-state-in-effect -- opening the letter's conversation once it's known */
    setTarget(null);
    openConversation(doc ? threadOf(doc) : owner.agentThreadId);
    setScrollRequest((n) => n + 1);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a target or the documents arrive
  }, [target, documents]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view !== "conversation") return;
    const selector = deepLink.current;
    if (!selector) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (documents === undefined || visible.length === 0) return;
    deepLink.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("case");
    url.searchParams.delete("doc");
    window.history.replaceState(null, "", url);
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.dataset.highlight = "true";
    setTimeout(() => delete el.dataset.highlight, 2500);
  }, [view, scrollRequest, visible.length, working, documents]);

  return (
    <div className="flex h-dvh w-full flex-col">
      <Header owner={owner} view={view} onHome={() => setView("home")} onHistory={() => setHistoryOpen(true)} />
      <ConversationsDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        conversations={conversations}
        activeThreadId={view === "conversation" ? threadId : null}
        onSelect={openConversation}
      />

      {view === "home" ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Home
            owner={owner}
            cases={cases ?? []}
            documents={documents ?? []}
            conversationCount={conversations?.length ?? 0}
            onOpenConversations={() => setHistoryOpen(true)}
          />
        </main>
      ) : (
      <main className="min-h-0 flex-1 overflow-y-auto">
       <div className="mx-auto w-full max-w-2xl space-y-3 px-3 py-4">
        {visible.map((m, i) => {
          const docId = m.role === "user" ? m.text.match(DOCUMENT_MARKER)?.[1] : undefined;
          if (docId) {
            return (
              <DocumentRow
                key={m.key}
                doc={docsById.get(docId)}
                caseView={caseFor(docsById.get(docId)?.caseId)}
              />
            );
          }
          return m.role === "user" ? (
            <div key={m.key} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.key} className="flex flex-col items-start gap-2">
              {splitReply(m.text).map((part, j) =>
                part.kind === "action" ? (
                  <ActionCard key={j} actionId={part.actionId} />
                ) : (
                  <div
                    key={j}
                    className="prose prose-sm max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4"
                  >
                    <ReactMarkdown>{part.text}</ReactMarkdown>
                  </div>
                ),
              )}
              {/* Last reply before the next owner message: show what Ledger did. */}
              {visible[i + 1]?.role !== "assistant" && !(working && i === visible.length - 1) && (
                <ActivitySummary
                  steps={stepsBetween(
                    visible.slice(0, i).findLast((v) => v.role === "user")?._creationTime ?? 0,
                    visible[i + 1]?._creationTime ?? Infinity,
                  )}
                  caseFor={caseFor}
                />
              )}
            </div>
          );
        })}
        {working && <LiveActivity steps={liveSteps} caseFor={caseFor} />}
        <div ref={bottomRef} />
       </div>
      </main>
      )}

      {/* From the home screen, sending starts a new conversation; inside one, it continues it. */}
      <Composer threadId={view === "conversation" ? threadId : null} onSent={openConversation} />
    </div>
  );
}

/**
 * A letter in the conversation. Once Ledger has read it and its card is on
 * screen with the tab visible, it counts as opened (stops the "not opened" nudge).
 */
function DocumentRow({ doc, caseView }: ComponentProps<typeof DocumentCard>) {
  const ref = useRef<HTMLDivElement>(null);
  const markOpened = useMutation(api.documents.markOpened);
  const unopened = doc?.status === "extracted" && doc.openedAt === undefined ? doc._id : null;

  useEffect(() => {
    const el = ref.current;
    if (!unopened || !el) return;
    let onScreen = false;
    let done = false;
    const mark = () => {
      if (done || !onScreen || document.visibilityState !== "visible") return;
      done = true;
      void markOpened({ documentId: unopened });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        mark();
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    document.addEventListener("visibilitychange", mark);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", mark);
    };
  }, [unopened, markOpened]);

  return (
    <div
      ref={ref}
      data-case-id={doc?.caseId}
      data-document-id={doc?._id}
      className="flex scroll-mt-4 justify-end rounded-2xl transition-shadow data-highlight:ring-2 data-highlight:ring-ring"
    >
      <DocumentCard doc={doc} caseView={caseView} />
    </div>
  );
}

function Header({
  owner,
  view,
  onHome,
  onHistory,
}: {
  owner: Doc<"owners">;
  view: "home" | "conversation";
  onHome: () => void;
  onHistory: () => void;
}) {
  const { t } = useI18n();
  return (
    <header className="relative border-b-2 border-double border-foreground/70 bg-background">
      <DemoClockBanner />
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-3 py-2 lg:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {view === "conversation" && (
            <Button variant="ghost" size="icon-lg" aria-label={t("home.back")} onClick={onHome}>
              <ArrowLeft />
            </Button>
          )}
          <button type="button" onClick={onHome} className="min-w-0 text-left">
            <div className="font-display text-2xl leading-none">Ledger</div>
            <div className="truncate text-xs text-muted-foreground">{owner.businessName}</div>
          </button>
        </div>
        <div className="flex items-center gap-1">
          {view === "conversation" && (
            <>
              <Button variant="ghost" size="icon-lg" aria-label={t("home.conversations")} onClick={onHistory}>
                <History />
              </Button>
              <NotificationCenter />
            </>
          )}
          <AppMenu owner={owner} />
        </div>
      </div>
    </header>
  );
}

/** Shown until the first message: what Ledger is, and that the bank is a sandbox. */
export function Welcome({ owner }: { owner: Doc<"owners"> }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 space-y-2 rounded-xl border bg-card p-4 text-sm">
      <p className="font-medium">{t("welcome.title", { name: owner.name.split(" ")[0] })}</p>
      <p>{t("chat.empty")}</p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>{t("welcome.sandbox")}</li>
        <li>{t("welcome.samples")}</li>
        <li>{t("welcome.delete")}</li>
      </ul>
    </div>
  );
}

/** A picked file waiting for Send. It uploads to storage while the owner types.
 * Several attachments are sent as the pages of one document, in this order. */
type Attachment = {
  key: number;
  name: string;
  previewUrl: string | null; // object URL for photos; PDFs show an icon
  ready: boolean;
  upload: Promise<{ storageId: Id<"_storage">; mimeType: string }>;
};

function Composer({ threadId, onSent }: { threadId: string | null; onSent: (threadId: string) => void }) {
  const { t } = useI18n();
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const ingestWebUpload = useMutation(api.intake.ingestWebUpload);
  const sendMessage = useMutation(api.chat.sendMessage);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Free each photo preview when its attachment is removed or sent.
  const previews = useRef(new Map<number, string>());
  useEffect(() => {
    const live = new Set(attachments.map((a) => a.key));
    for (const [key, url] of previews.current) {
      if (!live.has(key)) {
        URL.revokeObjectURL(url);
        previews.current.delete(key);
      }
    }
  }, [attachments]);
  useEffect(() => {
    const map = previews.current;
    return () => map.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function prepare(original: File) {
    const isPdf = original.type === "application/pdf";
    // Photos: shrink to ~1600 px and convert to JPEG (also handles HEIC-ish
    // camera formats the browser can decode). PDFs upload unchanged.
    const file = isPdf
      ? original
      : await imageCompression(original, {
          maxWidthOrHeight: 1600,
          maxSizeMB: 2,
          fileType: "image/jpeg",
          useWebWorker: true,
        });
    if (file.size > MAX_BYTES) throw new Error("too_big");
    return file;
  }

  async function store(file: File) {
    const url = await generateUploadUrl({});
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    return { storageId, mimeType: file.type };
  }

  // Picking files only attaches them; nothing reaches the agent until Send.
  // A removed attachment's upload is left for the hourly unused-upload cleanup.
  const nextKey = useRef(0);
  function attach(picked: File[]) {
    if (fileInput.current) fileInput.current.value = "";
    setError(null);
    const supported = picked.filter(
      (f) => f.type === "application/pdf" || f.type.startsWith("image/"),
    );
    if (supported.length < picked.length) setError(t("chat.uploadNotPhoto"));
    const room = MAX_PAGES - attachments.length;
    if (supported.length > room) setError(t("chat.tooManyPages"));
    // Files picked together go in name order, so page1/page2 land in page order.
    const added = supported
      .slice(0, Math.max(0, room))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((original): Attachment => {
        const key = nextKey.current++;
        const isPdf = original.type === "application/pdf";
        const previewUrl = isPdf ? null : URL.createObjectURL(original);
        if (previewUrl) previews.current.set(key, previewUrl);
        const upload = prepare(original).then(store);
        upload.then(
          () => setAttachments((list) => list.map((a) => (a.key === key ? { ...a, ready: true } : a))),
          (e: unknown) => {
            setAttachments((list) => list.filter((a) => a.key !== key));
            setError(
              e instanceof Error && e.message === "too_big"
                ? t("chat.uploadTooBig")
                : errorMessage(t, e, "chat.uploadFailed"),
            );
          },
        );
        return { key, name: original.name, previewUrl, ready: false, upload };
      });
    if (added.length) setAttachments((list) => [...list, ...added]);
  }

  async function send() {
    const trimmed = text.trim();
    if (sending) return;
    if (attachments.length) {
      // The typed text goes with the document as the owner's note.
      setError(null);
      setSending(true);
      try {
        const [first, ...rest] = await Promise.all(attachments.map((a) => a.upload));
        const sentTo = await ingestWebUpload({
          storageId: first.storageId,
          mimeType: first.mimeType,
          extraPages: rest.length ? rest : undefined,
          hint: trimmed || undefined,
          threadId: threadId ?? undefined,
        });
        setAttachments([]);
        setText("");
        onSent(sentTo);
      } catch (e) {
        // A failed upload already cleared itself and set the error in attach().
        if (!(e instanceof Error && e.message === "too_big")) {
          setError(errorMessage(t, e, "chat.uploadFailed"));
        }
      } finally {
        setSending(false);
      }
      return;
    }
    if (!trimmed) return;
    setError(null);
    setText("");
    try {
      const sentTo = await sendMessage({ text: trimmed, threadId: threadId ?? undefined });
      if (sentTo) onSent(sentTo);
    } catch (e) {
      setText(trimmed);
      setError(errorMessage(t, e, "chat.sendFailed"));
    }
  }

  return (
    <footer className="bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
     <div className="mx-auto w-full max-w-3xl">
      {error && <p className="px-1 pb-2 text-xs text-destructive">{error}</p>}
      <form
        className="ledger-card p-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
       {attachments.length > 0 && (
        <div className="px-1 pt-1 pb-1.5">
          <div className="flex gap-2 overflow-x-auto pt-2 pr-2">
            {attachments.map((a, i) => (
              <div key={a.key} className="group relative inline-flex shrink-0">
                {a.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL
                  <img
                    src={a.previewUrl}
                    alt={a.name}
                    className="size-16 rounded-lg border object-cover"
                  />
                ) : (
                  <div className="flex h-16 max-w-48 items-center gap-2 rounded-lg border bg-muted px-3 text-xs">
                    <FileText className="size-5 shrink-0" />
                    <span className="truncate">{a.name}</span>
                  </div>
                )}
                {attachments.length > 1 && (
                  <span className="absolute bottom-1 left-1 rounded bg-background/80 px-1 text-[10px] font-medium">
                    {i + 1}
                  </span>
                )}
                {(!a.ready || sending) && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                )}
                {!sending && (
                  // Shows on hover or keyboard focus; always shown on touch screens.
                  <button
                    type="button"
                    aria-label={t("chat.removeAttachment")}
                    onClick={() => setAttachments((list) => list.filter((x) => x.key !== a.key))}
                    className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border bg-background text-foreground shadow-sm opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
            {!sending && attachments.length < MAX_PAGES && (
              <button
                type="button"
                aria-label={t("chat.addPage")}
                title={t("chat.addPage")}
                onClick={() => fileInput.current?.click()}
                className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed text-muted-foreground hover:bg-muted"
              >
                <Plus className="size-5" />
              </button>
            )}
          </div>
          {attachments.length > 1 && (
            <p className="pt-1.5 text-[11px] leading-snug text-muted-foreground">
              {t("chat.pagesNote", { count: attachments.length })}
            </p>
          )}
        </div>
       )}
       <div className="flex items-end gap-1.5">
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => attach(Array.from(e.target.files ?? []))}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={t("chat.upload")}
          disabled={sending}
          onClick={() => fileInput.current?.click()}
        >
          <Camera />
        </Button>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={t(attachments.length ? "chat.notePlaceholder" : "chat.placeholder")}
          className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent text-base shadow-none focus-visible:ring-0 sm:text-sm dark:bg-transparent"
        />
        <Button
          type="submit"
          size="icon-lg"
          aria-label={t("chat.send")}
          disabled={sending || (!attachments.length && !text.trim())}
        >
          {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
        </Button>
       </div>
      </form>
      <p className="px-1 pt-1.5 text-[11px] leading-snug text-muted-foreground">
        {t("privacy.notice")}
      </p>
     </div>
    </footer>
  );
}
