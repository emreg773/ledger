import { ConvexError } from "convex/values";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { logEvent } from "./events";

// Abuse limits (Step 3 brief, Section 6). The global daily cap on agent runs is
// the kill switch for the Claude bill; LEDGER_DAILY_RUN_LIMIT overrides it.

const DAY = 24 * HOUR;
const DEFAULT_DAILY_RUNS = 600;

const rateLimiter = new RateLimiter(components.rateLimiter, {
  upload: { kind: "fixed window", rate: 10, period: HOUR },
  chatMessage: { kind: "fixed window", rate: 40, period: HOUR },
});

function dailyRunLimit(): number {
  const n = Number(process.env.LEDGER_DAILY_RUN_LIMIT);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_RUNS;
}

type Limit = "upload" | "chatMessage";

function rateLimited(retryAfterMs: number | undefined): ConvexError<{ code: string; retryAfterMs: number; message: string }> {
  return new ConvexError({
    code: "rate_limited",
    retryAfterMs: Math.ceil(retryAfterMs ?? HOUR),
    message: "Too many requests. Try again later.",
  });
}

/**
 * Consumes one unit of the owner's limit and one agent run from the global cap.
 * Throws rate_limited. The mutation rolls back, so nothing is scheduled; it also
 * means a refused request can't log a rate_limited event (that would roll back too).
 */
export async function checkOwnerLimit(ctx: MutationCtx, ownerId: Id<"owners">, limit: Limit) {
  const status = await rateLimiter.limit(ctx, limit, { key: ownerId });
  if (!status.ok) throw rateLimited(status.retryAfter);
  await checkAgentRun(ctx);
}

/** One agent run from the global daily cap. Throws rate_limited. */
export async function checkAgentRun(ctx: MutationCtx) {
  const status = await rateLimiter.limit(ctx, "agentRunDaily", {
    config: { kind: "fixed window", rate: dailyRunLimit(), period: DAY },
  });
  if (!status.ok) throw rateLimited(status.retryAfter);
}

/** For internal triggers (follow-up replies): true if a run is allowed, else logs and returns false. */
export async function tryAgentRun(ctx: MutationCtx, ownerId: Id<"owners">): Promise<boolean> {
  const status = await rateLimiter.limit(ctx, "agentRunDaily", {
    config: { kind: "fixed window", rate: dailyRunLimit(), period: DAY },
  });
  if (!status.ok) {
    await logEvent(ctx, {
      ownerId,
      type: "rate_limited",
      summary: `Skipped a Ledger reply: the daily limit of ${dailyRunLimit()} Ledger runs was reached`,
    });
  }
  return status.ok;
}
