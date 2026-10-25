"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Clock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useClockOffset, useNow } from "@/lib/clock";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

// The demo clock (Step 4 brief, Section 4): skip time forward to see reminders
// and escalations, then reset. Opened from the app menu.

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DemoClockDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, language } = useI18n();
  const now = useNow();
  const offset = useClockOffset();
  const advance = useMutation(api.clock.advance);
  const setDate = useMutation(api.clock.setDate);
  const reset = useMutation(api.clock.reset);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");

  async function run(change: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await change();
    } catch (e) {
      setError(errorMessage(t, e, "action.error"));
    } finally {
      setPending(false);
    }
  }

  const today = now ? isoOf(now) : "";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("clock.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("clock.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-muted px-3 py-2 text-sm">
            {t("clock.current")} <span className="font-medium">{today ? formatDate(today, language) : "…"}</span>
            {offset !== 0 && <span className="text-muted-foreground"> · {t("clock.skipped")}</span>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[1, 7, 30].map((days) => (
              <Button key={days} variant="outline" disabled={pending} onClick={() => void run(() => advance({ days }))}>
                {t(days === 1 ? "clock.plusDay" : days === 7 ? "clock.plusWeek" : "clock.plus30")}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              type="date"
              value={picked}
              min={today}
              onChange={(e) => setPicked(e.target.value)}
              aria-label={t("clock.pickDate")}
            />
            <Button
              variant="outline"
              disabled={pending || !picked || picked < today}
              onClick={() => void run(() => setDate({ isoDate: picked }))}
            >
              {t("clock.go")}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <AlertDialogFooter>
          <Button variant="outline" disabled={pending || offset === 0} onClick={() => void run(() => reset({}))}>
            {t("clock.reset")}
          </Button>
          <AlertDialogCancel>{t("clock.close")}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "Demo date: Dec 8, 2026", shown at the top of the app while the clock is skipped ahead. */
export function DemoClockBanner() {
  const { t, language } = useI18n();
  const now = useNow();
  const offset = useClockOffset();
  if (offset === 0 || !now) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <Clock className="size-3.5" />
      {t("clock.banner", { date: formatDate(isoOf(now), language) })}
    </div>
  );
}
