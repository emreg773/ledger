"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useUIMessages } from "@convex-dev/agent/react";
import imageCompression from "browser-image-compression";
import ReactMarkdown from "react-markdown";
import { Camera, Loader2, SendHorizontal } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { DOCUMENT_MARKER, SYSTEM_NOTE_PREFIX } from "@/convex/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DocumentCard } from "@/components/document-card";
import { ActionCard } from "@/components/action-card";
import { ActivitySummary, LiveActivity, activitySteps } from "@/components/activity";
import { AppMenu } from "@/components/app-menu";
import { NotificationBanner } from "@/components/notifications";
import { backend } from "@/lib/backend";
import { errorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { splitReply } from "@/lib/markers";
import { usePush } from "@/lib/push";
import type { RecentEvent } from "@/lib/contract";

const MAX_BYTES = 10 * 1024 * 1024;

export function Chat({ owner }: { owner: Doc<"owners"> }) {
  const push = usePush();
  const { results: messages } = useUIMessages(
    api.chat.listThreadMessages,
    { threadId: owner.agentThreadId },
    { initialNumItems: 50, stream: true },
  );
  const documents = useQuery(backend.documents.listForOwner, {});
  const docsById = new Map((documents ?? []).map((d) => [d._id as string, d]));
  const events: RecentEvent[] = useQuery(backend.events.listRecentForOwner, { limit: 100 }) ?? [];
  const cases = useQuery(backend.cases.listForOwner, {});
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

  // A push opens /?case=<caseId>: scroll to that letter once it has loaded,
  // highlight it, and skip the usual scroll to the bottom that time.
  const deepLinkCase = useRef<string | null | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (deepLinkCase.current === undefined) {
      deepLinkCase.current = new URLSearchParams(window.location.search).get("case");
    }
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
  }, [visible.length, working, documents]);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col">
      <Header owner={owner} push={push} />

      <main className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {visible.length === 0 && <Welcome owner={owner} />}
        <NotificationBanner push={push} />
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
      </main>

      <Composer />
    </div>
  );
}

function Header({ owner, push }: { owner: Doc<"owners">; push: ReturnType<typeof usePush> }) {
  return (
    <header className="relative flex items-center justify-between gap-2 border-b px-3 py-2">
      <div className="min-w-0">
        <div className="truncate font-semibold">{owner.businessName}</div>
        <div className="text-xs text-muted-foreground">Ledger</div>
      </div>
      <AppMenu owner={owner} push={push} />
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

function Composer() {
  const { t } = useI18n();
  const generateUploadUrl = useMutation(backend.documents.generateUploadUrl);
  const ingestWebUpload = useMutation(backend.intake.ingestWebUpload);
  const sendMessage = useMutation(backend.chat.sendMessage);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      setText(trimmed);
      setError(errorMessage(t, e, "chat.sendFailed"));
    }
  }

  return (
    <footer className="border-t p-2">
      {error && <p className="px-1 pb-2 text-xs text-destructive">{error}</p>}
      <form
        className="flex items-end gap-2"
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
          variant="outline"
          size="icon"
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
          className="max-h-32 min-h-9 flex-1 resize-none"
        />
        <Button type="submit" size="icon" aria-label={t("chat.send")} disabled={!text.trim()}>
          <SendHorizontal />
        </Button>
      </form>
      <p className="px-1 pt-1.5 text-[11px] leading-snug text-muted-foreground">
        {t("privacy.notice")}
      </p>
    </footer>
  );
}
