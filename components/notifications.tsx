"use client";

import { useEffect, useState } from "react";
import { Bell, Loader2, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { usePush } from "@/lib/push";

// The in-chat prompt to turn on notifications (docs/ledger-step3-B.md, 6).
// It asks only from a tap. On iPhone in Safari it shows install steps instead,
// because iOS only allows web push for apps added to the Home Screen.

const DISMISS_KEY = "ledger.pushBannerDismissed";

export function NotificationBanner({ push }: { push: ReturnType<typeof usePush> }) {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let value = false;
    try {
      value = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists after mount
    setDismissed(value);
  }, []);

  if (dismissed) return null;
  if (push.state !== "default" && push.state !== "needs_install" && push.state !== "denied") {
    return null;
  }

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
      {push.state === "needs_install" ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 font-medium">
            <Bell className="size-4" /> {t("push.installTitle")}
          </div>
          <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
            <li>
              {t("push.installStep1")} <Share className="inline size-3.5 align-[-2px]" />
            </li>
            <li>{t("push.installStep2")}</li>
            <li>{t("push.installStep3")}</li>
          </ol>
        </div>
      ) : push.state === "denied" ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <Bell className="size-4" /> {t("push.deniedTitle")}
          </div>
          <p className="text-muted-foreground">{t("push.deniedBody")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <Bell className="size-4" /> {t("push.bannerTitle")}
          </div>
          <p className="text-muted-foreground">{t("push.bannerBody")}</p>
          {failed && <p className="text-destructive">{t("push.failed")}</p>}
          <Button
            disabled={push.busy}
            onClick={() => {
              setFailed(false);
              push.enable().catch((e) => {
                console.error(e);
                setFailed(true);
              });
            }}
          >
            {push.busy && <Loader2 className="animate-spin" />}
            {t("push.turnOn")}
          </Button>
        </div>
      )}
    </div>
  );
}
