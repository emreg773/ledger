"use client";

import { useSyncExternalStore } from "react";

// Today's date, read only in the browser. On the server (prerender) it's null,
// so Next's Cache Components never sees `new Date()` during render; countdowns
// appear after hydration.

function todayMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

const subscribe = () => () => {};

export function useToday(): Date | null {
  const ms = useSyncExternalStore(subscribe, todayMs, () => null);
  return ms === null ? null : new Date(ms);
}
