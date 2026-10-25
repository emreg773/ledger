"use client";

import { useDemoToday, useRealNowMs } from "@/lib/clock";

// Today's date, read only in the browser. On the server (prerender) it's null,
// so Next's Cache Components never sees `new Date()` during render; countdowns
// appear after hydration.

/** The owner's demo date (lib/clock.ts): countdowns and pinning follow the demo clock. */
export function useToday(): Date | null {
  return useDemoToday();
}

// The current time, refreshed every minute, for "5 minutes ago" labels. Null
// on the server for the same reason as useToday. Real time, not the demo clock:
// it's compared against real timestamps.
export function useNow(): number | null {
  return useRealNowMs();
}
