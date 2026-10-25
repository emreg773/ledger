"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { FileText, MessageSquare, Search, X } from "lucide-react";
import type { ConversationView } from "@/convex/conversations";
import { timeAgo } from "@/lib/format";
import { docTypeName, useI18n } from "@/lib/i18n";
import { useNow } from "@/lib/use-today";
import { cn } from "@/lib/utils";

// Conversation history, like a chatbot's past chats: a search box and every
// conversation, most recent first. A centered card over the page; clicking
// outside it or pressing Escape closes it. New conversations start only from
// the home screen's message box or Telegram.

/** A conversation's name: the letter that started it, its first message, or a fallback. */
export function conversationTitle(t: ReturnType<typeof useI18n>["t"], c: ConversationView) {
  if (c.earlier) return t("conv.earlier");
  if (c.docType && c.docType !== "UNKNOWN") return docTypeName(t, c.docType);
  return c.title ?? (c.docType ? docTypeName(t, c.docType) : t("conv.untitled"));
}

export function ConversationsDialog({
  open,
  onOpenChange,
  conversations,
  activeThreadId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: ConversationView[] | undefined;
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
}) {
  const { t, language } = useI18n();
  const now = useNow();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const shown = (conversations ?? []).filter(
    (c) => !needle || conversationTitle(t, c).toLocaleLowerCase().includes(needle),
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSearch("");
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs" />
        <Dialog.Popup className="ledger-card fixed top-[10vh] left-1/2 z-50 flex max-h-[75vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden bg-card transition-[opacity,transform] duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
          <Dialog.Title className="sr-only">{t("home.conversations")}</Dialog.Title>
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("conv.search")}
              aria-label={t("conv.search")}
              className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            <Dialog.Close
              aria-label={t("push.dismiss")}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="px-3 pt-1 pb-1 text-xs font-medium text-muted-foreground uppercase">{t("conv.recents")}</div>
            {conversations === undefined ? null : shown.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {conversations.length === 0 ? t("conv.empty") : t("conv.noMatch")}
              </p>
            ) : (
              <ul>
                {shown.map((c) => {
                  const Icon = c.docType ? FileText : MessageSquare;
                  const active = c.threadId === activeThreadId;
                  return (
                    <li key={c.threadId}>
                      <button
                        type="button"
                        onClick={() => onSelect(c.threadId)}
                        aria-current={active || undefined}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted",
                          active && "bg-muted",
                        )}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm">{conversationTitle(t, c)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {now !== null && timeAgo(c.lastMessageAt, Math.max(now, c.lastMessageAt), language)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
