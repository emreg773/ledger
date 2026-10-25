"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Briefcase,
  ExternalLink,
  Landmark,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { InboxEmail } from "@/convex/gmail";
import { Button } from "@/components/ui/button";
import { openCase } from "@/components/notification-center";
import { timeAgo } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useNow } from "@/lib/use-today";
import { cn } from "@/lib/utils";

// The home screen's E-posta tab: the owner's Gmail, sorted by Ledger.
// Government senders on top, then suspicious ones, then business mail; the
// rest is folded away. Spam, Promotions and Social never get here at all.

type Category = InboxEmail["category"];
type GmailStatus =
  | { connected: false }
  | { connected: true; emailAddress?: string; lastSyncedAt?: number; error?: string };

const GROUPS: { category: Category; label: MessageKey; icon: LucideIcon; tone: string; card?: string }[] = [
  {
    category: "government",
    label: "mail.government",
    icon: Landmark,
    tone: "text-amber-700 dark:text-amber-400",
    card: "border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
  },
  {
    category: "suspicious",
    label: "mail.suspicious",
    icon: TriangleAlert,
    tone: "text-destructive",
    card: "border border-destructive/40 bg-destructive/5",
  },
  { category: "business", label: "mail.business", icon: Briefcase, tone: "text-sky-700 dark:text-sky-400" },
  { category: "other", label: "mail.other", icon: Mail, tone: "text-muted-foreground" },
];

