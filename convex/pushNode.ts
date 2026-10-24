"use node";

import { v } from "convex/values";
import webpush from "web-push";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// Sends one push to every device an owner subscribed (Step 3 brief, Section 7).
// web-push needs Node, so this file runs in the Node runtime. It never throws:
// a failed push must not break the agent run that triggered it.

/**
 * VAPID subject: a mailto: or https: contact that push services can reach. Falls
 * back to SITE_URL on production, and to the project's repo when neither is usable
 * (dev's SITE_URL is http://localhost, which push services reject).
 */
function vapidSubject(): string {
  for (const subject of [process.env.VAPID_SUBJECT, process.env.SITE_URL]) {
    if (subject && /^(mailto:|https:)/.test(subject)) return subject;
  }
  return "https://github.com/emreg773/ledger";
}

export const send = internalAction({
  args: {
    ownerId: v.id("owners"),
    caseId: v.optional(v.id("cases")),
    payload: v.object({ title: v.string(), body: v.string(), url: v.string(), tag: v.string() }),
    summary: v.string(), // English, for the push_sent event
  },
  handler: async (ctx, { ownerId, caseId, payload, summary }) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      await ctx.runMutation(internal.events.log, {
        ownerId,
        caseId,
        type: "push_failed",
        summary: "Push not sent: VAPID keys are not set on this deployment",
      });
      return;
    }
    webpush.setVapidDetails(vapidSubject(), publicKey, privateKey);

    const subscriptions = await ctx.runQuery(internal.push.subscriptionsFor, { ownerId });
    let sent = 0;
    const failures: string[] = [];
    for (const s of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser unsubscribed or the app was uninstalled: forget this device.
          await ctx.runMutation(internal.push.deleteSubscription, { subscriptionId: s._id });
        } else {
          failures.push(`${status ?? "error"}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
        }
      }
    }

    if (sent > 0) {
      await ctx.runMutation(internal.events.log, {
        ownerId,
        caseId,
        type: "push_sent",
        summary: `Push sent to ${sent} device${sent === 1 ? "" : "s"}: ${summary}`,
        data: { tag: payload.tag },
      });
    }
    if (failures.length > 0) {
      await ctx.runMutation(internal.events.log, {
        ownerId,
        caseId,
        type: "push_failed",
        summary: `Push failed on ${failures.length} device${failures.length === 1 ? "" : "s"}: ${failures[0]}`,
      });
    }
  },
});
