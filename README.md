# Ledger

A multilingual AI agent for immigrant small business owners. Snap a photo of a government letter; Ledger reads it, explains it in your language, and does the follow-up work. Built at Cal Hacks 13.0.

Live at **https://ledger-ten-peach.vercel.app**, with the Telegram bot **@talk_to_ledger_agent**. Anyone with a Google account can sign in, set up their business, and get their own chat, sandbox bank and case history.

## How we use Convex

- Convex is the whole backend: schema, queries, mutations, actions, file storage and full text search.
- The `@convex-dev/agent` component stores the agent's threads and messages; the chat streams in live.
- HTTP actions serve the Telegram webhook and Google OAuth callback; crons and the scheduler run nudges, syncs and agent runs.
- Chat, home, calendar, case history and notifications update live through `useQuery`. Details in [hackathon.md](hackathon.md).

## What Ledger does

Ledger investigates a letter before it answers: it reads it, checks the sender against official contacts, loads the official playbook for that notice, and checks the owner's bank. Then it explains in the owner's language and proposes actions, which the owner approves on a card. The owner only snaps a photo, taps Approve or marks a task done.

| Support | Documents |
|---|---|
| Full workflow (check, explain, propose an action) | IRS CP14, IRS CP504 (CP504B), IRS 972CG, Alameda County health inspections |
| Explanation only | City fines, city code violations, late business-license notices |
| Anything else | `UNKNOWN`: Ledger says it can't help yet and suggests a professional, but still warns if it looks like a scam |

Ledger knows the IRS, Alameda County Environmental Health and the City of Oakland. New owners default to Oakland, Alameda County, CA. UI and agent languages are English, Spanish (formal "usted") and Turkish.

