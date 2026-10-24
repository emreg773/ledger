# Ledger: Step 2 Brief, Track B (action system and UI)

You are continuing **Ledger**, a hackathon project (Cal Hacks 13.0, deadline **Sunday Oct 25, 2026, 9:00 AM PT**). Step 1 is merged on `main`. Before writing code, read these files in the repo:
- `docs/ledger-step1.md`: the full project context. Sections 1 to 3 (what Ledger is and the agent principle) still apply.
- `STEP1_REPORT.md`: what was actually built, package versions, deviations, and known issues.

Two developers work in parallel. **You are Track B (action system and UI).** Track A is building playbooks, the sender check, the Nessie bank check, and the agent workflow at the same time from a sibling brief. Stick to the files you own (Section 9) and the contract (Section 8).

---

## 0. Changes since Step 1 (decided by the team)

- **No WhatsApp.** Input is the web chat (with uploads) and, from Step 3, automatic Gmail scanning.
- **Notifications** (Step 3): web push and an in-app notification center.
- **Updated roadmap:**

| Step | Track A | Track B |
|---|---|---|
| **2 (this file)** | Playbooks, sender and scam check, Nessie bank check, agent workflow, action proposals | Action system, Approve cards, live activity, friendly names, UI translation |
| 3 | Gmail scanning on a schedule | Web push, in-app notification center |
| 4 | PDF/Word generation, Gmail sending after approval | Document preview, case page with audit timeline |
| 5 | Inspection fix tasks and photo-proof verification | Fix checklist UI, bilingual kitchen checklist view |
| 6 | Deadline reminders, hardening, demo data | README, video, Devpost |

## 1. Goal of Step 2

After reading a document, Ledger investigates (Track A), explains, and **proposes actions**. You build the system that turns proposals into safe, executed actions, and the UI that makes Ledger's work visible:
- the **action system**: propose, approve, reject, mark done, execute, with autonomy rules enforced on the server
- **Approve cards** in the chat
- **live activity**: "Checking the sender... Checking your bank..." while Ledger works
- **friendly, translated UI**: document names, a verification badge, formatted amounts and dates

**Demo moment this step must support:**
1. María uploads the 972CG. While Ledger works, she sees it check the sender and the bank.
2. A card appears: "Pay $520.00 to United States Treasury from account ending 4417?" She taps Approve and confirms.
3. The card turns into "Paid ✓ Confirmation #…", and Ledger confirms in Spanish.

## 2. Pre-step tasks

1. **Stub `convex/actions.ts` first (about 20 minutes).** Write every Track B contract function (Section 8) with its exact name and arguments, returning placeholders. Track A's agent tool calls `internal.actions.propose`, so merge this small PR before anything else.
2. **Don't wait for Track A's schema PR.** Stub against the current schema; the `actions` table already exists. Add a `// TODO: owner_task after schema PR` where needed, and never edit `schema.ts`. Use your own Convex dev deployment (each developer has their own in the shared project; see `docs/dev-setup.md` once it lands). When the schema PR merges, pull and remove the TODOs. It adds `cases.verification`, `cases.bankCheck`, `documents.caseId`, and the `owner_task` action type.
3. **Google OAuth setup for Step 3.** Your developer does this by hand in the Google Cloud console; you write the checklist and the notes in `docs/google-oauth-setup.md`:
   1. Create a Google Cloud project and enable the **Gmail API**.
   2. Set up the OAuth consent screen: External, **Testing** mode. Add the team's demo Gmail account as a test user.
   3. Add the scopes `gmail.readonly` and `gmail.send`.
   4. Create an OAuth client of type "Web application". The redirect URI will be a Convex HTTP route (`https://<deployment>.convex.site/auth/google/callback`) plus localhost for development. Record the client ID; the secret goes into the Convex env in Step 3, never into git.
   5. Note in the doc that apps in Testing mode can show an "unverified app" warning, and that refresh tokens may expire after about a week. That's fine for the hackathon.

## 3. The action system (`convex/actions.ts`, you own it)

**Autonomy is decided by the server from the action type**, never by the agent:

| Type | Autonomy | Behavior |
|---|---|---|
| `pay_bill`, `send_email` | `one_tap` | Status `proposed`; it waits for Approve |
| `owner_task` | `human_only` | Status `proposed`; the owner taps "Mark done" |
| `create_document`, `add_calendar_event`, `schedule_followup` | `auto` | Executes immediately |

