# Step 2 report, Track A (backend and agent)

*Sat Oct 24, 2026. Brief: [docs/ledger-step2-A.md](docs/ledger-step2-A.md).*

**Status:** done and merged into `main`. All 25 acceptance checks passed in an end-to-end run on the shared cloud deployment with `NESSIE_MODE=mock`. With `NESSIE_MODE=live`, the CP14 scenario (11 checks) also passed against the real Nessie API. Typecheck and lint pass.

**Testing from here on is by hand:** run `npm run reset`, upload the fixtures in the app, and read the replies. The end-to-end script took about 10 minutes per run, so it was removed. `testing:snapshot` stays for quick checks from the CLI.

**UI languages:** English, Spanish and Turkish. Chinese, Vietnamese and Korean were removed.

Ledger now investigates on its own before it replies. It checks the sender against official contacts, loads the official playbook, and checks the bank. Then it explains and proposes actions, which Track B's cards approve and execute. After an action runs, Ledger confirms in the owner's language.

## Merged PRs

| PR | Branch | What |
|---|---|---|
| #2 | `a/step2-schema-stubs` | Schema changes, contract stubs, reset helper, dev setup |
| #3 | `b/step2-actions-stubs` (Mert) | `convex/actions.ts`: propose, approve, reject, mark done, execute |
| #4 | `b/step2-ui` (Mert) | Action cards, live activity, UI translation, friendly document card, `/dev` preview |
| #5 | `a/step2-agent` | Everything below |

While merging, Track A wired Track B's TODOs, since both sides were ready:
- In `actions.ts`, `owner_task` maps to `human_only`. The executor calls the real `nessie.payBill`, and every final status calls `agent.notifyActionResult`. The mock payment is removed.
- The UI now uses `events.listRecentForOwner`, `cases.listForOwner`, and `documents.caseId`, so the badge and bank line show in the live chat.
- `lib/contract.ts` now derives its types from the schema. The bank match shape is `{ date, amount, payee, memo? }`, not `description`.
- The chat hides server notes, which are messages starting with `[system-note]`.

## What was built

| Area | Files | Notes |
|---|---|---|
| Playbooks | `convex/playbooks/` | A zod schema, `irsCp14`, `irs972cg`, `countyHealthInspection`, and `getPlaybook(docType)`. Only the facts in brief Section 3. The Spanish glossary terms need a native speaker's review. |
| Official contacts | `convex/officialContacts.ts` | IRS, Alameda County Environmental Health, City of Oakland. `TODO: verify` is kept on the IRS individuals line and Oakland's phones. |
| Sender and scam check | `convex/senderCheck.ts` | Rule based, no LLM call (details below). |
| Extraction fields | `convex/extraction.ts` | `requestedPaymentMethods`, `pressureTactics` |
| Nessie, live and mock | `convex/nessie.ts` | Seeding, `checkBankHistory`, `payBill`. Mock tables are `mockBankAccounts` and `mockBankBills`. |
| Agent | `convex/agent.ts` | Tools `verify_sender`, `load_playbook`, `check_bank_history`, `propose_action`; the Step 2 instructions; a real `notifyActionResult` |
| Re-upload dedupe | `convex/documents.ts` | Re-reading or re-uploading a notice updates its open case instead of opening another. |
| Reset | `convex/admin.ts` | `npm run reset`; test flag `'{"withoutTreasuryPayment": true}'` |
| Tests | `convex/testing.ts` | `testing:snapshot`: cases, actions, events and the latest messages in one call |

How the sender check works:
- Phones are normalized with `libphonenumber-js` (1.13.15, pinned).
- Website and email domains are matched against the agency's domains.
- Red flags:
  - gift cards, crypto, wire transfers or payment apps as payment methods
  - any pressure tactic
  - a 555 number
  - an email outside the agency's domain
  - an agency name that matches no known agency
- `verified` needs at least one contact match and no red flags. Any red flag makes it `suspicious`.
- When the letter names no real agency, the agency it seems to impersonate is guessed from keywords, so the reply can still give the real number.
- A suspicious UNKNOWN document opens a case titled "Suspicious letter…", so the badge and reasons show in the UI.

### What the code enforces (not just the prompt)

`propose_action` refuses `pay_bill` in each of these cases:
- `verify_sender` hasn't run, or the verdict isn't `verified`
- `check_bank_history` hasn't run
- the bank shows a matching payment
- the balance can't cover the amount
- the amount differs from the case's `amountDue`

On a `pay_bill`, the amount, the account's last 4 digits and the due date are always taken from the case and the owner record, never from the model. A second proposal of the same type on the same case returns the existing card instead of a new one, which covers re-uploads and retries. Every tool checks that the document or case belongs to the owner. `payBill` refuses unless the action is an `approved` `pay_bill`.

## Nessie endpoints and why

`api.nessieisreal.com` returned 403 to the docs fetch and refused API connections from the dev machine. The endpoints were therefore confirmed against Nessie's official SDK ([nessieisreal/nessie-javascript-sdk](https://github.com/nessieisreal/nessie-javascript-sdk)). The key goes in a `?key=` query parameter, as the brief expected.

| Use | Endpoint |
|---|---|
| Seed the customer | `POST /customers` |
| Seed the account | `POST /customers/{id}/accounts` (Checking, balance 4800, account number ending 4417) |
| Payment history and new payments | `GET` / `POST /accounts/{id}/bills` |
| Balance | `GET /accounts/{id}` |

**Bills represent past payments.** A bill has a free-text `payee`, a `payment_amount`, a `payment_date` and a `status`, which is exactly "paid X to Y on Z". The memo goes in `nickname`. Purchases need a merchant id, and withdrawals have no payee, so neither fits.

