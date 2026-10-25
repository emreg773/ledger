# Ledger: Step 4 Brief, Person B (Telegram, weekly roundup, nudges, calendar filter, Upcoming panel)

You're continuing **Ledger**, a hackathon project (Cal Hacks 13.0, deadline **Sunday Oct 25, 2026, 9:00 AM PT**). Before writing code, read these in the repo: `docs/ledger-step1.md` (Sections 1 to 3), `STEP3_REPORT.md`, `STEP3_5_REPORT.md`, and the current `convex/push.ts`, `convex/notifications.ts`, `convex/googleCalendar.ts`, `convex/intake.ts`, `convex/http.ts`, and `convex/crons.ts`.

**Keep it simple.** This only has to work on two developers' devices. No new rate limits, no new auth work, no production hardening.

Two people work in parallel. **You are Person B.** Person A is building case memory, the demo clock, and deadline reminders from a sibling brief, and owns the schema. Each person owns their features end to end, including UI. Follow the contract in Section 7 and the file ownership in Section 8.

---

## 1. Your features

1. **Telegram:** the owner sends a photo or file of a letter to the Ledger bot, and Ledger reads it like an upload. The bot also sends notifications. It doesn't hold conversations.
2. **Weekly roundup:** a short summary every week, sent on Telegram.
3. **Nudges:** warm, short reminders on Telegram when something is waiting on the owner.
4. **Calendar compliance filter:** picks out compliance-related events from the owner's synced Google Calendar.
5. **Upcoming panel:** one list of everything coming up.

**Channel rules**
- **Deadline reminders** are push notifications. Person A sends these.
- **The roundup and nudges** go to Telegram. If the owner hasn't linked Telegram, send them as push instead.
- **Every message Ledger sends** goes into the notification history. For Telegram messages, use `queuePush` with `deliver: "history_only"`.

## 2. First 20 minutes

Person A merges a schema PR with everything you need:
- `owners.telegramChatId`
- the `telegramLinkCodes` table
- `"telegram"` as a document `source`, and `documents.hint`
- the `sentLog` table
- the `"reminder"` category, and the push kinds `weekly_roundup` and `nudge`
- `queuePush`'s `deliver` option

Until it lands, build the Telegram plumbing (webhook route, sending, file download) with stubs. **Never edit `convex/schema.ts`.** Ask Person A instead.

## 3. Telegram

**Setup**
- Env vars on each Convex deployment: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.
- There's **one bot** for the whole team, so its webhook points at one deployment at a time. Write `scripts/telegram-webhook.ts <convex-site-url>`. It calls Telegram's `setWebhook` with `url = <convex-site-url>/telegram/webhook` and `secret_token = TELEGRAM_WEBHOOK_SECRET`, then prints `getWebhookInfo`. Add `npm run telegram:webhook`.
- Verify the Bot API details against https://core.telegram.org/bots/api before coding: `setWebhook`, `sendMessage`, `getFile`, the file download URL, the update shapes, and the `X-Telegram-Bot-Api-Secret-Token` header.

**Webhook route:** `POST /telegram/webhook` in `convex/http.ts`.
- Reject requests whose secret header doesn't match.
- Schedule the processing and return 200 immediately, so Telegram doesn't retry.

**Linking an owner to a chat**
- `telegram.createLinkCode` (mutation, signed-in owner) creates a short random code in `telegramLinkCodes` and returns `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>`.
- When the bot receives `/start <code>`, it sets `owners.telegramChatId`, deletes the code, and replies in the owner's language: "Connected to Ledger. Send me a photo of any government letter."
- `telegram.disconnect` (mutation) clears the chat ID.
- **UI:** a "Connect Telegram" item in the app menu. It opens the link and shows "Connected" with a Disconnect option once linked.

**Inbound documents** (from a linked chat only)
1. A **photo:** take the largest size. A **document:** accept PDF, JPEG, PNG, or WebP; anything else gets the fixed "unsupported file" reply.
2. Download it with `getFile` plus the file URL, store it in Convex storage, then call `internal.intake.ingestDocument({ ownerId, storageId, mimeType, source: "telegram", sourceRef: <message_id>, hint: <caption> })`.
3. **The caption is a hint only.** No buttons and no asking for a document type. Ledger classifies the document by itself; the caption (e.g. "carta del IRS") just helps when a photo is unclear.
4. Reply right away: "Got it. I'm reading it now…" (translated).
5. When the agent finishes, Person A's code calls your `telegram.notifyDocumentResult`. Send the title and body, plus a link: `<SITE_URL>/?case=<caseId>`.

**Any other text, or a message from an unlinked chat:** one fixed reply, translated. Linked: "To chat with Ledger, open the app: <link>. To send a letter, send a photo or a file here." Unlinked: "Open Ledger and tap Connect Telegram first."

Add a one-line tip to the "Connected" reply: sending a letter as a file keeps it sharper than sending it as a photo.

**`telegram.sendMessage({ ownerId, text })` (internal action):** plain text, no Markdown parsing (to avoid escaping bugs). It does nothing if the owner has no chat ID.

## 4. Weekly roundup and nudges (`convex/digest.ts`)

**Time:** always use Person A's `clock.nowMs(ctx, ownerId)`, never `Date.now()`, so the demo clock works.

**`digest.runDue({ ownerId })` (internal action)** is called hourly by your cron and by Person A's clock catch-up. It sends:

**Weekly roundup:** once per week, on Mondays at 9:00 Pacific or later.
- Use `sentLog` key `roundup|<ISO week>`. After a clock skip, send only the latest week's roundup, never a backlog.
- **Content,** short:
  1. A greeting with the owner's name
  2. Deadlines in the next 14 days, from Person A's `deadlines.upcoming`, covering case, general, and calendar items
  3. Actions waiting on the owner
  4. What got done last week
  5. A link to the app
