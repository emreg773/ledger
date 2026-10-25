# Ledger: Step 4 Brief, Person A (case memory, demo clock, deadline reminders)

You're continuing **Ledger**, a hackathon project (Cal Hacks 13.0, deadline **Sunday Oct 25, 2026, 9:00 AM PT**). Before writing code, read these in the repo: `docs/ledger-step1.md` (Sections 1 to 3), `STEP3_REPORT.md`, `STEP3_5_REPORT.md`, and the current `convex/schema.ts`, `convex/push.ts`, `convex/agent.ts`, `convex/documents.ts`, `convex/cases.ts`, and `convex/playbooks/`.

**Keep it simple.** This only has to work on two developers' devices. No new rate limits, no new auth work, no production hardening. Support only the document types Ledger already handles. Don't build for extensibility.

Two people work in parallel. **You are Person A.** Person B is building Telegram, the weekly roundup, nudges, the calendar filter, and the Upcoming panel from a sibling brief. Each person owns their features end to end, including UI. Follow the contract in Section 7 and the file ownership in Section 8.

---

## 1. Your features

1. **Case memory:** a new letter about an existing case joins that case, and Ledger reasons with the full history.
2. **Demo clock:** skip time forward and see the effects immediately.
3. **Deadline reminders:** push notifications before every deadline.

**Demo story these features must produce:**
1. María uploads the CP14 (Oct 12). Ledger finds the Oct 2 payment and proposes "call the IRS." She marks it done.
2. Skip the clock to Dec 8. Ledger sends a push: "Recordatorio: ..." for any upcoming deadline.
3. She uploads the CP504B (Dec 7, same Form 941 and period). Ledger replies:

   > *"This is the second IRS notice about the same tax from June 2026. You already paid $1,240.18 on October 2, and you called on [date]. The IRS still hasn't applied your payment. Don't pay again. Call once more and ask them to trace the payment."*

   It then proposes a new call task with an updated script.

## 2. First 20 minutes: schema and stubs PR (merge before anything else)