Community projects report that `GET /bills` can fail unless both `payment_date` and `recurring_date` are sent, so both are always sent. In live mode a new bill doesn't change the Nessie balance; in mock mode the balance goes down. The base URL is `https://api.nessieisreal.com`: plain `http://`, as in the SDK and the brief, no longer connects. It can be overridden with `NESSIE_BASE_URL` (`https://prod-api.nessieisreal.com` also answers).

**Mock mode** uses the same functions and return shapes, backed by Convex tables. Seed data:
- Balance $4,800.00, account ending 4417
- $1,240.18 to United States Treasury on 2026-10-02, memo "Form 941 Q2 2026"
- Six supplier payments in September and October (produce, meat, paper goods)
- No $520 payment

## Acceptance results (`NESSIE_MODE=mock`, fresh reset per scenario; one end-to-end run)

| Check | Result |
|---|---|
| `cp14_photo.jpg`: verified, Oct 2 payment found, leads with "real letter, already paid, don't pay again", `owner_task` with a call script, no `pay_bill` | Pass. "La carta es real, y usted ya la pagó. **No pague otra vez.**" |
| CP14 without the seeded payment: `pay_bill` for $1,240.18 | Pass (`accountLast4` 4417, due date 2026-11-02) |
| `972cg.pdf`: verified, `pay_bill` for $520, asks about a reason for filing late | Pass |
| Approving the 972CG payment: payment made, `executed`, Spanish confirmation with the amount and last 4 | Pass. "Listo, se pagaron $520.00 al United States Treasury desde la cuenta que termina en 4417. El número de confirmación es #MOCK-…" A second approve throws. |
| Rejecting it: reply offers the dispute path | Pass. "¿Quiere que prepare una declaración para disputar la multa, explicando la causa razonable?" |
| `scam_irs_photo.jpg`: suspicious with readable reasons, no `pay_bill`, official IRS number | Pass. Flags the unknown agency, the 555 number, the non-IRS email, gift cards, Bitcoin, and 8 pressure tactics. The reply gives 800-829-4933. |
| `inspection_yellow_photo.jpg`: yellow, score 77, the 3 majors, the reinspection date, no proposals | Pass |
| Re-uploading the same document doesn't create a second case | Pass (also no second action card) |
| `NESSIE_MODE=mock` passes all of the above | Pass |
| Every step appears in `events` with a readable summary | Pass. Example: "Found a $1,240.18 payment to United States Treasury on 2026-10-02 (Form 941 Q2 2026)" |

The UI with real data in the live chat has not been checked by hand yet; the cards were tested by Track B on mocks at 390px.

## Deviations from the brief

- **`verify_sender` lives in `convex/senderCheck.ts`**, a new Track A file, rather than inside `officialContacts.ts`.
- **`load_playbook` takes an optional `caseId`**, so it can set `cases.playbookDocType` and tie the event to the case.
- **`propose_action` only accepts `pay_bill` and `owner_task`** for now. The other types aren't executable until Step 4.
- **Agency names guide the payee match.** For the IRS, the bank check matches "United States Treasury", "US Treasury", "IRS", "EFTPS" and "Internal Revenue". For other agencies, it matches their name.
- **The date rule was relaxed.** On top of the brief's instruction "never reformat amounts and dates", the agent may write an ISO date out in words in the owner's language without changing it. Without this, replies showed `2026-10-02`.
- **The agent is told not to write text between tool calls.** The first run leaked an English planning sentence into the reply.
- **`notifyActionResult` notes are user-role messages** that start with `[system-note]`. The model reads them in order, and the UI hides them. A real system-role message in the middle of a thread is rejected by the Anthropic adapter.
- **`convex/tsconfig.json` adds `"types": ["node"]`** so `process.env` typechecks.

## Known issues

- **Live Nessie: only the CP14 scenario has run end to end.** Seeding, reading bills back, and the Oct 2 match all work. Paying a bill live hasn't been tried yet; approve the 972CG in the app to check it. Nessie only answers over `https://`, and the default now uses it. If Nessie goes down, run `npx convex env set NESSIE_MODE mock` and then `npm run reset`.
- **Wording varies between runs.** One CP14 reply corrected itself mid-sentence ("2 de octubre... perdón, 2 de noviembre"). Replies also switch between "usted" and "tú". Consider adding a formality rule.
- **Spanish needs review by a native speaker:** the playbook glossary, the agent's replies, and Track B's `messages/es.json`.
- **The bank lookback is relative to today.** Seeded payments are dated Sep and Oct 2026, so after about mid-January 2027 the Oct 2 match falls outside the 120 days. Move the seed dates if the demo is later.
- **`IGNORE_SAMPLE_WATERMARKS` is still `true`** (from Step 1). Set it to `false` before real documents.
- **Still from Step 1:** multi-photo documents, no streaming, and no auth.

## For Track B and Step 3

- **Approve flow:** approving a payment calls `actions.approve`, then `actions.execute`, then `nessie.payBill`, then `actions.finish`, then `agent.notifyActionResult`, which posts a hidden note and a reply. Reject and mark done also call `notifyActionResult`.
- **`owner_task` payload:** `{ instructions, phone?, callScript?: { en, translated }, payment?: { date, amount, payee, memo? } }`.
- **Suspicious cases:** a suspected scam opens a case (docType `UNKNOWN`, with a "Suspicious letter…" title) with `verification` set.
- **Before a demo:** run `npm run reset`.
- **Step 3 (Gmail):** intake is unchanged, so Gmail calls `intake.ingestDocument` with `source: "gmail"`, and the whole Step 2 workflow runs as is. Duplicate emails of the same notice are deduplicated by type, amount and deadline.
