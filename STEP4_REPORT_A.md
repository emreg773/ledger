# Step 4 report, Person A (case memory, demo clock, deadline reminders)

*Sat Oct 24, 2026. Brief: [docs/ledger-step4-A.md](docs/ledger-step4-A.md).*

**Status:** all three features are built and merged into `main`, and deployed to my dev deployment (`fast-fish-37`). Typecheck and lint pass. **Not tested end to end:** the dev deployment had no signed-in owner when I finished, and the checks need a real sign-in in the app. The test steps are in [How to test](#how-to-test). Production isn't deployed; merging doesn't deploy (see [Next deploy](#next-deploy)).

## Merged PRs

| PR | Branch | What |
|---|---|---|
| #17 | `a/step4-schema-stubs` | Schema for both people, push kinds, `queuePush` options, `clock.ts`, intake `hint`, stubs (including Person B's three functions), the Step 4 briefs, the CP504B fixtures |
| #18 | `a/step4-case-memory` | Case keys and linking, the bank check across notices, `cases.timeline`, `get_case_history`, the CP504 playbook, the Telegram result hook, the Case history UI |
| #19 | `a/step4-reminders-clock` | `deadlines.upcoming`, reminders with `sentLog`, the hourly cron, `generalDates.ts`, `lib/clock.ts`, the demo clock dialog and banner |
| #20 | `a/step4-report` | This report; the CP504B section moved into `fixtures/README.md` |

## What was built

### Schema (for both people, PR #17)
- **`owners`:** `clockOffsetMs?`, `telegramChatId?`
- **New table `telegramLinkCodes`** (`by_code`)
- **`documents`:** source `telegram`, `hint?`; index `by_case`
- **`cases`:** `caseKey?` (`by_owner_and_key`), `stage?`
- **New table `sentLog`** (`by_owner_and_key`)
- **Notification category** `reminder`
- **Push kinds:** `deadline_reminder`, `weekly_roundup`, `nudge`
- **`queuePush`** is exported. It takes `{ deliver?: "push" | "history_only", text?, url?, tag? }` and returns the `{ title, body }` it used. `ownerLang(owner)` picks the owner's language for custom text.

### Case memory
- **Extraction:** new fields `taxForm`, `taxPeriodEnd`, `taxYear`, `einLast4` (digits only, at most 4), `facilityId` and `referencedNoticeDates`. They're nullable in the model schema and stored as missing fields. CP504B is classified as `IRS_CP504`. The owner's `hint` reaches the extraction as a hint only.
- **Case key:** `caseKeyOf` in `convex/documents.ts`, as in the brief's table. If a part is missing, there's no key, and the letter opens its own case.
- **Linking:** a letter with the same key joins the case, in any status.
  - The case takes the newest letter's `docType`, `title`, `amountDue` and `deadline`, and its status goes back to `open`.
  - `stage` becomes 2 when a CP504 follows a CP14.
  - The link is logged as `case_linked`, e.g. "CP504B linked to the CP14 case from 2026-10-12 (same Form 941, period 2026-06-30)".
- **Re-uploads:** the same notice (same type, notice date and amount) sets `documents.caseId`, so its card shows the case, but adds nothing. It isn't counted as a new notice, it isn't in the timeline, and nothing is relinked.
- **Bank check across notices:** a later notice asks for more ($1,262.40 on the CP504B, vs $1,240.18 on the CP14), so a payment matching **any** notice amount in the case counts, within $1. The 120-day window is measured from the demo clock.
- **`cases.timeline({ caseId })`:** the case's notices, bank matches, actions with their final status and time, and `case_opened` / `case_linked` events, oldest first. Returns `null` if the case isn't the viewer's.
- **Agent:**
  - `read_document` returns `caseNotices`.
  - The new tool `get_case_history` returns a compact text timeline. The instructions say to call it when `caseNotices` is more than 1.
  - The brief's case-memory instructions are added verbatim, plus CP504 guidance (call again to trace the payment, with both notice dates and the payment date in the script).
  - The instructions also carry the demo clock's date.
  - `propose_action` already refuses `pay_bill` when the bank shows a match.
- **CP504 playbook** (`convex/playbooks/irsCp504.ts`): only the brief's facts and sources. Glossary: levy / embargo, final notice / aviso final.
- **UI:** a "Case history" sheet, opened from the document card, with a vertical timeline and icons for notices, payments, tasks and links. A "2nd notice" chip shows when `stage` ≥ 2. Strings are under `caseHistory.*` in en, es and tr.

### Demo clock
- **`convex/clock.ts`:**
  - `nowMs(ctx, ownerId)` and `isoDateAt(ms)` (Pacific dates).
  - `clock.get`, `advance({ days })`, `setDate({ isoDate })` (forward only) and `reset`.
  - Every change logs `clock_changed` and schedules `deadlines.runDue` and `digest.runDue` for the catch-up.
- **What follows the demo clock:** the bank check, payment dates (`payBill`), the agent's "today", reminders and every UI countdown.
- **`lib/clock.ts`:** `useNow()` (the demo-adjusted `Date`, ticking every minute), `useDemoToday()` and `useClockOffset()`. `useToday()` in `lib/use-today.ts` now returns the demo date, so countdowns, the calendar and the notification pinning (`lib/notifications.ts` gets `today` from it) follow the demo clock without changing each component. The real-time `useNow()` in `lib/use-today.ts` stays real for "5 min ago" labels.
- **UI:** "Demo clock" in the app menu opens a dialog with +1 day, +1 week, +30 days, a date picker, and Reset. An amber "Demo date: …" banner shows at the top of the header while the clock is ahead. Strings are under `clock.*`.

### Deadline reminders
- **`deadlines.upcoming({ fromIso, toIso })`:** open cases with a deadline (`case`), `generalDates.ts` (`general`) and `calendarCompliance.list` (`calendar`), sorted by date. Items are `{ key, date, title, source, caseId?, link? }`, plus `docType`, `form` and `amountDue` so the UI can translate them.
- **General dates:** Form 941 on 2026-11-02, 2027-02-01, 2027-04-30 and 2027-08-02, and Form 1099-NEC on 2027-02-01. Both rules match irs.gov ([Topic 758](https://www.irs.gov/taxtopics/tc758), [Publication 509](https://www.irs.gov/publications/p509), [1099-NEC instructions](https://www.irs.gov/instructions/i1099mec)): the last day of the month after the quarter, and January 31, each moved to the next business day on a weekend or holiday. Nothing disagreed with the brief.
- **Schedule:** 7 and 2 days before, on the day, and 1 day overdue (open cases only). Each reminder is sent once, with the `sentLog` key `deadline|<itemKey>|<offset>`. The look-back is 90 days, so a clock skip fires the reminders it jumped over.
- **One push per run:** one due item gives "Recordatorio: Su aviso del IRS (CP14) vence en 2 días: $1,240.18." Several give one push: "Recordatorios: … · Formulario 941 vence en 7 días." The wording comes from the actual days left on the demo date, not from the offset that triggered it. Spanish uses "usted". It taps through to the case when there's a single case, and to the home screen otherwise.
- **Cron:** `deadlines.runDueAll`, hourly.
- **Logged** as a `deadline_reminder` event.

### Telegram hook
When an agent run finishes for a document with `source: "telegram"`, the same title and body as the push go to `internal.telegram.notifyDocumentResult` (Person B's). The caption is stored as `documents.hint`, added to the agent's first message as "Owner's note (a hint only…)", and passed to the extraction as a hint.

## Deviations

- **Person B's three functions were stubbed in Person B's files** (`calendarCompliance.ts`, `digest.ts`, `telegram.ts`) in PR #17, so my code could call them. Person B replaces the bodies and keeps the signatures.
- **Two small edits to files the brief doesn't list as mine:**
  - `lib/use-today.ts`: `useToday` goes through the demo clock.
  - `components/chat.tsx`: one line adds the banner to the header.
  - Also `lib/contract.ts` (`stage` in `CaseView`) and `components/app-menu.tsx` (the Demo clock item).
- **`deadlines.runDue` is an internal action**, as the contract says. It calls the internal mutation `deadlines.sendDue`, which does the work.
- **`clock.setDate` only moves forward.** Going back would make "today" earlier than reminders already sent.
- **Upcoming items carry `docType`, `form` and `amountDue`** beyond the contract's fields.
- **Re-upload dedupe** compares type, notice date and amount, in addition to Step 2's type, amount and deadline match.

## Known issues

- **Not tested end to end** (see above).
- **Action times are real time, not demo time.** `actions.ts` (Person B) stamps `executedAt` with `Date.now()`. If the owner marks the call done *after* skipping the clock, the history and the CP504B reply show the real date of the call. In the brief's demo order (mark done, then skip), they match.
- **The timeline sorts by date,** so the Oct 2 bank payment comes before the Oct 12 CP14.
- **A paid case stays `open`,** so it keeps getting deadline reminders. Nothing marks a case `resolved` yet.
- **A reminder can be sent for a deadline the owner learned about after its reminder date.** For example, a letter uploaded 3 days before its deadline gets the "7 days before" reminder at once, worded with the real days left.
- **If an agent run crashes** on a Telegram document, Telegram isn't told. Only the push and the failure note go out.
- **Pacific time:** `isoDateAt` uses `America/Los_Angeles`, with a fixed −8h fallback.

## How to test

On your dev deployment, signed in through the app, with notifications on:
1. In the menu, choose "Start over with demo data". Upload `fixtures/photos/cp14_photo.jpg`. Ledger finds the Oct 2 payment and proposes the call task. Tap **Mark done**.
2. Open the Demo clock and set the date to **2026-12-08**. Expect one combined reminder push, the amber banner, and countdowns that change.
3. Open the Demo clock and tap **+1 day**. Expect no new reminder. Then tap **+1 week**: it may send the next one; nothing repeats.
4. Upload `fixtures/pdf/cp504b.pdf`. Expect:
   - one case, with a "2nd notice" chip
   - a reply that opens with the second notice and mentions the Oct 2 payment and your call
   - a new call task, and **no** payment card
5. Open **Case history** from the card: CP14, the bank payment, the call task (done), the CP504B.
6. Re-upload the CP14. Expect no new case, and no extra entry in the history.
7. Check what the backend recorded:
   ```
   npx convex run testing:snapshot '{"email": "you@gmail.com"}'
   ```
   Look for `stage: 2`, `case_linked`, `deadline_reminder` and `clock_changed`.
8. Back in the Demo clock, tap **Reset to today**. The banner disappears and the countdowns go back to the real date.

## Next deploy

- **No new environment variables.** Production already has `IGNORE_SAMPLE_WATERMARKS=true`, which the CP504B fixture needs.
- **Every schema change is optional or a new table,** so the existing production data stays valid.
- **New crons:** deadline reminders, hourly.
- **Deploy by hand:** `npx vercel deploy --prod` from an up-to-date `main` (README). It runs `npx convex deploy` too.