Add everything **both** people need, so Person B never edits the schema:
- **`owners`:** `clockOffsetMs?: number`, `telegramChatId?: string`
- **New table `telegramLinkCodes`:** `ownerId`, `code`, `createdAt` (index `by_code`)
- **`documents`:**
  - add `"telegram"` to `source`
  - add `hint?: string` (the owner's caption)
- **`cases`:**
  - `caseKey?: string` (index `by_owner_and_key`)
  - `stage?: number` (1 for the first notice, 2 for an escalation)
- **New table `sentLog`:** `ownerId`, `key`, `sentAt` (index `by_owner_and_key`). Both people use it to avoid sending the same reminder or nudge twice.
- **`notifications.category`:** add `"reminder"`
- **Push kinds:** add `"deadline_reminder"`, `"weekly_roundup"`, `"nudge"`
- **`queuePush`:** add an option `deliver: "push" | "history_only"` (default `"push"`). Person B uses `history_only` to record Telegram messages in the notification history without sending a push.
- **Stubs** for every Person A contract function in Section 7.

## 3. Case memory

**Extraction additions** (nullable in the model schema, like the existing nullable-field workaround):
- `taxForm?` (e.g. `"941"`)
- `taxPeriodEnd?` (ISO date, e.g. `"2026-06-30"`)
- `taxYear?`
- `einLast4?`
- `facilityId?`
- `referencedNoticeDates?: string[]`: earlier notice dates the letter mentions

**Case key**, computed in `saveExtraction`:

| docType | Key |
|---|---|
| `IRS_CP14`, `IRS_CP504` | `IRS941|<taxForm>|<taxPeriodEnd>|<einLast4>` |
| `IRS_972CG` | `IRS972CG|<taxYear>|<einLast4>` |
| `COUNTY_HEALTH_INSPECTION` | `INSPECTION|<facilityId>` |

If a key part is missing, don't link; open a new case as today.

**Linking:** if the owner already has a case with the same key, in any status, attach the new document to it instead of opening a new case:
- Set `documents.caseId`.
- Update `amountDue`, `deadline`, and `docType` to the newest document's values.
- Set `status` to `open`, and `stage` to 2 when a CP504 follows a CP14.
- Log `case_linked`, with a summary like "CP504B linked to the CP14 case from Oct 12 (same Form 941, period 2026-06-30)".

**`cases.timeline({ caseId })`** returns one time-ordered list merging:
- documents (type, notice date, amount)
- bank matches from `bankCheck`
- actions with their final status, including owner tasks marked done and when
- key events

**Agent tool `get_case_history({ caseId })`:** a compact text version of the timeline for the model.
- **Rule:** after `read_document`, if the case has more than one document, call `get_case_history` before replying.
- **Instruction:**
  ```
  When a letter joins an existing case, open with what changed since the last letter.
  Mention the earlier notice, what the owner already did, and any matching bank payment.
  Never propose pay_bill when the bank shows a matching payment.
  If the owner already called and a new notice still arrived, propose calling again and ask
  the IRS to trace the payment. Put both notice dates and the payment date in the call script.
  ```

**CP504 playbook** (`convex/playbooks/`). Use only these facts:
- A CP504 (CP504B for businesses) is the IRS's notice of intent to levy under Internal Revenue Code section 6331(d), sent when a balance is still unpaid.
- If the balance isn't paid, the IRS may levy the state tax refund. Before levying other property, the IRS must first send a separate final notice with the right to a hearing.
- If the balance was already paid or a payment plan exists, the taxpayer should still call the number on the notice so the account reflects it.
- Options: pay, set up a payment plan (irs.gov/paymentplan), or call if already paid.
- Sources: https://www.irs.gov/individuals/understanding-your-cp504-notice and https://www.taxpayeradvocate.irs.gov/notices/notice-cp504/
- Glossary: levy / embargo, final notice / aviso final

**Fixture:** the team will add `fixtures/photos/cp504b_photo.jpg`, `fixtures/pdf/cp504b.pdf`, and a README section. The printed code is **CP504B**; classify it as `IRS_CP504`.

**UI:** a "Case history" view, opened from the document card. It's a vertical timeline of `cases.timeline`, with icons per item type. When `stage` is 2, show a "2nd notice" chip on the document card. Use translated strings (en, es, tr).

## 4. Demo clock

- **`convex/clock.ts`:** `nowMs(ctx, ownerId)` returns `Date.now() + (owner.clockOffsetMs ?? 0)`. **Every time-based check uses this:** deadlines, reminders, countdowns, nudges, and the weekly roundup.
- **`clock.get` (query):** returns `{ offsetMs, nowMs }` for the signed-in owner.
- **`clock.advance({ days })` and `clock.setDate({ isoDate })` (mutations):** set the offset, then immediately run the catch-up: `internal.deadlines.runDue({ ownerId })` (yours) and `internal.digest.runDue({ ownerId })` (Person B's). Skipping ahead must fire every reminder that would have fired in between.
- **`clock.reset`:** offset back to 0.
- **Frontend:** `lib/clock.ts` exports `useNow()`, which returns the owner's demo-adjusted `Date`, ticking every minute. Replace the real browser date in `lib/notifications.ts` (pinning) and in any countdowns with `useNow()`.
- **UI:** a small "Demo clock" panel in the app menu. It shows the demo date, buttons for +1 day, +1 week, and +30 days, a date picker, and Reset. When the offset isn't 0, show a visible "Demo date: Dec 8, 2026" banner at the top of the app.

## 5. Deadline reminders

**`deadlines.upcoming({ fromIso, toIso })` (query, also used by Person B's Upcoming panel)** merges three sources into one list `{ key, date, title, source, caseId?, link? }`:
1. **Case deadlines:** open cases with a `deadline`. `source: "case"`.
2. **General dates** for the forms your supported letters are about (`convex/generalDates.ts`, hardcoded). `source: "general"`.
   - **Form 941:** due the last day of the month after each quarter. If that day falls on a weekend or a federal holiday, the due date is the next business day. So: 2026-11-02 (Q3 2026; Oct 31 is a Saturday), 2027-02-01 (Q4 2026), 2027-04-30 (Q1 2027), 2027-08-02 (Q2 2027).
   - **Form 1099-NEC:** due January 31 to recipients and the IRS; for 2026 forms, that's 2027-02-01 (Jan 31, 2027 is a Sunday).
   - Confirm both rules on irs.gov before hardcoding. If irs.gov disagrees, follow irs.gov and note it in your report.
3. **Calendar compliance events** from Person B's `internal.calendarCompliance.list({ ownerId, fromIso, toIso })`. `source: "calendar"`.

**Reminder schedule** for each item: 7 days before, 2 days before, the day of, and 1 day overdue (case deadlines only, if the case is still open).

**`deadlines.runDue({ ownerId })` (internal):**
- For each reminder whose time has passed by `nowMs` and isn't in `sentLog` (key `deadline|<itemKey>|<offset>`), send a push with kind `deadline_reminder` and log it in `sentLog`.
- If several reminders are due at once (after a clock skip), **send one combined push** listing them, so the phone isn't flooded.

**Cron:** `deadlines.runDueAll` runs hourly for every owner.

**Push text,** short and in the owner's language (en, es, tr; formal "usted" in Spanish), for example:
- "Recordatorio: su aviso del IRS (CP14) vence en 2 días: $1,240.18."
- "Próximo: Formulario 941 vence el 2 de nov."

The tap URL is the case (`/?case=<id>`) or the home screen.

## 6. Telegram document results (a hook for Person B)

When an agent run finishes for a document whose `source` is `"telegram"`, call `internal.telegram.notifyDocumentResult({ ownerId, documentId, caseId?, title, body })` (Person B's function) with the same title and body as the push. Also pass the document's `hint` into the agent's first message for that document ("Owner's note: …") and into the extraction prompt as a **hint only**. Classification still comes from the document itself.

## 7. Contract

**You implement:**

| Function | Type | Args | Returns |
|---|---|---|---|
| `clock.get` | query | `{}` | `{ offsetMs, nowMs }` |
| `clock.advance` / `clock.setDate` / `clock.reset` | mutations | `{ days }` / `{ isoDate }` / `{}` | `null` (runs the catch-up) |
| `clock.nowMs` | helper (import) | `(ctx, ownerId)` | number |
| `deadlines.upcoming` | query | `{ fromIso, toIso }` | items as in Section 5 |
| `deadlines.runDue` | internal action | `{ ownerId }` | `null` |
| `cases.timeline` | query | `{ caseId }` | timeline items |
| `intake.ingestDocument` | internal mutation | existing args plus `hint?` | `documentId` |
| `push.queuePush` | existing | existing args plus `deliver?` | as today |

**Person B implements** (you call these; stub them if they aren't merged yet):

| Function | Type | Args | Returns |
|---|---|---|---|
| `calendarCompliance.list` | internal query | `{ ownerId, fromIso, toIso }` | `[{ key, date, time?, title, link? }]` |
| `digest.runDue` | internal action | `{ ownerId }` | `null` |
| `telegram.notifyDocumentResult` | internal action | `{ ownerId, documentId, caseId?, title, body }` | `null` |

## 8. Files

- **You own:** `convex/schema.ts`, `agent.ts`, `extraction.ts`, `intake.ts`, `documents.ts`, `cases.ts`, `push.ts`, `clock.ts`, `deadlines.ts`, `generalDates.ts`, `playbooks/`, `crons.ts` (add Person B's cron entries if they ask), `lib/clock.ts`, `lib/notifications.ts`, and new components for the case history, the demo clock panel, and the banner.
- **Person B owns:** `convex/telegram.ts`, `digest.ts`, `calendarCompliance.ts`, `http.ts` (Person B adds the Telegram route), and the Upcoming and Telegram components.
- **Shared, `messages/*.json`:** add your keys under the top-level `caseHistory` and `clock` sections only, to keep merge conflicts small.

## 9. Git
1. Branch `a/step4-schema-stubs` (merge first), then `a/step4-...`. Open PRs; Person B reviews.
2. Merging doesn't deploy. A developer deploys production by hand.

## 10. Acceptance (on your dev deployment, after a reset)
- [ ] CP14, then a +60-day skip, then CP504B: one case with two documents and `stage` 2; the reply opens with "second notice," mentions the Oct 2 payment, proposes a new call task, and **no** `pay_bill`
- [ ] The case history shows: CP14, bank match, call task (done), CP504B
- [ ] Re-uploading the same CP14 doesn't create a new document link or case
- [ ] Skipping 7 days sends **one** combined reminder push; skipping again with nothing due sends none; nothing repeats
- [ ] The Form 941 date of Nov 2 appears in `deadlines.upcoming` as `general`
- [ ] Demo banner, countdowns, and notification pinning follow the demo clock; Reset restores the real date
- [ ] `digest.runDue` is called on every clock change (a stub is fine until Person B merges)

## 11. When you finish
Write `STEP4_REPORT_A.md`: what you built, deviations, known issues, and the production env vars or setup steps needed for the next deploy.
