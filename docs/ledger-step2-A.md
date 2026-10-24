# Ledger: Step 2 Brief, Track A (backend and agent)

You are continuing **Ledger**, a hackathon project (Cal Hacks 13.0, deadline **Sunday Oct 25, 2026, 9:00 AM PT**). Step 1 is merged on `main`. Before writing code, read these files in the repo:
- `docs/ledger-step1.md`: the full project context. Sections 1 to 3 (what Ledger is and the agent principle) still apply.
- `STEP1_REPORT.md`: what was actually built, package versions, deviations, and known issues.

Two developers work in parallel. **You are Track A (backend and agent).** Track B is building the action system and the UI at the same time from a sibling brief. Stick to the files you own (Section 9) and the contract (Section 8).

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

After reading a document, Ledger **investigates on its own** (checks the sender, loads the official playbook, checks the bank), **explains**, and **proposes concrete actions**. The owner approves with one tap, and Ledger executes.

**Demo moment this step must produce:** María uploads the CP14. Ledger replies, in Spanish: *"This IRS letter is real. It says you owe $1,240.18, but you already paid $1,240.18 to the US Treasury on October 2. Your bank record proves it. Don't pay again."* It then proposes the next step.

## 2. Pre-step tasks (do these first, about 20 minutes)

1. **Link a Convex cloud project:** run `npx convex login`, link a cloud project, and push. Track B needs a shared dev deployment. Put the deployment URL and setup steps in `docs/dev-setup.md`.
2. **Reset helper:** `admin.resetDemo` (internal mutation) plus `npm run reset`. It deletes the owner's thread, documents, cases, actions, tasks, and events, re-seeds María and her agent thread, and re-seeds her Nessie data (Section 5).
3. **Schema changes** from Section 7. Push them together with **stubs** for every Track A contract function (Section 8), so Track B can build against them. Open this as a small PR and merge it before anything else.

## 3. Playbooks

Create `convex/playbooks/` with one TypeScript file per document type, validated by a zod schema in `convex/playbooks/schema.ts`, plus a registry `getPlaybook(docType)`.

Playbook shape:
```ts
{
  docType: "IRS_CP14" | "IRS_972CG" | "COUNTY_HEALTH_INSPECTION",
  title: string,                // English, e.g. "IRS balance due notice"
  whatItMeans: string,          // 2-3 plain English sentences, only facts from the sources
  keyFacts: string[],           // short, each traceable to a source
  options: {
    id: string,                 // e.g. "pay", "payment_plan", "already_paid", "dispute"
    when: string,               // when this option fits
    proposedActionType: "pay_bill" | "owner_task" | "create_document" | "send_email" | null
  }[],
  escalateIf: string[],         // when to recommend a professional
  glossary: { en: string, es: string }[],  // key terms shown bilingually, e.g. penalty / multa
  sources: string[]             // official URLs the facts came from
}
```

