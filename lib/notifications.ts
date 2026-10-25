import type { NotificationView } from "@/convex/notifications";
import { daysUntil } from "@/lib/format";

// Which notifications are time-sensitive and pinned on top of the
// notification center. Decided in the browser because it depends on today.

/** Deadlines this close (or already past) pin the notification. */
export const PIN_WITHIN_DAYS = 14;

export function isTimeSensitive(n: NotificationView, today: Date): boolean {
  const c = n.case;
  if (!c || !c.deadline || c.status === "resolved" || !c.hasPendingAction) return false;
  return daysUntil(c.deadline, today) <= PIN_WITHIN_DAYS;
}

/**
 * Pinned: the newest time-sensitive notification of each case, soonest
 * deadline first. Rest: everything else, in the order given (newest first, or
 * by relevance when searching).
 */
export function splitPinned(
  items: NotificationView[],
  today: Date | null,
): { pinned: NotificationView[]; rest: NotificationView[] } {
  if (!today) return { pinned: [], rest: items };
  const newestPerCase = new Map<string, NotificationView>();
  for (const n of items) {
    if (!n.caseId || !isTimeSensitive(n, today)) continue;
    const seen = newestPerCase.get(n.caseId);
    if (!seen || n.createdAt > seen.createdAt) newestPerCase.set(n.caseId, n);
  }
  const pinned = [...newestPerCase.values()].sort((a, b) =>
    a.case!.deadline!.localeCompare(b.case!.deadline!),
  );
  const pinnedIds = new Set(pinned.map((n) => n._id));
  return { pinned, rest: items.filter((n) => !pinnedIds.has(n._id)) };
}
