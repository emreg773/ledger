"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useUIMessages } from "@convex-dev/agent/react";
import imageCompression from "browser-image-compression";
import ReactMarkdown from "react-markdown";
import { Camera, Loader2, SendHorizontal } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { DOCUMENT_MARKER, LANGUAGES } from "@/convex/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DocumentCard } from "@/components/document-card";
import { ActionCard } from "@/components/action-card";
import { ActivitySummary, LiveActivity, activitySteps } from "@/components/activity";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { splitReply } from "@/lib/markers";
import type { RecentEvent } from "@/lib/contract";

const MAX_BYTES = 10 * 1024 * 1024;

export function Chat() {
  const owner = useQuery(api.owners.getDemoOwner);

  if (owner === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (owner === null) {
    return (
      <div className="m-auto max-w-sm p-6 text-center text-sm">
        No owner yet. Run <code className="rounded bg-muted px-1">npm run seed</code>
      </div>
    );
  }
  return (
    <I18nProvider language={owner.preferredLanguage}>
      <OwnerChat owner={owner} />
    </I18nProvider>
  );
}

function OwnerChat({ owner }: { owner: Doc<"owners"> }) {
  const { t } = useI18n();
  const { results: messages } = useUIMessages(
    api.chat.listThreadMessages,
    { threadId: owner.agentThreadId },
    { initialNumItems: 50, stream: true },
  );
  const documents = useQuery(api.documents.listForOwner, { ownerId: owner._id });
  const docsById = new Map((documents ?? []).map((d) => [d._id as string, d]));
  // TODO: after Track A's PR, use events.listRecentForOwner({ ownerId, sinceMs }).
  const events: RecentEvent[] = useQuery(api.events.listForOwner, { ownerId: owner._id, limit: 100 }) ?? [];

  // Messages to show: user messages, and assistant messages that have text.
  // Tool calls and results are hidden; the document card shows what was read.
  const visible = messages.filter(
    (m) => m.role === "user" || (m.role === "assistant" && m.text.trim() !== ""),
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

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length, working]);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col">
      <Header owner={owner} />

      <main className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {visible.length === 0 && (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {t("chat.empty")}
          </p>
        )}
        {visible.map((m, i) => {
          const docId = m.role === "user" ? m.text.match(DOCUMENT_MARKER)?.[1] : undefined;
          if (docId) {
            return (
              <div key={m.key} className="flex justify-end">
                <DocumentCard doc={docsById.get(docId)} />
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
                />
              )}
            </div>
          );
        })}
        {working && <LiveActivity steps={liveSteps} />}
        <div ref={bottomRef} />
      </main>

      <Composer ownerId={owner._id} />
    </div>
  );
}

function Header({ owner }: { owner: Doc<"owners"> }) {
  const { t } = useI18n();
  const setLanguage = useMutation(api.owners.setLanguage);
  return (
    <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
      <div className="min-w-0">
        <div className="truncate font-semibold">{owner.businessName}</div>
        <div className="text-xs text-muted-foreground">Ledger</div>
      </div>
      <Select
        value={owner.preferredLanguage}
        onValueChange={(language) => {
          if (language) void setLanguage({ ownerId: owner._id, language });
        }}
      >
        <SelectTrigger className="w-36" aria-label={t("chat.language")}>
          <SelectValue>
            {(code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {LANGUAGES.map((l) => (
            <SelectItem key={l.code} value={l.code}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </header>
  );
}

function Composer({ ownerId }: { ownerId: Id<"owners"> }) {
  const { t } = useI18n();
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const ingestWebUpload = useMutation(api.intake.ingestWebUpload);
  const sendMessage = useMutation(api.chat.sendMessage);
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
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await ingestWebUpload({ ownerId, storageId, mimeType: file.type });
    } catch (e) {
      console.error(e);
      setError(t("chat.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    await sendMessage({ ownerId, text: t });
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
    </footer>
  );
}