Rules:
- `approve` works only on `one_tap` actions with status `proposed`. `markDone` works only on `human_only` actions with status `proposed`. `reject` works on any `proposed` action. Any other call throws a clear error, and double taps are harmless.
- `approve` sets `approved` and `decidedAt`, logs `action_approved`, and schedules `execute`.
- `execute` (internal action):
  1. It runs only on `approved` actions, or on `auto` ones.
  2. It dispatches by type: `pay_bill` calls `internal.nessie.payBill` (Track A).
  3. On success, it sets `executed`, `executedAt`, and `result`, and logs `action_executed`. On error, it sets `failed` with the error in `result` and logs `action_failed`.
  4. Types not built yet are set to `executed` with `result.note = "available in a later step"`.
  5. After any final status, it calls `internal.agent.notifyActionResult` (Track A). It also calls it after `reject` and `markDone`.
- Log events through the existing `internal.events.logEvent` helper (Track A's file; check its signature in the repo). Each `summary` is one readable English line, e.g. "Owner approved paying $520.00 to United States Treasury".
- `pay_bill` payload shape: `{ amount, payee, accountLast4, memo?, dueDate? }`. `owner_task` payload shape: `{ instructions, callScript?: { en, translated }, phone? }`.

## 4. Approve cards in the chat

The agent references each action with the marker `[action:<actionId>]` on its own line, the same way Step 1 uses `[document:<id>]`. Render each marker as an `ActionCard` that live-updates from `actions.get`.

| Status | `pay_bill` card | `owner_task` card |
|---|---|---|
| proposed | Amount (large), payee, "from account ending 4417", due date. **[Approve]** opens a confirm dialog: "Pay $520.00 to United States Treasury from account ending 4417?" **[Reject]** | The instructions, an expandable call script (English plus translation, with a copy button), a tap-to-call phone link, and **[Mark done]** |
| approved | "Paying…" with a spinner | n/a |
| executed | "Paid ✓", the confirmation ID, and the time | "Done ✓" |
| rejected | "Not paid" in muted text | "Skipped" in muted text |
| failed | "Payment failed" plus the reason, in calm wording | n/a |

Use large tap targets (at least 44 px) and never more than two buttons. Disable the buttons the moment one is tapped.

## 5. Live activity ("Ledger is working")

Replace the plain "Ledger is working..." indicator with a step list built from `events.listRecentForOwner({ ownerId, sinceMs })`, where `sinceMs` is the time of the latest user message or document.
- Map event types to translated labels with icons:
  - `document_extracted`: "Reading the letter"
  - `sender_verified`: "Checking who sent it"
  - `playbook_loaded`: "Looking up the rules"
  - `bank_checked`: "Checking your bank"
  - `action_proposed`: "Preparing next steps"
- Show a check mark when a step is done. For `sender_verified`, show the verdict badge, and for `bank_checked`, "found a payment" or "no payment found".
- Put the English `summary` behind a small "details" toggle. Judges will open it.
- When the reply arrives, collapse the list into "What Ledger did (5 steps)" under that reply.

## 6. Friendlier, translated UI

- **UI translations:** `messages/{es,en,zh,vi,tr,ko}.json` and a `t()` helper (English fallback), driven by `owners.preferredLanguage`. Every label, button, status, and card string goes through `t()`. Draft the translations; a native speaker reviews Spanish before the demo.
- **Document names:** map `docType` to translated names, e.g. `IRS_CP14` → "Aviso de saldo del IRS (CP14)". Never show raw codes. Keep the code in small text for judges.
- **Document card additions:**
  - A verification badge from `cases.get`: Verified (green), Suspicious (red, "Don't pay or call the number on it"), or Unverified (gray)
  - The bank check line: "Already paid on Oct 2" or "No matching payment found"
- **`lib/format.ts`:** currency and dates in the owner's locale with `Intl`, plus a countdown such as "in 9 days" or "overdue". The model never formats numbers for the UI.
- **Mobile first:** test at 390 px, with no horizontal scroll.

## 7. Scenario test script

`scripts/test-scenarios.ts` (`npm run test:scenarios`). For each scenario:
1. Run `admin.resetDemo`.
2. Upload the fixture and wait for the agent's reply.
3. Check the proposals, then approve or reject through the mutations.
4. Check the final status and the follow-up reply.

| Scenario | Expected |
|---|---|
| `photos/cp14_photo.jpg` | `verified`; bank match on Oct 2; one `owner_task`; no `pay_bill` |
| `pdf/972cg.pdf` + approve | `pay_bill` $520 → `executed` with a confirmation ID; the follow-up reply mentions $520 and the account's last 4 |
| `pdf/972cg.pdf` + reject | `rejected`; the follow-up offers a dispute |
| `photos/scam_irs_photo.jpg` | `suspicious`; no `pay_bill` |
| Double approve | The second call is harmless; one payment only |

Write results to `test-results/scenarios.json` and print a pass/fail table.

## 8. Contract for Step 2 (shared with Track A)

**You implement:**

| Function | Type | Args | Returns |
|---|---|---|---|
| `actions.propose` | internal mutation | `{ ownerId, caseId, type, summary, payload }` | `actionId`. Sets `autonomyLevel` from `type` (Section 3); `auto` types execute immediately. Logs `action_proposed`. |
| `actions.approve` | mutation | `{ actionId }` | `null` |
| `actions.reject` | mutation | `{ actionId, reason? }` | `null` |
| `actions.markDone` | mutation | `{ actionId }` | `null` |
| `actions.get` | query | `{ actionId }` | the action or `null` |
| `actions.listForCase` | query | `{ caseId }` | actions newest-first |
| `actions.execute` | internal action | `{ actionId }` | `null` |

**Track A implements** (you call these):

| Function | Type | Args | Returns |
|---|---|---|---|
| `events.listRecentForOwner` | query | `{ ownerId, sinceMs?, limit? }` | events: `{ _id, type, summary, caseId?, at }` |
| `cases.get` | query | `{ caseId }` | the case, including `verification`, `bankCheck`, `title`, `deadline`, `amountDue`, `status` |
| `cases.listForOwner` | query | `{ ownerId }` | cases |
| `nessie.payBill` | internal action | `{ actionId }` | `{ confirmationId, paidAt, amount, payee, accountLast4 }`, or throws |
| `agent.notifyActionResult` | internal mutation | `{ ownerId, actionId }` | `null` |
| `admin.resetDemo` | internal mutation | none | `{ ownerId }` |

Until Track A's real versions land, build against their stubs and mock data with the same shapes.

## 9. Files you own

`convex/actions.ts`, `app/`, `components/`, `lib/`, `messages/`, `scripts/`, `docs/google-oauth-setup.md`.

Don't edit `convex/schema.ts` or any other Track A file (`agent.ts`, `extraction.ts`, `intake.ts`, `documents.ts`, `cases.ts`, `events.ts`, `owners.ts`, `admin.ts`, `nessie.ts`, `officialContacts.ts`, `playbooks/`, `testing.ts`). If you need a schema or backend change, ask Track A.

## 10. Git

- Branches: `b/step2-actions-stubs` (merge first), then `b/step2-...` for features
- Open a PR for each and request a review from Track A. Merge to `main` at least every 2 hours, and keep `main` runnable.
- Don't `npm update` the AI SDK packages; they're pinned for a reason (see the Step 1 report).

## 11. Acceptance criteria

- [ ] All `test:scenarios` pass on your dev deployment after both tracks are merged
- [ ] The 972CG demo works in the UI at 390 px: live steps, Approve → confirm dialog → "Paying…" → "Paid ✓", then a Spanish confirmation
- [ ] Server rules hold: a direct `approve` on an `owner_task` or on an already-executed action throws, and double taps make one payment
- [ ] The CP14 card shows "Verified" and "Already paid on Oct 2", and the `owner_task` card shows a copyable call script and a tap-to-call link
- [ ] The scam document shows a red "Suspicious" badge
- [ ] Switching the language to English changes every UI label, not only the agent's replies
- [ ] No raw type codes appear as main labels
- [ ] `docs/google-oauth-setup.md` exists, and the OAuth client is created (client ID recorded, secret not committed)

## 12. When you finish

Write `STEP2_REPORT_B.md` at the repo root: what you built, the scenario results, screenshots or a description of the card states, deviations, known issues, and anything Track A or Step 3 needs to know.
