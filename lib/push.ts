"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

// Browser side of web push (docs/ledger-step3-B.md, Section 6). Track A sends
// every push; this file only registers the service worker and keeps the
// owner's subscription saved on the server.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type PushState =
  | "loading"
  | "unsupported" // no service worker / PushManager, or no VAPID key configured
  | "needs_install" // iPhone/iPad in Safari: push only works from the Home Screen
  | "default" // not asked yet
  | "denied"
  | "on";

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac with touch.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function subscriptionArgs(sub: PushSubscription) {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    userAgent: navigator.userAgent,
  };
}

/** Registers /sw.js. Safe to call more than once. */
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
}

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const save = useMutation(api.push.saveSubscription);
  const remove = useMutation(api.push.removeSubscription);

  // On load: work out the state, and re-save an existing subscription. The
  // upsert covers a rotated endpoint or another owner signing in on this device.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        const next = isIOS() && !isStandalone() ? "needs_install" : "unsupported";
        if (!cancelled) setState(next);
        return;
      }
      if (!VAPID_PUBLIC_KEY) {
        if (!cancelled) setState("unsupported");
        return;
      }
      const registration = await registerServiceWorker();
      const sub = await registration?.pushManager.getSubscription();
      if (Notification.permission === "granted" && sub) {
        try {
          await save(subscriptionArgs(sub));
        } catch (e) {
          console.error(e);
        }
      }
      if (cancelled) return;
      if (Notification.permission === "denied") setState("denied");
      else if (Notification.permission === "granted" && sub) setState("on");
      else setState("default");
    })();
    return () => {
      cancelled = true;
    };
  }, [save]);

  /** Must run from a tap: browsers block permission prompts on page load. */
  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "default");
        return false;
      }
      const registration = (await registerServiceWorker())!;
      await navigator.serviceWorker.ready;
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));
      await save(subscriptionArgs(sub));
      setState("on");
      return true;
    } finally {
      setBusy(false);
    }
  }, [save]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const sub = await registration?.pushManager.getSubscription();
      if (sub) {
        await remove({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("default");
    } finally {
      setBusy(false);
    }
  }, [remove]);

  return { state, busy, enable, disable };
}