- If there's nothing at all, send a short "All clear this week" message.

**Nudges:** at most one per case per demo day (`sentLog` key `nudge|<caseId>|<YYYY-MM-DD>`).
- A proposed `one_tap` action is still waiting after 2 days. Example: "¿Le doy luz verde al pago de $520 al IRS? Solo toque Aprobar en la app."
- An `owner_task` is still open after 3 days.
- A case deadline is 3 days away or less and the case is still open.

**Tone:** warm, short, and casual in feel, but formal "usted" in Spanish. One emoji at most. Templates in **en, es, and tr**, in `convex/digestTemplates.ts`. No LLM calls.

**Delivery:** Telegram if linked, otherwise push. Always record in the history (category `reminder`, kinds `weekly_roundup` and `nudge`).

**A "Send roundup now" button** in the demo clock panel, or the app menu if Person A's panel isn't merged yet, for the demo.

## 5. Calendar compliance filter (`convex/calendarCompliance.ts`)

**`calendarCompliance.list({ ownerId, fromIso, toIso })` (internal query):** filters the owner's synced `calendarEvents` by keywords in the title. Match case-insensitively and ignore accents.
- **en:** tax, taxes, IRS, 941, 1099, W-2, payroll, permit, license, licence, inspection, health, renewal, filing, deadline
- **es:** impuesto, impuestos, permiso, licencia, inspección, salud, renovación, declaración, vencimiento
- **tr:** vergi, ruhsat, lisans, denetim, sağlık, yenileme, beyanname, son gün

It's rule-based only. **Calendar events are never sent to Anthropic.** Returns `[{ key: "cal|<googleId>", date, time?, title, link? }]`.

## 6. Upcoming panel (UI)

On the home screen, show Person A's `deadlines.upcoming` for the next 60 days:
- **Grouping:** "This week," "Next 2 weeks," "Later"
- **Source chips:** Letter (case), Tax calendar (general), Your calendar (calendar)
- **Countdown** using Person A's `useNow()` from `lib/clock.ts`, so it follows the demo clock
- **Tapping an item** opens the case, or the Google Calendar link

Use translated strings (en, es, tr). Build it against mock data until Person A merges.

## 7. Contract

**You implement:**

| Function | Type | Args | Returns |
|---|---|---|---|
| `telegram.createLinkCode` | mutation | `{}` | deep link URL |
| `telegram.disconnect` | mutation | `{}` | `null` |
| `telegram.status` | query | `{}` | `{ linked: boolean }` |
| `telegram.sendMessage` | internal action | `{ ownerId, text }` | `null` |
| `telegram.notifyDocumentResult` | internal action | `{ ownerId, documentId, caseId?, title, body }` | `null` |
| `calendarCompliance.list` | internal query | `{ ownerId, fromIso, toIso }` | items |
| `digest.runDue` | internal action | `{ ownerId }` | `null` |
| `digest.sendRoundupNow` | mutation | `{}` | `null` |

**Person A implements** (you call these; use stubs until merged):

| Function | Type | Args | Returns |
|---|---|---|---|
| `intake.ingestDocument` | internal mutation | `{ ownerId, storageId, mimeType, source, sourceRef?, hint? }` | `documentId` |
| `deadlines.upcoming` | query | `{ fromIso, toIso }` | `[{ key, date, title, source, caseId?, link? }]` |
| `clock.nowMs` | helper (import) | `(ctx, ownerId)` | number |
| `lib/clock.ts` `useNow()` | React hook | none | `Date` |
| `push.queuePush` | existing | plus `deliver?: "push" \| "history_only"` | as today |

## 8. Files

- **You own:** `convex/telegram.ts`, `convex/digest.ts`, `convex/digestTemplates.ts`, `convex/calendarCompliance.ts`, `convex/http.ts` (add the Telegram route; keep the existing routes), `scripts/telegram-webhook.ts`, and new components for the Upcoming panel and the Telegram connect item.
- **Ask Person A for:** schema changes, and your cron entries in `convex/crons.ts` (hourly `digest.runDueAll`), or add them yourself in a separate small commit that Person A reviews.
- **Shared, `messages/*.json`:** add your keys under the top-level `telegram`, `digest`, and `upcoming` sections only.

## 9. Git
1. Branch `b/step4-...`. Open PRs; Person A reviews.
2. Merging doesn't deploy. A developer deploys production by hand.

## 10. Acceptance (on your dev deployment, with the webhook pointed at it)
- [ ] The deep link connects a Telegram chat; the bot confirms in the owner's language
- [ ] Sending the CP14 photo creates a document with `source: "telegram"`. The bot replies "reading it" right away, then sends the result with a case link, and the case appears in the app.
- [ ] A PDF sent as a file works; a `.docx` gets the "unsupported file" reply
- [ ] Text messages get the fixed reply; nothing else answers
- [ ] A caption like "carta del IRS" is stored as `hint`; classification still matches the document
- [ ] After a demo clock skip past a Monday 9:00, exactly one roundup arrives; skipping again in the same week sends none
- [ ] A 972CG payment left unapproved for 2+ demo days produces one nudge; it doesn't repeat the same demo day
- [ ] Without Telegram linked, the roundup and nudges arrive as push
- [ ] Every Telegram message also appears in the notification history
- [ ] A calendar event titled "Pay quarterly taxes" appears in the Upcoming panel as "Your calendar"; a "Dentist" event doesn't
- [ ] Upcoming countdowns follow the demo clock

## 11. When you finish
Write `STEP4_REPORT_B.md`: what you built, deviations, known issues, and the production env vars or setup steps needed for the next deploy (including pointing the webhook at production).