export function EmailInbox({
  title,
  preview,
}: {
  title: React.ReactNode;
  /** /dev only: mock data instead of the backend. */
  preview?: { status: GmailStatus; emails: InboxEmail[] };
}) {
  const { t, language } = useI18n();
  const now = useNow();
  const fetchedStatus = useQuery(api.gmail.status, preview ? "skip" : {});
  const fetchedEmails = useQuery(api.gmail.inbox, preview ? "skip" : {});
  const status = preview ? preview.status : fetchedStatus;
  const emails = preview ? preview.emails : fetchedEmails;
  const startConnect = useMutation(api.gmail.startConnect);
  const syncNow = useMutation(api.gmail.syncNow);
  const disconnect = useMutation(api.gmail.disconnect);
  const readAttachment = useMutation(api.gmail.readAttachment);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<"connected" | "error" | "scope" | "cancelled" | null>(null);
  const [showOther, setShowOther] = useState(false);

  // Google sends the owner back to /?gmail=connected (or =error&reason=…).
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("gmail");
    if (result !== "connected" && result !== "error") return;
    const reason = url.searchParams.get("reason");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is only readable after mount
    setNotice(result === "error" && (reason === "scope" || reason === "cancelled") ? reason : result);
    url.searchParams.delete("gmail");
    url.searchParams.delete("reason");
    window.history.replaceState(null, "", url);
  }, []);

  async function connect() {
    if (preview) return;
    setPending(true);
    try {
      window.location.href = await startConnect({});
    } catch (e) {
      console.error(e);
      setNotice("error");
      setPending(false);
    }
  }

  const broken = status?.connected && status.error;
  const header = (
    <div className="flex flex-col gap-2 border-b p-4">
      {title}
      {notice === "error" && <p className="text-xs text-destructive">{t("mail.connectError")}</p>}
      {notice === "scope" && <p className="text-xs text-destructive">{t("mail.scopeMissing")}</p>}
      {notice === "cancelled" && <p className="text-xs text-muted-foreground">{t("mail.cancelled")}</p>}
      {status?.connected && !broken && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {status.emailAddress ?? "Gmail"}
            {" · "}
            {status.lastSyncedAt && now !== null
              ? t("mail.synced", { when: timeAgo(status.lastSyncedAt, Math.max(now, status.lastSyncedAt), language) })
              : t("mail.syncing")}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              className="flex items-center gap-1 hover:text-foreground"
              onClick={() => !preview && void syncNow({})}
            >
              <RefreshCw className="size-3" /> {t("mail.refresh")}
            </button>
            <button type="button" className="hover:text-foreground" onClick={() => !preview && void disconnect({})}>
              {t("mail.disconnect")}
            </button>
          </span>
        </div>
      )}
    </div>
  );

  if (status === undefined) return header;

  if (!status || !status.connected || broken) {
    return (
      <>
        {header}
        <div className="space-y-3 p-4 text-sm">
          <p className="font-medium">{broken ? t("mail.revoked") : t("mail.pitchTitle")}</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t("mail.pitch1")}</li>
            <li>{t("mail.pitch2")}</li>
            <li>{t("mail.pitch3")}</li>
          </ul>
          <Button disabled={pending} onClick={() => void connect()}>
            {pending ? <Loader2 className="animate-spin" /> : <Mail />}
            {broken ? t("mail.reconnect") : t("mail.connect")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("mail.warning")}</p>
        </div>
      </>
    );
  }

  const groups = GROUPS.map((g) => ({ ...g, items: (emails ?? []).filter((e) => e.category === g.category) }));
  const shown = groups.filter((g) => g.items.length > 0 && (g.category !== "other" || showOther));
  const others = groups.find((g) => g.category === "other")!.items.length;

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {emails === undefined ? null : emails.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("mail.empty")}</p>
        ) : (
          <>
            {shown.map((g) => (
              <section key={g.category} className="mb-3" aria-label={t(g.label)}>
                <h3 className={cn("flex items-center gap-1.5 px-2 pb-1.5 text-xs font-medium uppercase", g.tone)}>
                  <g.icon className="size-3.5" /> {t(g.label)} · {g.items.length}
                </h3>
                <ul className="space-y-1">
                  {g.items.map((e) => (
                    <EmailRow
                      key={e._id}
                      e={e}
                      card={g.card}
                      now={now}
                      onRead={() => !preview && void readAttachment({ messageId: e._id })}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {others > 0 && (
              <button
                type="button"
                className="w-full px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowOther((s) => !s)}
              >
                {showOther ? t("mail.hideOther") : t("mail.showOther", { count: others })}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

function EmailRow({
  e,
  card,
  now,
  onRead,
}: {
  e: InboxEmail;
  card?: string;
  now: number | null;
  onRead: () => void;
}) {
  const { t, language } = useI18n();
  const attachment = e.attachments.find((a) =>
    ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(a.mimeType),
  );
  const showReasons = e.category === "government" || e.category === "suspicious";

  return (
    <li className={cn("rounded-lg px-2 py-2.5", card)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">{e.fromName}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {now !== null && timeAgo(e.receivedAt, Math.max(now, e.receivedAt), language)}
        </span>
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">{e.fromDomain}</div>
      <p className="mt-0.5 truncate text-sm">{e.subject || t("mail.noSubject")}</p>
      <p className="line-clamp-1 text-xs text-muted-foreground">{e.snippet}</p>
      {showReasons && e.reasons.length > 0 && (
        <p className={cn("mt-1 text-xs", e.category === "suspicious" ? "text-destructive" : "text-muted-foreground")}>
          {e.reasons.join(" · ")}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {attachment && (
          <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
            <Paperclip className="size-3 shrink-0" />
            <span className="max-w-40 truncate">{attachment.filename}</span>
          </span>
        )}
        {e.caseId ? (
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => openCase(e.caseId!)}>
            {t("mail.openInLedger")}
          </button>
        ) : e.documentId ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> {t("mail.reading")}
          </span>
        ) : (
          attachment && (
            <button type="button" className="font-medium underline underline-offset-2" onClick={onRead}>
              {t("mail.readWithLedger")}
            </button>
          )
        )}
        <a
          href={`https://mail.google.com/mail/u/0/#all/${e.threadId}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          {t("mail.openInGmail")} <ExternalLink className="size-3" />
        </a>
      </div>
    </li>
  );
}
