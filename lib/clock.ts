"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// The demo clock in the browser. The offset comes
// from clock.get, so every countdown, the notification pinning and the calendar
// follow the owner's demo date. Relative ages ("5 min ago") keep using real
// time: they compare against real timestamps.

let realNowMs = 0;
function subscribeMinute(onChange: () => void) {
  const timer = setInterval(() => {
    realNowMs = Date.now();
    onChange();
  }, 60_000);
  return () => clearInterval(timer);
}
function getRealNow() {
  if (realNowMs === 0) realNowMs = Date.now();
  return realNowMs;
}

/** Real time, refreshed every minute. Null on the server (see lib/use-today.ts). */
export function useRealNowMs(): number | null {
  return useSyncExternalStore(subscribeMinute, getRealNow, () => null);
}

/** The signed-in owner's demo clock offset in ms (0 when off or signed out). */
export function useClockOffset(): number {
  return useQuery(api.clock.get)?.offsetMs ?? 0;
}

/** The owner's demo-adjusted current time, ticking every minute. Null on the server. */
export function useNow(): Date | null {
  const real = useRealNowMs();
  const offset = useClockOffset();
  return real === null ? null : new Date(real + offset);
}

/** Local midnight of the demo date. */
export function useDemoToday(): Date | null {
  const now = useNow();
  if (!now) return null;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
