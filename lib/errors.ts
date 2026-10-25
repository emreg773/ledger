import { ConvexError } from "convex/values";
import type { T } from "@/lib/i18n";

// Track A's mutations throw ConvexError({ code, ... }) for errors the owner can
// act on (docs/ledger-step3-B.md, Section 7). Everything else is a bug: log it
// and show a generic line, never the raw message.

export type ErrorCode =
  | "not_signed_in"
  | "not_onboarded"
  | "rate_limited"
  | "unsupported_file"
  | "file_too_large"
  | "too_many_pages"
  | "files_too_large";

export function errorCode(e: unknown): { code?: ErrorCode; retryAfterMs?: number } {
  if (e instanceof ConvexError && typeof e.data === "object" && e.data !== null) {
    const data = e.data as { code?: ErrorCode; retryAfterMs?: number };
    return { code: data.code, retryAfterMs: data.retryAfterMs };
  }
  return {};
}

/** A translated, friendly line for a failed mutation. */
export function errorMessage(t: T, e: unknown, fallback: Parameters<T>[0]): string {
  const { code, retryAfterMs } = errorCode(e);
  switch (code) {
    case "rate_limited":
      return t("error.rateLimited", {
        minutes: Math.max(1, Math.ceil((retryAfterMs ?? 60_000) / 60_000)),
      });
    case "unsupported_file":
      return t("chat.uploadNotPhoto");
    case "file_too_large":
      return t("chat.uploadTooBig");
    case "too_many_pages":
      return t("chat.tooManyPages");
    case "files_too_large":
      return t("chat.pagesTooBig");
    case "not_signed_in":
    case "not_onboarded":
      return t("error.session");
    default:
      console.error(e);
      return t(fallback);
  }
}
