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
        No owner yet. Run <code className="rounded bg-muted px-1">npx convex run owners:seedDemoOwner</code>
      </div>
    );
  }
  return <OwnerChat owner={owner} />;
}

function OwnerChat({ owner }: { owner: Doc<"owners"> }) {
  const { results: messages } = useUIMessages(
    api.chat.listThreadMessages,
    { threadId: owner.agentThreadId },
    { initialNumItems: 50, stream: true },
  );
  const documents = useQuery(api.documents.listForOwner, { ownerId: owner._id });
  const docsById = new Map((documents ?? []).map((d) => [d._id as string, d]));

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
            Take a photo of any letter from the government. Ledger will read it for you.
          </p>
        )}
        {visible.map((m) => {
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
            <div key={m.key} className="flex justify-start">
              <div className="prose prose-sm max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
                <ReactMarkdown>{m.text}</ReactMarkdown>
              </div>
            </div>
          );
        })}
        {working && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Ledger is working...
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <Composer ownerId={owner._id} />
    </div>
  );
}

function Header({ owner }: { owner: Doc<"owners"> }) {
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
        <SelectTrigger className="w-36" aria-label="Language">
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
      setError("Please choose a photo or a PDF.");
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
        setError("That file is bigger than 10 MB.");
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
      setError(e instanceof Error ? e.message : "Upload failed");
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
          aria-label="Upload a photo or PDF"
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
          placeholder="Message Ledger"
          className="max-h-32 min-h-9 flex-1 resize-none"
        />
        <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim()}>
          <SendHorizontal />
        </Button>
      </form>
    </footer>
  );
}
