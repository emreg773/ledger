"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useUIMessages } from "@convex-dev/agent/react";
import imageCompression from "browser-image-compression";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, Camera, Loader2, SendHorizontal } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { DOCUMENT_MARKER, SYSTEM_NOTE_PREFIX } from "@/convex/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DocumentCard } from "@/components/document-card";
import { ActionCard } from "@/components/action-card";
import { ActivitySummary, LiveActivity, activitySteps } from "@/components/activity";
import { AppMenu } from "@/components/app-menu";
import { Home } from "@/components/home";
import { NotificationCenter } from "@/components/notification-center";
import { errorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { splitReply } from "@/lib/markers";
import { usePush } from "@/lib/push";
import type { RecentEvent } from "@/lib/contract";

const MAX_BYTES = 10 * 1024 * 1024;

export function Chat({ owner }: { owner: Doc<"owners"> }) {
  const push = usePush();
  // The home screen until the owner sends something; then the conversation.
  const [view, setView] = useState<"home" | "conversation">("home");
  const { results: messages } = useUIMessages(
    api.chat.listThreadMessages,
    { threadId: owner.agentThreadId },
    { initialNumItems: 50, stream: true },
  );
  const documents = useQuery(api.documents.listForOwner, {});
  const docsById = new Map((documents ?? []).map((d) => [d._id as string, d]));
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
    (documents ?? []).some((d) => d.status === "received" || d.status === "extracting") ||
    messages.some((m) => m.status === "pending" || m.status === "streaming") ||
    visible.at(-1)?.role === "user";

  // Steps since the owner's latest message or document.
  const lastUserAt = visible.findLast((m) => m.role === "user")?._creationTime ?? 0;
  const liveSteps = activitySteps(events.filter((e) => e.at >= lastUserAt));
  // Steps between one user message and the next, shown under that window's last reply.
  const stepsBetween = (from: number, to: number) =>
    activitySteps(events.filter((e) => e.at >= from && e.at < to));

  // A push opens /?case=<caseId>, and the notification list and calendar
  // send "ledger:open-case": open the conversation, scroll to that letter once
  // it has loaded, highlight it, and skip the usual scroll to the bottom.
  const deepLinkCase = useRef<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  useEffect(() => {
    const caseId = new URLSearchParams(window.location.search).get("case");
    const open = (id: string) => {
      deepLinkCase.current = id;
      setView("conversation");
      setScrollRequest((n) => n + 1);
    };
    if (caseId) open(caseId);
    const onOpen = (e: Event) => open((e as CustomEvent<string>).detail);
    window.addEventListener("ledger:open-case", onOpen);
    return () => window.removeEventListener("ledger:open-case", onOpen);
  }, []);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view !== "conversation") return;
    const caseId = deepLinkCase.current;
    if (!caseId) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (documents === undefined || visible.length === 0) return;
    deepLinkCase.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("case");
    window.history.replaceState(null, "", url);
    const el = document.querySelector<HTMLElement>(`[data-case-id="${CSS.escape(caseId)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.dataset.highlight = "true";
    setTimeout(() => delete el.dataset.highlight, 2500);
  }, [view, scrollRequest, visible.length, working, documents]);

  return (
    <div className="flex h-dvh w-full flex-col">
      <Header owner={owner} push={push} view={view} onHome={() => setView("home")} />

      {view === "home" ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Home
            owner={owner}
            cases={cases ?? []}
            documents={documents ?? []}
            hasConversation={visible.length > 0}
            push={push}
            onOpenConversation={() => setView("conversation")}
          />
        </main>
      ) : (
      <main className="min-h-0 flex-1 overflow-y-auto">
       <div className="mx-auto w-full max-w-2xl space-y-3 px-3 py-4">
        {visible.length === 0 && <Welcome owner={owner} />}
        {visible.map((m, i) => {
          const docId = m.role === "user" ? m.text.match(DOCUMENT_MARKER)?.[1] : undefined;
          if (docId) {
            return (
              <div
                key={m.key}
                data-case-id={docsById.get(docId)?.caseId}
                className="flex scroll-mt-4 justify-end rounded-2xl transition-shadow data-highlight:ring-2 data-highlight:ring-ring"
              >
                <DocumentCard
                  doc={docsById.get(docId)}
                  caseView={caseFor(docsById.get(docId)?.caseId)}
                />
              </div>
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

      <Composer onSent={() => setView("conversation")} />
    </div>
  );
}

function Header({
  owner,
  push,
  view,
  onHome,
}: {
  owner: Doc<"owners">;
  push: ReturnType<typeof usePush>;
  view: "home" | "conversation";
  onHome: () => void;
}) {
  const { t } = useI18n();
  return (
    <header className="relative border-b-2 border-double border-foreground/70 bg-background">
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
          {view === "conversation" && <NotificationCenter />}
          <AppMenu owner={owner} push={push} />
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

function Composer({ onSent }: { onSent: () => void }) {
  const { t } = useI18n();
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const ingestWebUpload = useMutation(api.intake.ingestWebUpload);
  const sendMessage = useMutation(api.chat.sendMessage);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The home screen's "Upload a letter" tile opens this file picker.
  useEffect(() => {
    const pick = () => fileInput.current?.click();
    window.addEventListener("ledger:upload", pick);
    return () => window.removeEventListener("ledger:upload", pick);
  }, []);

  async function upload(original: File) {
    setError(null);
    const isPdf = original.type === "application/pdf";
    if (!isPdf && !original.type.startsWith("image/")) {
      setError(t("chat.uploadNotPhoto"));
      return;
    }
    setUploading(true);
    try {
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
      if (file.size > MAX_BYTES) {
        setError(t("chat.uploadTooBig"));
        return;
      }
      const url = await generateUploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await ingestWebUpload({ storageId, mimeType: file.type });
      onSent();
    } catch (e) {
      setError(errorMessage(t, e, "chat.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setText("");
    try {
      await sendMessage({ text: trimmed });
      onSent();
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
        className="ledger-card flex items-end gap-1.5 p-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={t("chat.upload")}
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Camera />}
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
          placeholder={t("chat.placeholder")}
          className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent text-base shadow-none focus-visible:ring-0 sm:text-sm dark:bg-transparent"
        />
        <Button type="submit" size="icon-lg" aria-label={t("chat.send")} disabled={!text.trim()}>
          <SendHorizontal />
        </Button>
      </form>
      <p className="px-1 pt-1.5 text-[11px] leading-snug text-muted-foreground">
        {t("privacy.notice")}
      </p>
     </div>
    </footer>
  );
}
