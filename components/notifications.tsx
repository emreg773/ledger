"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Bell, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";

// The prompt to turn on notifications. Notifications are Telegram messages
// from the Ledger bot (convex/nudges.ts), so turning them on means linking
// Telegram. Web push is off for now; its hook stays in lib/push.ts.

const DISMISS_KEY = "ledger.telegramBannerDismissed";

/** Telegram link state and actions, shared by this banner and the app menu. */
export function useTelegram({ preview = false }: { preview?: boolean } = {}) {
  const { t } = useI18n();
  const status = useQuery(api.telegram.status, preview ? "skip" : {});
  const createLink = useMutation(api.telegram.createLinkCode);
  const disconnect = useMutation(api.telegram.disconnect);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setError(null);
    // Open the tab now, while the tap still counts, and fill in the link after.
    const tab = window.open("", "_blank");
    try {
      const url = await createLink({});
      if (tab) tab.location.replace(url);
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      setError(errorMessage(t, e, "action.error"));
    }
  }

  return {
    available: preview || Boolean(status?.available),
    linked: Boolean(status?.linked),
    loading: !preview && status === undefined,
    error,
    connect,
    disconnect: () => void disconnect({}),
  };
}

export function NotificationBanner({ preview = false }: { preview?: boolean }) {
  const { t } = useI18n();
  const telegram = useTelegram({ preview });
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let value = false;
    try {
      value = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists after mount
    setDismissed(value);
  }, []);

  if (dismissed || telegram.loading || !telegram.available || telegram.linked) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  return (
    <div className="relative rounded-xl border bg-card p-3 pr-10 text-sm shadow-xs">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("push.dismiss")}
        className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground hover:bg-muted"
      >
        <X className="size-4" />
      </button>
      <div className="space-y-2 lg:flex lg:items-center lg:gap-4 lg:space-y-0">
        <div className="min-w-0 lg:flex-1">
          <div className="flex items-center gap-2 font-medium">
            <Bell className="size-4" /> {t("telegram.bannerTitle")}
          </div>
          <p className="text-muted-foreground">{t("telegram.bannerBody")}</p>
          {telegram.error && <p className="text-destructive">{telegram.error}</p>}
        </div>
        <Button className="lg:shrink-0" onClick={() => void telegram.connect()}>
          {t("telegram.connect")}
        </Button>
      </div>
    </div>
  );
}