The bank is a sandbox (Capital One's Nessie API, or a mock): money is fake, and the UI labels it "Sandbox bank" wherever a payment appears.

## Stack

Next.js 16 (App Router) + Tailwind 4 + shadcn/ui on Base UI · Convex (DB, storage, scheduler, crons, HTTP routes) · Convex Auth (Google) · `@convex-dev/agent` · Vercel AI SDK 7 + Anthropic (`claude-sonnet-5-5`, for chat and extraction; set in `convex/models.ts`) · `libphonenumber-js` · `web-push` · Vercel

Pinned versions that matter:

- **`ai@7.0.28` and `@ai-sdk/anthropic@4.0.15`** are the versions `@convex-dev/agent@0.7.8` is tested against. With newer `ai`, `new Agent(...)` fails typechecking (TS2590). Don't `npm update` them without re-running `npm run typecheck`.
- `libphonenumber-js@1.13.15`, `@convex-dev/auth@0.0.96` with `@auth/core@0.41.3`, `web-push@3.6.7`. Every dependency is pinned to an exact version.

## How it works

### Intake

`intake.ingestDocument({ ownerId, storageId, mimeType, source, sourceRef?, hint?, ... })` (internal) is the one entry point for every channel. Web uploads (`intake.ingestWebUpload`) and Telegram both call it. It:

- creates the `documents` row and logs `document_received`
- posts the arrival as a user message with the marker `[document:<id>]` in the conversation's thread (the UI renders it as a document card)
- schedules the agent run, so intake returns immediately

Several files sent together are pages of one document: page 1 is `documents.storageId`, pages 2+ go in `documentPages`, and the model reads them all in one request. The owner's caption is stored as `documents.hint` and passed to the agent and the extraction **as a hint only**; the document itself decides the type.

Upload rules: JPEG, PNG, WebP or PDF only (`unsupported_file`); 10 MB max (`file_too_large`). The stored file's real content type wins over what the client claims. A refused upload can't delete its file in the same call (the throw rolls that back too), so the hourly cron `admin.cleanupOrphanUploads` deletes files older than an hour that no document uses. The browser compresses photos to about 1,600 px on the long side before upload; PDFs go up unchanged.

### Extraction

`convex/extraction.ts` sends the file to Claude with `generateText` + `Output.object` and a zod schema (`generateObject` is deprecated in AI SDK 7). Images and PDFs are both `file` parts. The schema covers:

- `docType` (the enum above), `issuer { agencyName, level }`, `noticeCode`, `noticeDate`, `amountDue`, `deadline`, recipient
- `printedContacts { phones, emails, websites, mailingAddresses }`, `acceptedResponseMethods`, `paymentInstructions`, `mainIssue`
- scam signals: `requestedPaymentMethods`, `pressureTactics`
- case-memory fields: `taxForm`, `taxPeriodEnd`, `taxYear`, `einLast4`, `facilityId`, `referencedNoticeDates`
- `inspection { placardColor, score, inspectionDate, reinspectionDate, violations[] }` for health inspections
- `identifiersMasked`, `documentLanguage`, `fieldConfidence`, `overallConfidence`

Details:

- **Nullable, not optional.** Optional fields inside optional objects push the structured-output schema past the API's size limit ("Schema is too complex"). The model schema uses nullable fields, and `toStoredExtraction()` drops the nulls before saving.
- `fieldConfidence` comes back from the model as a `{ field, confidence }` list and is stored as `Record<string, number>`.
- **Masking.** The prompt says never to return a full SSN, EIN or account number, and `maskSensitive()` runs a regex pass before anything is saved. Only the last 4 digits are kept.
- A letter that only *mentions* the IRS (no real notice code printed) is not classified as an IRS notice type. CP504B is classified as `IRS_CP504`.
- **No case is opened** for `UNKNOWN` documents or when `overallConfidence < 0.6`; the agent asks for a clearer photo instead, so a blurry photo and its retake don't open two cases.
- **`IGNORE_SAMPLE_WATERMARKS`.** Every fixture is watermarked SAMPLE. With this env var set to `true`, both prompts treat those marks as absent instead of warning "this looks like a sample" on every reply. Scam detection is unchanged. It's read per call. Production sets it so visitors can upload the sample letters; leave it unset when testing real letters (and black out SSNs, EINs and account numbers first).

### The agent

`convex/agent.ts` defines `ledgerAgent` on the Convex Agent component. Its instructions (`buildInstructions`) carry the owner's language and the demo clock's date. Core rules:

- Do the work yourself; ask the owner only to approve, sign, or give information Ledger can't get.
- Reply in the owner's language, short, key number and date first. Use the playbook glossary: the term in the owner's language with the English one in parentheses, e.g. "multa (penalty)".
- Only state facts from the extraction, tool results or playbooks. Amounts and dates come from tool results; an ISO date may be written out in words, unchanged.
- Never pay or message anyone without the owner's approval; never ask for a full SSN, EIN or account number.
- Audits, lawsuits and unsupported documents: say so and recommend a CPA, enrolled agent or lawyer. Legal or tax explanations end with a one-line "not legal or tax advice".
- Anything meant for an agency is written in English, with a translation for the owner.
- No text between tool calls (an early run leaked an English planning sentence into the reply).

**Tools,** in the required order after a document arrives:

1. `read_document`: runs the extraction, saves it, opens or links the case, returns the extraction plus `caseNotices`. Stop here for `UNKNOWN` or low confidence (but still run `verify_sender` if an agency is mentioned, so scams get flagged).
2. `get_case_history`: a compact text timeline; called when `caseNotices` > 1.
3. `verify_sender`: see below. If `suspicious`, warn, say not to pay or call the printed number, and give the agency's real number.
4. `load_playbook({ docType, caseId? })`: sets `cases.playbookDocType`.
5. `check_bank_history({ caseId })`: when there's an amount due.
6. `propose_action({ caseId, type, summary, payload })`: only `pay_bill` and `owner_task`. Each proposal is referenced in the reply as `[action:<id>]` on its own line, which the UI renders as a live card.

Every tool checks that the document or case belongs to the owner. Every step logs an event with a readable English summary (`document_extracted`, `sender_verified`, `playbook_loaded`, `bank_checked`, `action_proposed`, …), which drives the live activity list in the chat.

**What the code enforces, not just the prompt.** `propose_action` refuses `pay_bill` when `verify_sender` hasn't run or isn't `verified`, when `check_bank_history` hasn't run, when the bank shows a matching payment, when the balance can't cover it, or when the amount differs from the case's `amountDue`. The amount, the account's last 4 and the due date always come from the case and owner record, never from the model. A second proposal of the same type on the same case returns the existing card.

**Reasoning blocks.** `claude-sonnet-5-5` thinks before answering, and the API returns signed reasoning blocks that the Agent component replays with the history. The API rejects replayed blocks from earlier turns ("bound to a different conversation"), so a `contextHandler` strips reasoning parts from **earlier turns only**. User messages, final replies, tool calls and tool results (including the full extraction JSON) are kept, and so is reasoning inside the current turn's tool loop, which the API requires when thinking and tool use are combined.

**Follow-ups.** `agent.notifyActionResult` runs after every final action status (and after reject and mark done). It adds a hidden user-role note starting with `[system-note]` (the Anthropic adapter rejects a system-role message mid-thread; the UI hides these) and schedules a short reply in the owner's language, e.g. "Listo, se pagaron $520.00 al United States Treasury desde la cuenta que termina en 4417…".

### Sender and scam check

`convex/senderCheck.ts`, rule-based with no LLM call, against `convex/officialContacts.ts` (IRS: 800-829-4933, `irs.gov`, `treasury.gov`; Alameda County Environmental Health: (510) 567-6700, `acgov.org`, `alamedacountyca.gov`; City of Oakland: `oaklandca.gov`. Entries still marked `TODO: verify` there aren't confirmed).

- Phones are normalized with `libphonenumber-js`; websites and email domains are matched against the agency's domains.
- **Red flags:** gift cards, crypto, wire transfers or payment apps; any pressure tactic; a 555 number; an email outside the agency's domains (or outside `.gov`/`.us` for an agency not on the list); a printed agency name that imitates a known agency without matching it ("Internal Revenue Tax Enforcement Division"). Imitation is judged on the printed agency name only.
- **Verdicts:** `verified` needs at least one contact match and no red flags. Any red flag makes it `suspicious`. An agency that isn't on the list and imitates nothing (another county, a state agency) is `unverified`, "isn't on Ledger's list of agencies yet", and still can't be paid.
- The result is saved on `cases.verification`. A suspicious letter opens a case titled "Suspicious letter…" so the badge and reasons show in the UI.

### Playbooks

`convex/playbooks/` has one file per supported notice (`irsCp14`, `irsCp504`, `irs972cg`, `countyHealthInspection`), validated by `schema.ts`, looked up with `getPlaybook(docType)`. Each has `whatItMeans`, `keyFacts`, `options` (with the action type each leads to), `escalateIf`, an en/es `glossary` and `sources`. They hold only facts checked against the official sources listed in each file (irs.gov, taxpayeradvocate.irs.gov, Alameda County's food-safety FAQ). Add nothing that isn't sourced; mark gaps `TODO: verify`.

### Bank (Nessie)

`convex/nessie.ts`, with `NESSIE_MODE` = `live` (the real Nessie API, `NESSIE_API_KEY`) or `mock` (tables `mockBankAccounts` and `mockBankBills`, same return shapes). The base URL is `https://api.nessieisreal.com` (plain `http://` no longer connects), overridable with `NESSIE_BASE_URL`. The key goes in a `?key=` query parameter.

| Use | Endpoint |
|---|---|
| Create the customer | `POST /customers` |
| Create the account | `POST /customers/{id}/accounts` |
| Payment history, new payments | `GET` / `POST /accounts/{id}/bills` |
| Balance | `GET /accounts/{id}` |

- **Bills are past payments**: a free-text `payee`, `payment_amount`, `payment_date`, `status`, and the memo in `nickname`. Purchases need a merchant id and withdrawals have no payee, so neither fits. `GET /bills` can fail unless both `payment_date` and `recurring_date` are sent, so both always are.
- In live mode a new bill doesn't change the Nessie balance; in mock mode the balance goes down.
- **Per-owner seed** (`seedBankFor`, at onboarding and on "Start over"): checking account ending 4417, balance $4,800.00, a $1,240.18 payment to United States Treasury on 2026-10-02 (memo "Form 941 Q2 2026"), six supplier payments in September and October, and no $520 payment. Live mode creates a Nessie customer and account per owner; the ids are on the owner row.
- **`check_bank_history`** searches 120 days back from the demo clock for payments to a matching payee (for the IRS: "United States Treasury", "US Treasury", "IRS", "EFTPS", "Internal Revenue") within $1 of **any** notice amount in the case, and saves `{ balance, matches, canAffordFullPayment, checkedAt }` on `cases.bankCheck`.
- **`nessie.payBill({ actionId })`** refuses unless the action is an approved `pay_bill`, and returns `{ confirmationId, paidAt, amount, payee, accountLast4 }`. Payment dates follow the demo clock.
- If Nessie goes down: `npx convex env set --prod NESSIE_MODE mock`. Owners seeded in live mode keep live account ids and need "Start over with demo data" to get a mock bank.

### Actions and approvals

`convex/actions.ts`. The server sets autonomy from the type, never the agent:

| Type | Autonomy | Owner does |
|---|---|---|
| `pay_bill` | `one_tap` | Approve (confirm dialog) or Reject |
| `owner_task` (a call, a signature) | `human_only` | Mark done, or Reject |

`approve` only works on proposed one-tap actions and `markDone` only on proposed owner tasks; anything else throws, and double taps are harmless. The approve flow is `actions.approve` → `actions.execute` → `nessie.payBill` → `actions.finish` → `agent.notifyActionResult`. `finish` is internal and looks the action up directly, because it runs after a payment with no session.

Payloads:

- `pay_bill`: `{ amount, payee, accountLast4, memo?, dueDate? }`
- `owner_task`: `{ instructions, phone?, callScript?: { en, translated }, payment?: { date, amount, payee, memo? } }`

`actions.get` takes a string and returns `null` for a malformed id, so a bad marker from the model can't crash the chat. Cards (`components/action-card.tsx`) show proposed → "Paying…" → "Paid ✓ #confirmation", or "Not paid" / "Payment failed"; owner tasks show the call script in English and translated with Copy buttons, a tap-to-call link, and Mark done. Tap targets are at least 44 px, with at most two buttons, locked on the first tap.

### Case memory

Letters about the same matter join one case. `caseKeyOf` in `convex/documents.ts`:

| docType | Case key |
|---|---|
| `IRS_CP14`, `IRS_CP504` | `IRS941\|<taxForm>\|<taxPeriodEnd>\|<einLast4>` |
| `IRS_972CG` | `IRS972CG\|<taxYear>\|<einLast4>` |
| `COUNTY_HEALTH_INSPECTION` | `INSPECTION\|<facilityId>` |

If a part is missing there's no key, and the letter opens its own case.

- **Linking:** a letter with the same key joins the case in any status. The case takes the newest letter's `docType`, `title`, `amountDue` and `deadline`, goes back to `open`, and gets `stage: 2` when a CP504 follows a CP14 ("2nd notice" chip). It's logged as `case_linked` ("CP504B linked to the CP14 case from 2026-10-12 (same Form 941, period 2026-06-30)"), and its nudge levels restart from that day.
- **Re-uploads** of the same notice (same type, notice date and amount, or same type, amount and deadline) set `documents.caseId` but add nothing: no new case, card or timeline entry.
- **`cases.timeline({ caseId })`**: notices, bank matches, actions with their final status, and `case_opened` / `case_linked` events, oldest first (so the Oct 2 payment comes before the Oct 12 CP14). Actions and events are dated on the demo clock: each row stores the owner's `clockOffsetMs` when it was written. Shown in the "Case history" sheet from the document card.
- **CP504 after a paid CP14:** the reply opens with "second notice", mentions the Oct 2 payment and the earlier call, proposes calling again to trace the payment (both notice dates and the payment date in the script), and never proposes paying.

### Demo clock

Each owner can skip time forward to see reminders and escalations. `convex/clock.ts`:

- `nowMs(ctx, ownerId)` = `Date.now() + owner.clockOffsetMs`. `isoDateAt(ms)` gives the Pacific date (`America/Los_Angeles`, with a fixed −8 h fallback), since every owner is in Alameda County.
- `clock.get`, `clock.advance({ days })`, `clock.setDate({ isoDate })` (forward only, so "today" never goes before nudges already sent) and `clock.reset`. Each logs `clock_changed` and schedules `nudges.runDue` to catch up.
- Follows the demo clock: the bank check window, payment dates, the agent's "today", nudges, case `startedAt`, and every countdown in the UI. Action timestamps (`executedAt`) are still real time.
- Browser side: `lib/clock.ts` (`useNow()`, ticking every minute; `useDemoToday()`, `useClockOffset()`), and `useToday()` in `lib/use-today.ts` returns the demo date. "5 min ago" labels stay on real time.
- UI: "Demo clock" in the app menu (+1 day, +1 week, +30 days, a date picker, Reset), and an amber "Demo date: …" banner while it's ahead.

### Notifications: Telegram nudges

Telegram is the notification channel. **Web push is turned off** (`WEB_PUSH = false` in `convex/push.ts`); the subscriptions table, `push.*` mutations, `pushNode.ts`, `public/sw.js`, `lib/push.ts` and the VAPID keys are all still there. To bring it back, set `WEB_PUSH` to true and put `usePush` back in the UI.

Every notification goes through `queuePush` in `convex/push.ts`, which records it in the notification history and, with web push on, sends it. Push payloads are `{ title, body, url: "/?case=<caseId>", tag: "case-<caseId>" }` and carry only the friendly document name, amount, deadline, verdict and the account's last 4: never SSNs, EINs, account numbers or the letter's text.

**Nudges** (`convex/nudges.ts`, hourly cron `nudges.runDueAll`, and after every clock change) are the only notifications Ledger starts on its own: at most one Telegram message per owner per demo day, listing everything waiting on them.

- A case with a proposed action escalates through three levels, each sent once: **1 friendly** 2 days after the case opened; **2 direct** 7 days before the deadline (or 7 days after opening with no deadline); **3 last call** 1 day before the deadline or on the day. The level comes from today's date, so a skip past several levels sends only the latest. No nudge in a case's first day.
- A letter Ledger read that the owner hasn't opened in the app for 24 hours (`documents.openedAt`).
- A compliance event on the owner's Google Calendar: level 2 at 7 days before, level 3 at 1 day before.
- Never for suspicious letters, overdue cases, resolved cases, or once nothing waits on the owner. Owners without Telegram get nothing, and nothing is marked sent.
- `sentLog` keys: `nudge|day|<isoDate>`, `nudge|case|<caseId>|<level>`, `nudge|unopened|<documentId>`. Templates in en, es and tr; no LLM calls.

### Telegram bot

`convex/telegram.ts`. The bot reads letters and sends notifications; it doesn't hold conversations.

- **Linking:** "Connect Telegram" in the app menu calls `telegram.createLinkCode`, which returns `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>`. `/start <code>` sets `owners.telegramChatId` and replies "Connected" in the owner's language, with a tip that a file stays sharper than a photo. One chat, one account. `telegram.disconnect` clears it; `telegram.status` returns `{ linked }`.
- **Webhook:** `POST /telegram/webhook` rejects requests without the right `X-Telegram-Bot-Api-Secret-Token`, schedules the work and returns 200 at once so Telegram doesn't retry.
- **Letters:** a photo (largest size) or a PDF/JPEG/PNG/WebP file from a linked chat is downloaded with `getFile`, stored, and sent to `ingestDocument` with `source: "telegram"`, `sourceRef` = the message id and the caption as `hint`. Each Telegram letter starts a new conversation. An **album** arrives as one message per file; parts wait in `telegramAlbumParts` until none has arrived for 3 seconds, then are read as pages of one letter. The bot replies "Got it, I'm reading it now…" right away, and when the run finishes `telegram.notifyDocumentResult` sends the result with a link to `<SITE_URL>/?case=<caseId>`.
- **Anything else** gets one fixed reply: unsupported file, "open the app to chat", or "tap Connect Telegram first" for unlinked chats.
- `telegram.sendMessage({ ownerId, text })` sends plain text (no Markdown parsing, so nothing needs escaping) and does nothing without a linked chat.

### Notification center

Every notification is kept in `notifications` (headline and body in the owner's language at the time, case and action ids, `searchText`, `readAt`), whether or not it was delivered anywhere. Test pushes aren't recorded.

| Push kind | Category |
|---|---|
| `action_needed` | `needs_action` |
| `document_read` | `letter`, or `alert` when the verdict is `suspicious` |
| `document_failed`, a failed action | `alert` |
| `action_done` | `done` |
| `nudge` | `reminder` |

- **Search** uses a Convex search index on `searchText`, which combines the owner-language text, the English headline and summary, and the document type, so "IRS", "payment" or "multa" find the same notification in any language.
- **Pinning** is decided in the browser (it depends on today's demo date; the server query is cached): a case that isn't resolved, still has an action waiting, and has a deadline within 14 days or past. Only the newest notification per case is pinned, soonest deadline first (`PIN_WITHIN_DAYS` in `lib/notifications.ts`).
- API: `notifications.list({ search?, category? })` (up to 100, each with its case's deadline, status and `hasPendingAction`), `notifications.unreadCount`, `markRead`, `markAllRead`, and `actions.listOpenForOwner` for the To-do list.

### Google Calendar (read-only)

Owners can connect their Google Calendar; Ledger copies events and shows them on the home calendar next to letter deadlines. It never writes to the calendar, and events are never sent to Anthropic.

- **A separate OAuth flow** from sign-in, on the same Google client (`convex/googleOAuth.ts`, `convex/googleCalendar.ts`). `calendar.readonly` is a sensitive scope, so asking for it only on connect keeps sign-in free of Google's "hasn't verified this app" screen. Unverified, at most 100 users can connect.
- **Flow:** `googleCalendar.startConnect` makes a single-use `state` (10 minutes, `googleOAuthStates`) and returns the consent URL with `access_type=offline` and `prompt=consent`. Google redirects to `GET /calendar/callback`, which consumes the state, exchanges the code, checks the scope was granted, saves the tokens and starts a sync. The owner lands on `?calendar=connected` or `?calendar=error&reason=cancelled|state|token|scope|no_refresh_token`. `scope` is the common one: Google shows the calendar permission as a checkbox that starts unticked. Failures are logged as `calendar_connect_failed`.
- **Sync:** primary calendar only, 31 days back to 120 days ahead, single events (recurring ones expanded), at most 1,000. On connect, then hourly (`googleCalendar.syncAll`, owners staggered by 2 seconds), or on demand with `syncNow`. Each sync replaces the owner's copied events: title (≤ 200 chars), date, `HH:MM` time or none, and the event link.
- **Filtering** (`convex/calendarRules.ts`, rules on the title, accent-insensitive, en/es/tr): `isBusinessEvent` sets `calendarEvents.business` (the home calendar shows business events by default, `owners.calendarFilter`), and `isComplianceEvent` picks deadlines and obligations (taxes, permits, inspections, filings). `calendarCompliance.list` returns those for the deadline list and nudges.
- **Revoked access** (`invalid_grant`, 401 or 403) marks the connection revoked, deletes the events and offers to reconnect. "Disconnect" and "Delete my account" revoke the grant at Google; "Start over" deletes the events but keeps the connection.
- Tokens never leave the backend; no public query returns them.

### Deadlines

`deadlines.upcoming({ fromIso, toIso })` merges three sources into one list `{ key, date, title, source, caseId?, link?, docType?, form?, amountDue? }`:

1. `case`: open cases with a deadline
2. `general`: hardcoded form due dates in `convex/generalDates.ts`. Form 941 is due the last day of the month after each quarter, Form 1099-NEC on January 31, each moved to the next business day on a weekend or holiday (irs.gov Topic 758, Publication 509, 1099-NEC instructions): 941 on 2026-11-02, 2027-02-01, 2027-04-30, 2027-08-02; 1099-NEC on 2027-02-01.
3. `calendar`: compliance events from Google Calendar

### Conversations and the app

- **Home screen** (`components/home.tsx`): recent notifications, the deadline calendar (`deadline-calendar.tsx`: letter deadlines and to-dos on a month grid, Google events as dots) and shortcuts. Sending a message or a letter from home starts a new conversation.
- **Conversations** (`convex/conversations.ts`): each is one agent thread; sending inside an open conversation continues it. `owners.agentThreadId` is the thread from onboarding, shown as an earlier conversation once it has messages.
- **Chat:** live activity (the steps Ledger is taking, each with a "details" toggle showing the English audit line, collapsing into "What Ledger did (N steps)"), document cards with the verification badge, deadline countdown and bank line, and action cards.
- **Landing page** (`components/landing.tsx`) for signed-out visitors, with Google sign-in. A `/?case=<id>` link survives sign-in, then scrolls to and highlights that letter.
- **App menu:** language, Telegram, demo clock, "Start over with demo data", "Delete my account" (type a word to confirm), sign out, privacy and terms.
- **i18n:** `lib/i18n.tsx` and `messages/{en,es,tr}.json`, every label through `t()` with an English fallback. Money and dates use `Intl` in the owner's locale (`lib/format.ts`); the model never formats numbers for the UI. The date is read only in the browser, so Next 16's Cache Components never see `new Date()` during prerender.
- **PWA:** `app/manifest.ts`, icons in `public/icons/` and `app/apple-icon.png`; `sw.js` is served with no-cache headers (`next.config.ts`) and does no offline caching.
- `/privacy` and `/terms` are public (Google's consent screen requires them; the privacy policy covers Google Calendar and Google's Limited Use requirement). A contact email shows when `NEXT_PUBLIC_CONTACT_EMAIL` is set on Vercel.
- `/dev` previews every card state with mock data (`lib/mocks.ts`) and returns 404 in production.

### Accounts and ownership

- **Sign-in:** Convex Auth with Google, client-only setup (`ConvexAuthProvider`, no `proxy.ts`). Routes live at `https://<deployment>.convex.site/api/auth/...`. Only name and email are requested.
- **One owner per user:** `owners.completeOnboarding({ name, businessName, preferredLanguage, city? })` creates the owner, its agent thread and its bank (a second call updates the profile). Also `owners.me`, `setLanguage`, `resetMyData`, `deleteMyAccount`.
- **Ownership** (`convex/access.ts`): `viewerOwner` (null when signed out, for queries), `requireOwner` (throws `not_signed_in` / `not_onboarded`), `requireOwnerOf` (throws `not_found` for missing rows and other owners' rows alike, so ids can't be probed). Every public function takes the owner from the session; queries return `null` / `[]` instead of throwing. `chat.listThreadMessages` throws unless the thread is the viewer's.
- **No rate limits.** Uploads, chat and agent runs are unlimited; set a monthly spend limit on the Anthropic key.
- **Errors** the UI translates (`lib/errors.ts`): `rate_limited`, `unsupported_file`, `file_too_large`, `not_signed_in`, `not_onboarded`.
- **Deletion** (`convex/admin.ts`): `deleteOwnerData` is shared by "Start over" (keeps the owner, profile and Telegram link; reseeds the bank) and "Delete my account" (also the owner row, auth user, sessions, refresh tokens and accounts). These are the only places that delete events; the audit log is otherwise append-only.

## Data model

All tables are in `convex/schema.ts`; the Agent component stores threads and messages itself, and `authTables` come from Convex Auth.

| Table | What |
|---|---|
| `owners` | `userId`, name, business, `preferredLanguage`, city/county/state, `agentThreadId`, Nessie ids and `accountLast4`, `calendarFilter`, `clockOffsetMs`, `telegramChatId` |
| `documents` | `storageId`, `mimeType`, `source` (`web_upload`, `telegram`, …), `sourceRef`, `extraction`, `status`, `caseId`, `hint`, `extractedAt`, `openedAt`, `threadId` |
| `documentPages` | pages 2+ of a multi-file document |
| `cases` | `docType`, `title`, `amountDue`, `deadline`, `status`, `verification`, `bankCheck`, `playbookDocType`, `caseKey`, `stage`, `startedAt` |
| `actions` | `type`, `autonomyLevel`, `status` (`proposed`, `approved`, `rejected`, `executed`, `failed`), `summary`, `payload`, `result`, timestamps |
| `events` | append-only audit log: `type`, readable `summary`, `data`, `at` |
| `conversations` | one row per agent thread: title, starting document, `lastMessageAt` |
| `notifications` | the notification history (search index `search_text`) |
| `sentLog` | nudges already sent |
| `telegramLinkCodes`, `telegramAlbumParts` | Telegram linking and album buffering |
| `calendarConnections`, `calendarEvents`, `googleOAuthStates` | Google Calendar |
| `pushSubscriptions` | web push subscriptions (unused while web push is off) |
| `mockBankAccounts`, `mockBankBills` | the mock bank |
| `staff`, `tasks`, `generatedDocuments` | reserved for staff tasks and generated PDFs; not used yet |

`owners.userId` is still optional because of an early dev owner without it; it can become required after a dev reset.

## Setup

Requires Node 22+. Ledger is one Convex project, `ledger` (team `emreg`): one shared production deployment and one dev deployment per team member, each with its own database, files and env vars.

| Deployment | Used by |
|---|---|
| `prod:majestic-wolverine-921` | Vercel (production) |
| `dev:fast-fish-37` | Emre's `npx convex dev` |
| `dev:utmost-mosquito-685` | Mert's `npx convex dev` |

Your dev deployment only runs your working tree, so nobody overwrites anyone else's functions or data.

```bash
npm install
npx convex login                      # you must be on team emreg
npx convex dev --configure=existing   # pick team emreg, project "ledger"; answer No to "Set up Convex AI files"
```

`npx convex dev` writes your deployment name and URL into `.env.local` (gitignored). Keep it running. In a second terminal:

```bash
npx @convex-dev/auth --web-server-url http://localhost:3000   # JWT keys and SITE_URL on your deployment
npx convex env list                                           # what's set (names only)
npx convex env set NAME value                                 # anything from the table below that's missing
npm run dev                                                   # http://localhost:3000, sign in with Google
```

`npx convex dev --start "npm run dev"` runs both together. Every Google account gets its own owner, chat and sandbox bank; "Start over with demo data" in the app menu resets yours.

### Environment variables

Convex env, set with `npx convex env set NAME value` (add `--prod` for production) or in the dashboard. Values set as project defaults (Project settings → Environment Variables) are copied into every **new** deployment, which is handy for the shared ones; existing deployments must be set by hand.

| Name | Dev | Prod | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✓ | ✓ | Set a monthly spend limit in the Anthropic console |
| `NESSIE_MODE` | `mock` or `live` | `live` | |
| `NESSIE_API_KEY` | live only | ✓ | |
| `NESSIE_BASE_URL` | optional | optional | Defaults to `https://api.nessieisreal.com` |
| `IGNORE_SAMPLE_WATERMARKS` | optional | `true` | So visitors can upload the SAMPLE fixtures |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | ✓ | ✓ | One Google OAuth client for every deployment (sign-in and Calendar) |
| `SITE_URL` | `http://localhost:3000` | the Vercel URL | Where sign-in returns to; also used in Telegram links |
| `JWT_PRIVATE_KEY`, `JWKS` | ✓ | ✓ | Set by `npx @convex-dev/auth` (`--prod` for production); different per deployment |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | for Telegram | ✓ | One bot for the team |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | for push | ✓ | The same pair everywhere; generate with `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | optional | optional | `mailto:…`; falls back to `SITE_URL` (https) or the repo URL |
| `LEDGER_DAILY_RUN_LIMIT` | optional | optional | Daily cap on agent runs (default 600) |

Frontend env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (the deployment's `VAPID_PUBLIC_KEY`; in `.env.local` for local push) and `NEXT_PUBLIC_CONTACT_EMAIL` (optional). `npx convex dev` / `npx convex deploy` set `NEXT_PUBLIC_CONVEX_URL`.

### Google sign-in and Calendar

One OAuth client of type **Web application** in Google Cloud (APIs & Services → Credentials), with the Google Calendar API enabled and `calendar.readonly` under Data Access. Each deployment needs two **authorized redirect URIs** on it:

- `https://<deployment>.convex.site/api/auth/callback/google` (sign-in)
- `https://<deployment>.convex.site/calendar/callback` (Calendar)

Without them, Google refuses with `redirect_uri_mismatch`. The consent screen is published ("In production"); in "Testing", only listed test users can sign in. The basic scopes need no verification. **Don't upload a logo on the Branding page:** it triggers branding verification, which needs proof of owning the home page domain and a 24-hour wait.

### Telegram webhook

There's one bot for the team, so its webhook points at one deployment at a time (production normally). To point it at a deployment:

```bash
npm run telegram:webhook -- https://<deployment>.convex.site          # secrets from your dev deployment's env
npm run telegram:webhook -- https://<deployment>.convex.site --prod   # secrets from production's env
```

It calls `setWebhook` with `<site>/telegram/webhook` and the deployment's `TELEGRAM_WEBHOOK_SECRET`, then prints `getWebhookInfo`. Point it back at production when you're done testing on dev.

## Deploy

**Merging to `main` does not deploy.** The repo is private on another GitHub account, and Vercel's Hobby plan won't deploy it from git, so production is deployed with the Vercel CLI from an up-to-date `main`:

```bash
git checkout main && git pull
npx vercel deploy --prod
```

The build runs `npx convex deploy --cmd 'npm run build'` (`vercel.json`), so it deploys the Convex functions to production and then builds the frontend against them. Preview builds are skipped (`ignoreCommand`), and `.vercelignore` keeps `.env.local` out of uploads. Production is shared by the whole team.

- **Vercel:** project `ledger` on the `thespiritpilot` account. Env (Production): `CONVEX_DEPLOY_KEY` (a production deploy key with `deployment:deploy` only; dashboard → production → Settings → Deploy keys; treat it like a password) and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- **Convex production env:** every variable in the Prod column above. `VAPID_SUBJECT` is unset and falls back to `SITE_URL`.
- Schema changes should be optional fields or new tables, so existing production data stays valid.

The same deploy can run in GitHub Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)), **by hand only**: Actions tab → "Deploy production" → Run workflow. It uses the repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.

## Testing

```bash
npm run typecheck
npm run lint
npm run test:fixtures             # all fixtures; results in test-results/fixtures.json (needs `npx convex dev` running)
npm run test:fixtures -- cp14     # only files matching "cp14"
```

Fixtures are AI-generated sample letters with fictional data for Taquería La Esquina LLC; [fixtures/README.md](fixtures/README.md) lists the expected extraction for each. Every file also gets a "no full EIN anywhere in the output" check. Keep the machine awake during a fixture run: API calls made while a laptop sleeps hang, then fail with "connection reset".

Useful commands on your dev deployment:

```bash
npm run reset                                                     # dev only: deletes every owner and their data
npx convex run testing:snapshot '{"email": "you@gmail.com"}'       # an owner's cases, actions, events, messages
npx convex run testing:recentMessages '{"email": "you@gmail.com"}' # latest agent replies
npx convex run testing:reseedBank '{"email": "you@gmail.com", "withoutTreasuryPayment": true}'  # CP14 without the Oct 2 payment → pay_bill
npx convex run testing:extractStorageId '{"storageId":"...","mimeType":"image/jpeg"}'
npx convex run events:listForOwner '{"ownerId": "<id>"}'
```

Intake without the UI (how Telegram calls it):

```bash
npx convex run intake:ingestDocument '{"ownerId":"...","storageId":"...","mimeType":"image/jpeg","source":"web_upload"}'
```

**Demo walkthrough** (signed in, Telegram linked):

1. "Start over with demo data". Upload `fixtures/photos/cp14_photo.jpg`: verified, Oct 2 payment found, "real letter, already paid, don't pay again", a call task with a script, no payment card. Mark it done.
2. Upload `fixtures/pdf/972cg.pdf`: a $520 payment card; Approve → confirm → "Paid ✓", then a Spanish confirmation. Rejecting instead offers a dispute.
3. Upload `fixtures/photos/scam_irs_photo.jpg`: red "Suspicious" badge, the reasons, no payment card, and the IRS's real number.
4. Demo clock → set 2026-12-08: the day's Telegram nudge, the amber banner, countdowns move.
5. Upload `fixtures/pdf/cp504b.pdf`: one case with a "2nd notice" chip, a reply about the second notice and the earlier payment and call, a new call task, no payment. Case history shows CP14, the bank payment, the call (done) and the CP504B. Re-uploading the CP14 adds nothing.
6. `testing:snapshot` shows `stage: 2`, `case_linked`, `clock_changed`. Reset the demo clock.

## Layout

```
convex/
  schema.ts            every table
  intake.ts            ingestDocument: the one entry point for every channel
  agent.ts             Ledger agent, instructions, tools, respond, notifyActionResult
  extraction.ts        zod schema, prompt, masking, model call
  models.ts            model id, IGNORE_SAMPLE_WATERMARKS rule
  documents.ts         documents, extraction save, case keys and linking
  cases.ts             cases, timeline
  actions.ts           propose, approve, reject, mark done, execute
  senderCheck.ts, officialContacts.ts, playbooks/    sender check and official facts
  nessie.ts            sandbox bank, live and mock
  clock.ts             demo clock
  nudges.ts            Telegram nudges
  telegram.ts          Telegram bot and webhook
  push.ts, pushNode.ts notification history entry point, web push
  notifications.ts     notification center
  googleCalendar.ts, googleOAuth.ts, calendarRules.ts, calendarCompliance.ts   Google Calendar
  deadlines.ts, generalDates.ts   upcoming deadlines
  conversations.ts, chat.ts       threads and messages for the UI
  owners.ts, access.ts, auth.ts   accounts and ownership
  crons.ts, admin.ts   hourly jobs, deletion
  events.ts            append-only audit log
  testing.ts           harness helpers (internal)
  http.ts              auth, /calendar/callback, /telegram/webhook
  shared.ts            constants shared with the frontend (no server imports)
components/            landing, home, chat, cards, app menu, demo clock, case history, calendar, notification center
lib/                   i18n, formatting, clock hooks, errors, contract types, push (browser)
messages/              en, es, tr UI strings
public/sw.js           service worker
scripts/               test-fixtures.ts, telegram-webhook.ts
fixtures/              fake sample documents + expected values
```

## Known limits

- Replies take 10–20 seconds (mostly extraction on a full-page image) and arrive whole; there's no streaming yet (`streamText` with `saveStreamDeltas` would add it).
- Reply wording varies between runs. Spanish and Turkish (playbook glossaries, replies, `messages/*.json`) need a native speaker's review.
- A paid case stays `open`; nothing marks a case `resolved` yet.
- The seeded payments are dated Sep–Oct 2026, so once the (demo) date passes about mid-January 2027, the Oct 2 match falls outside the 120-day window.
- Only the primary Google Calendar is synced, up to 120 days ahead. Old notifications keep the language they were sent in.
- If an agent run crashes on a Telegram letter, Telegram isn't told; the failure only shows in the app.

## Git workflow

- `main` is always demo-able. Work on a branch, open a PR, merge when it runs. Merging doesn't deploy (see Deploy).
- Pull often; Convex schema changes affect everyone.
- Never commit keys. `.env.local` is gitignored; secrets go in `npx convex env set`.
- Instructions for Claude Code are in [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md).
