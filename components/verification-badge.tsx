"use client";

import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Verdict } from "@/lib/contract";

const STYLES: Record<Verdict, string> = {
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  suspicious: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  unverified: "bg-muted text-muted-foreground",
};

export function VerificationBadge({ verdict }: { verdict: Verdict }) {
  const { t } = useI18n();
  const Icon =
    verdict === "verified" ? ShieldCheck : verdict === "suspicious" ? ShieldAlert : ShieldQuestion;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[verdict]}`}
    >
      <Icon className="size-3.5" />
      {t(`verify.${verdict}`)}
    </span>
  );
}