**Facts you may use** (verified by the team against official sources; don't add legal facts beyond these):

- **IRS_CP14**
  - It's the IRS notice saying a balance is due on a filed return. It shows the amount due and a pay-by date.
  - Penalties and interest keep growing until the balance is paid.
  - Options printed on the notice: pay in full, set up a payment plan (irs.gov/paymentplan), or, if you disagree or already paid, call the number on the notice.
  - IRS business line: 800-829-4933.
  - Sources: https://www.irs.gov/individuals/understanding-your-cp14-notice and https://www.irs.gov/payments
- **IRS_972CG**
  - A notice of a *proposed* penalty for information returns (such as Form 1099) filed late or incorrectly.
  - The taxpayer must respond within 45 days of the notice date. Options: agree and pay, partly agree, or disagree with a signed statement explaining reasonable cause. If there's no response, the IRS assesses the penalty.
  - For returns due in 2026, the penalty is $60 per return if filed within 30 days late, $130 if filed more than 30 days late but by August 1, and $340 after August 1.
  - Sources: https://www.irs.gov/payments/information-return-penalties
- **COUNTY_HEALTH_INSPECTION** (Alameda County)
  - Green means pass. Yellow means conditional pass: a score of 75 to 79, or two or more major violations corrected during the inspection. Red means closure: a score below 75, or a major violation that couldn't be corrected.
  - A yellow placard stays posted until reinspection, for at most about one week.
  - Major violations are CDC risk factors; minor violations are retail practices.
  - Sources: https://health.alamedacountyca.gov/frequently-asked-questions-food-safety/

If a fact is ever missing, write `TODO: verify` in the playbook. Don't invent one.

## 4. Sender and scam check

**Extraction changes** (`convex/extraction.ts`). Add these fields to the schema and prompt:
- `requestedPaymentMethods: string[]`: how the document asks to be paid, e.g. `["irs.gov online", "check by mail"]` or `["gift cards", "bitcoin"]`
- `pressureTactics: string[]`: short phrases showing threats or unusual urgency, e.g. `["arrest within 48 hours", "do not contact your accountant"]`

Keep the existing nullable-field workaround from Step 1.

**Official contacts list** (`convex/officialContacts.ts`):
- **IRS:** phones `800-829-4933` (business) and `800-829-1040` (individuals, mark `TODO: verify`); domains `irs.gov`, `treasury.gov`
- **Alameda County Environmental Health:** phone `(510) 567-6700`; domains `acgov.org`, `alamedacountyca.gov`; address 1131 Harbor Bay Parkway, Alameda CA 94502
- **City of Oakland:** domain `oaklandca.gov` (phones `TODO: verify`)

**Tool `verify_sender({ documentId })`**. It is rule-based, with no LLM call.
1. Normalize the printed phone numbers with `libphonenumber-js` and match them against the agency's list. Match domains on websites and emails.
2. Red flags:
   - gift cards, crypto, wire transfer, or payment apps in `requestedPaymentMethods`
   - any `pressureTactics`
   - a 555 phone number
   - an email domain that isn't the agency's
   - an agency name that matches no known agency
3. Return `{ verdict: "verified" | "suspicious" | "unverified", reasons: string[] }`. `verified` requires at least one contact match and no red flags. Any red flag makes it `suspicious`.
4. Save the result on the case (`cases.verification`) and log a `sender_verified` event with a readable summary.

## 5. Nessie bank check and payment

`convex/nessie.ts`, with `NESSIE_API_KEY` and `NESSIE_MODE` (`"live"` or `"mock"`) in the Convex env.
- **Verify the API against the docs at http://api.nessieisreal.com before coding.** Expected: the key goes in a `?key=` query parameter; there are endpoints for customers, accounts, bills, purchases, withdrawals, and deposits. Pick the endpoint that best represents a past outgoing payment with a payee, amount, and date, and document your choice in the report.
- **Mock mode:** the same functions backed by a Convex table or a hardcoded dataset with the same return shape. The demo must still work if Nessie is down.

Seed data (run by `admin.resetDemo`), for María's business checking account:
- Balance: **$4,800.00**
- A past payment of **$1,240.18 to "United States Treasury" on 2026-10-02**, memo "Form 941 Q2 2026". This drives the CP14 "already paid" moment.
- Five or so normal supplier payments (produce, meat, a paper goods supplier) in September and October 2026
- **No** payment matching the 972CG's $520
- Save the Nessie customer and account IDs on the owner record

**Tool `check_bank_history({ caseId })`**
- It reads the case (amount, issuer, deadline, notice date).
- It searches the last 120 days for payments to a matching payee (for the IRS: "United States Treasury", "IRS", "EFTPS") with an amount within $1.00 of `amountDue`.
- It returns `{ balance, matches: [{ date, amount, payee, memo }], canAffordFullPayment }`, saves it on `cases.bankCheck`, and logs a `bank_checked` event.

**Internal action `nessie.payBill({ actionId })`**
- Called only by Track B's executor after approval.
- It creates the payment in Nessie (or the mock), then returns `{ confirmationId, paidAt, amount, payee, accountLast4 }`.
- It must refuse if the action's status isn't `approved`. That's defense in depth.

## 6. Agent workflow

**New tools** for `ledgerAgent`, each logging events with readable summaries:
- `load_playbook({ docType })`
- `verify_sender({ documentId })`
- `check_bank_history({ caseId })`
- `propose_action({ caseId, type, summary, payload })`: calls Track B's `internal.actions.propose`. Don't pass an autonomy level; Track B's server sets it by type (Section 8). It returns `{ actionId }`.

**Required sequence after `read_document`** (put this in the instructions and enforce what you can in code):
1. If `overallConfidence` is below 0.6 or `docType` is `UNKNOWN`: stop and reply. For `UNKNOWN`, still run `verify_sender` if the text mentions a government agency, so scams get flagged.
2. `verify_sender`. If `suspicious`: warn clearly, say not to pay or call the printed number, and give the official number from the contacts list. **Never propose `pay_bill` for a suspicious document.**
3. `load_playbook`
4. `check_bank_history` when there is an `amountDue`
5. Reply and propose actions

**Proposals for the demo documents:**
- **CP14 with a matching payment:**
  - Don't propose `pay_bill`.
  - Propose an `owner_task`: "Call the IRS at 800-829-4933 to confirm your October 2 payment." The payload includes a short call script in English with a Spanish translation, and the payment details.
  - Step 4 will add the proof PDF.
- **CP14 with no matching payment:** propose `pay_bill` for the amount due, payee "United States Treasury", from the account ending in its last 4 digits. If the balance can't cover it, propose the payment-plan option as an `owner_task` instead.
- **972CG:**
  - Propose `pay_bill` for $520 (the "agree" option).
  - Ask the owner one question: was there a reason the 1099s were filed late? If yes, say Ledger will prepare a dispute statement (Step 4).
- **Inspection:** explain the placard, the score, and the major violations, and give the reinspection date. Say a fix checklist is coming (Step 5). No proposals yet.

**Message format.** In the reply text, reference each proposed action with the marker `[action:<actionId>]` on its own line, the same way Step 1 uses `[document:<id>]`. Track B renders the markers as Approve cards.

**After an action runs:** implement `agent.notifyActionResult({ ownerId, actionId })` (internal). Track B's executor calls it after any status change. It adds a short system note to the thread and schedules a brief agent reply in the owner's language ("Done. I paid $520 from the account ending 4417. Confirmation #..."). It's also called on rejection ("OK, I won't pay. Want me to prepare a dispute instead?").

**Instruction additions** (on top of Step 1's):
```
- Investigate before you speak: verify the sender, load the playbook, and check the bank first.
- Lead with the most important fact: is the letter real, the amount, the deadline, and whether it is already paid.
- Use the playbook glossary: write key terms in the owner's language with the English term in parentheses, e.g. "multa (penalty)".
- Amounts and dates must come from tool results. Never compute or reformat them yourself beyond what the tools return.
- Anything meant for an agency is written in English. The owner gets a translation labeled "for your understanding".
- Propose actions with propose_action. Never claim an action happened unless notifyActionResult reported it.
```

## 7. Schema changes (Track A owns `convex/schema.ts`)

- `cases`: add `verification?: { verdict, reasons }`, `bankCheck?: { balance, matches, canAffordFullPayment, checkedAt }`, `playbookDocType?`
- `owners`: add `nessieCustomerId?`, `nessieAccountId?`, `accountLast4?`
- `actions.type`: add `"owner_task"`, a `human_only` step such as a call or signature, with instructions in the payload
- `actions`: add `threadMessageId?` if useful for linking a card to its message
- `documents`: add `caseId?`, so the UI can link the two
- **Fix from the Step 1 report:** `saveExtraction` must be idempotent. Re-reading a document updates its existing case instead of opening a second one.

## 8. Contract for Step 2 (shared with Track B)

**Track A implements:**

| Function | Type | Args | Returns |
|---|---|---|---|
| `events.listRecentForOwner` | query | `{ ownerId, sinceMs?, limit? }` | events newest-first: `{ _id, type, summary, caseId?, at }` |
| `cases.get` | query | `{ caseId }` | the case, including `verification`, `bankCheck`, `title`, `deadline`, `amountDue`, `status` |
| `cases.listForOwner` | query | `{ ownerId }` | cases newest-first |
| `nessie.payBill` | internal action | `{ actionId }` | `{ confirmationId, paidAt, amount, payee, accountLast4 }`, or throws |
| `agent.notifyActionResult` | internal mutation | `{ ownerId, actionId }` | `null` (schedules the follow-up reply) |
| `admin.resetDemo` | internal mutation | none | `{ ownerId }` |

**Track B implements** (you call `actions.propose` from your tool):

| Function | Type | Args | Returns |
|---|---|---|---|
| `actions.propose` | internal mutation | `{ ownerId, caseId, type, summary, payload }` | `actionId`. Sets `autonomyLevel` from `type`: `pay_bill` and `send_email` are `one_tap`; `owner_task` is `human_only`; `create_document`, `add_calendar_event`, and `schedule_followup` are `auto` and execute immediately. |
| `actions.approve` / `actions.reject` / `actions.markDone` | mutations | `{ actionId, reason? }` | `null` |
| `actions.listForCase` / `actions.get` | queries | `{ caseId }` / `{ actionId }` | actions |
| `actions.execute` | internal action | `{ actionId }` | Dispatches by type: `pay_bill` calls `nessie.payBill`; types not built yet are marked `executed` with `result.note = "available in a later step"`. Then calls `agent.notifyActionResult`. |

**Event types to log** (Track B shows them as live activity): `document_received`, `tool_called`, `document_extracted`, `case_opened`, `sender_verified`, `playbook_loaded`, `bank_checked`, `action_proposed`, `action_approved`, `action_rejected`, `action_executed`, `action_failed`. Every `summary` is one readable English line, e.g. "Sender verified: phone 800-829-4933 matches the IRS", or "Found a $1,240.18 payment to United States Treasury on Oct 2".

## 9. Files you own

`convex/schema.ts`, `convex/agent.ts`, `convex/extraction.ts`, `convex/intake.ts`, `convex/documents.ts`, `convex/cases.ts`, `convex/events.ts`, `convex/owners.ts`, `convex/admin.ts`, `convex/nessie.ts`, `convex/officialContacts.ts`, `convex/playbooks/`, `convex/testing.ts`, `docs/dev-setup.md`.

Don't edit `convex/actions.ts` (Track B), `app/`, `components/`, `lib/`, `messages/`, or `scripts/`. Ask Track B instead.

## 10. Git

- Branches: `a/step2-schema-stubs` (merge first), then `a/step2-...` for features
- Open a PR for each and request a review from Track B. Merge to `main` at least every 2 hours, and keep `main` runnable.
- Don't `npm update` the AI SDK packages; they're pinned for a reason (see the Step 1 report).

## 11. Acceptance criteria

Run on a fresh reset (`npm run reset`):
- [ ] `cp14_photo.jpg`: verdict `verified`; the bank check finds the Oct 2 payment; the reply leads with "real letter, already paid, don't pay again"; an `owner_task` is proposed with a call script; **no** `pay_bill` is proposed
- [ ] With the seeded payment removed (a test flag on reset), the CP14 proposes `pay_bill` for $1,240.18
- [ ] `972cg.pdf`: `verified`; `pay_bill` for $520 is proposed; the agent asks about a reason for the late filing
- [ ] Approving the 972CG payment creates it in Nessie (or the mock), sets the action to `executed`, and produces a Spanish confirmation reply with the amount and the account's last 4 digits
- [ ] Rejecting it produces a reply offering the dispute path
- [ ] `scam_irs_photo.jpg`: `suspicious` with readable reasons; no `pay_bill`; the reply gives the official IRS number
- [ ] `inspection_yellow_photo.jpg`: an explanation of yellow, score 77, the 3 majors, and the reinspection date; no proposals
- [ ] Re-uploading the same document doesn't create a second case
- [ ] `NESSIE_MODE=mock` passes all of the above
- [ ] Every step appears in `events` with a readable summary

## 12. When you finish

Write `STEP2_REPORT_A.md` at the repo root: what you built, the Nessie endpoints used and why, the acceptance results, deviations, known issues, and anything Track B or Step 3 needs to know.
