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

// The current time, refreshed every minute, for "5 minutes ago" labels. Null
// on the server for the same reason as useToday.
let nowMs = 0;
function subscribeMinute(onChange: () => void) {
  const timer = setInterval(() => {
    nowMs = Date.now();
    onChange();
  }, 60_000);
  return () => clearInterval(timer);
}
function getNow() {
  // Refresh on first read in the browser; after that only the ticker moves it.
  if (nowMs === 0) nowMs = Date.now();
  return nowMs;
}

export function useNow(): number | null {
  return useSyncExternalStore(subscribeMinute, getNow, () => null);
}
