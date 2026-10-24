# Step 2 report (final): investigation, explanation and actions

*Sat Oct 24, 2026. Briefs: [docs/ledger-step2-A.md](docs/ledger-step2-A.md) (Track A, backend and agent) and [docs/ledger-step2-B.md](docs/ledger-step2-B.md) (Track B, action system and UI). This report replaces `STEP2_REPORT_A.md`.*

**Status: done and merged into `main` (PRs #2 to #7).** Ledger now investigates a letter on its own before replying: it checks the sender against official contacts, loads the official playbook and checks the bank. Then it explains in the owner's language and proposes actions, which the owner approves on a card. After an action runs, Ledger confirms in the owner's language.

- **Acceptance:** all 25 checks passed in an end-to-end run on dev with `NESSIE_MODE=mock`. With `NESSIE_MODE=live`, the CP14 scenario (11 checks) also passed against the real Nessie API. Typecheck and lint pass.
- **What Step 3 changed since:** the hardcoded demo owner, `npm run seed` and the "no auth" known issue are gone. Every Google account now gets its own owner and sandbox bank. See [STEP3_REPORT.md](STEP3_REPORT.md).

## Demo moments

- **CP14 (already paid):** María uploads the CP14. Ledger checks the sender and the bank while the owner watches the steps. It replies: "La carta es real, y usted ya la pagó. **No pague otra vez.**" It proposes a call to the IRS, with a call script in English and Spanish.
- **972CG (pay):** a card reads "Pay $520.00 to United States Treasury from account ending 4417?" Approve, then confirm, then "Paying…", then "Paid ✓ Confirmation #…". Ledger confirms in Spanish.
- **Scam letter:** a red "Suspicious" badge, the reasons, no payment card, and the IRS's real phone number.

## Merged PRs

| PR | Track | Branch | What |
|---|---|---|---|
| #2 | A | `a/step2-schema-stubs` | Schema changes, contract stubs, reset helper, dev setup |
| #3 | B | `b/step2-actions-stubs` | `convex/actions.ts`: propose, approve, reject, mark done, execute |
| #4 | B | `b/step2-ui` | Action cards, live activity, UI translation, friendly document card, `/dev` preview |
| #5 | A | `a/step2-agent` | Playbooks, sender check, Nessie bank check, agent workflow |
| #6 | A | `a/step2-nessie-https` | Nessie over HTTPS (live mode fix); UI languages limited to es, en, tr; e2e script removed |
| #7 | A | `a/real-docs-fixes` | Unknown agencies come out "unverified", not "suspicious"; watermark setting moved to an env var, off by default |

While merging, Track A wired the remaining connections, since both sides were ready:
- In `actions.ts`, `owner_task` maps to `human_only`. The executor calls the real `nessie.payBill`, and every final status calls `agent.notifyActionResult`. The mock payment is removed.
- The UI uses `events.listRecentForOwner`, `cases.listForOwner` and `documents.caseId`, so the verdict badge and the bank line show in the live chat.
- `lib/contract.ts` derives its types from the schema. A bank match is `{ date, amount, payee, memo? }`.
- The chat hides server notes, which are messages starting with `[system-note]`.

## What was built

### Track A: backend and agent

| Area | Files | Notes |
|---|---|---|
| Playbooks | `convex/playbooks/` | A zod schema, `irsCp14`, `irs972cg`, `countyHealthInspection`, and `getPlaybook(docType)`. Only the facts in brief Section 3. |
| Official contacts | `convex/officialContacts.ts` | IRS, Alameda County Environmental Health, City of Oakland. `TODO: verify` is kept on the IRS individuals line and Oakland's phones. |
| Sender and scam check | `convex/senderCheck.ts` | Rule based, no LLM call (details below) |
| Extraction fields | `convex/extraction.ts` | `requestedPaymentMethods`, `pressureTactics` |
| Nessie, live and mock | `convex/nessie.ts` | Seeding, `checkBankHistory`, `payBill`. Mock tables are `mockBankAccounts` and `mockBankBills`. |
| Agent | `convex/agent.ts` | Tools `verify_sender`, `load_playbook`, `check_bank_history`, `propose_action`; the Step 2 instructions; `notifyActionResult` |
| Re-upload dedupe | `convex/documents.ts` | Re-reading or re-uploading a notice updates its open case instead of opening another |
| Test helper | `convex/testing.ts` | `testing:snapshot`: cases, actions, events and the latest messages in one call |

### Track B: action system and UI

| Area | Files | Notes |
|---|---|---|
| Action system | `convex/actions.ts` | The server sets autonomy from the type, never the agent: `pay_bill` is one tap, `owner_task` is human only, the rest are auto. `approve` only works on proposed one-tap actions, `markDone` only on proposed owner tasks; anything else throws, and double taps are harmless. |
| Action cards | `components/action-card.tsx` | An `[action:<id>]` line in a reply becomes a live card. `pay_bill`: amount, payee, account last 4, due date with countdown, Approve opens a confirm dialog, then "Paying…", then "Paid ✓" with the confirmation ID. `owner_task`: instructions, a call script in English and translated with Copy buttons, a tap-to-call link, and Mark done. 44 px tap targets, at most two buttons, buttons lock on the first tap. |
| Live activity | `components/activity.tsx` | Replaces "Ledger is working…" with the steps (reading the letter, checking who sent it, looking up the rules, checking the bank, preparing next steps). Each has a check mark and a "details" toggle with the English audit line. When the reply arrives they collapse into "What Ledger did (N steps)". |
| Translated UI | `lib/i18n.tsx`, `messages/{en,es,tr}.json` | Every label goes through `t()` with an English fallback. Document types have translated names; the raw code is shown only in small text. |
| Document card | `components/document-card.tsx`, `components/verification-badge.tsx` | Verified (green), Suspicious (red, "Don't pay or call the number on it") or Not verified (gray); a deadline countdown; "Already paid on Oct 2" or "No matching payment found" |
| Formatting | `lib/format.ts`, `lib/use-today.ts` | Money and dates in the owner's locale with `Intl`. The date is read only in the browser, so Next 16's Cache Components never see `new Date()` during prerender. |
| Card preview | `app/dev/page.tsx`, `lib/mocks.ts` | Every card state with mock data. Since Step 3 it returns 404 in production. |

### How the sender check works

- Phones are normalized with `libphonenumber-js` (1.13.15, pinned). Website and email domains are matched against the agency's domains.
- Red flags:
  - gift cards, crypto, wire transfers or payment apps as payment methods
  - any pressure tactic
  - a 555 number
  - an email outside the agency's domain (or, for an agency not on the list, outside any `.gov` or `.us` domain)
  - an agency name that imitates a known agency without matching it, e.g. "Internal Revenue Tax Enforcement Division"
- `verified` needs at least one contact match and no red flags. Any red flag makes it `suspicious`.
- An agency that isn't on the list and imitates nothing (another county, a state agency) is **not** a red flag. The result is `unverified`, with the reason "isn't on Ledger's list of agencies yet". `propose_action` still refuses to pay it.
- Imitation is judged on the printed agency name only. An earlier version also read the letter's summary and matched the word "tax", which treated a real state tax letter as imitating the IRS.
- For an imitating letter, the reply gives the real agency's official number. A suspicious letter opens a case titled "Suspicious letter…", so the badge and reasons show in the UI.

### What the code enforces (not just the prompt)

`propose_action` refuses `pay_bill` when:
- `verify_sender` hasn't run, or the verdict isn't `verified`
- `check_bank_history` hasn't run
- the bank shows a matching payment
- the balance can't cover the amount
- the amount differs from the case's `amountDue`

On a `pay_bill`, the amount, the account's last 4 digits and the due date always come from the case and the owner record, never from the model. A second proposal of the same type on the same case returns the existing card. Every tool checks that the document or case belongs to the owner. `payBill` refuses unless the action is an approved `pay_bill`.

## Nessie endpoints and why

`api.nessieisreal.com` returned 403 to the docs fetch, so the endpoints were confirmed against Nessie's official SDK ([nessieisreal/nessie-javascript-sdk](https://github.com/nessieisreal/nessie-javascript-sdk)). The key goes in a `?key=` query parameter.

| Use | Endpoint |
|---|---|
| Seed the customer | `POST /customers` |
| Seed the account | `POST /customers/{id}/accounts` (Checking, balance 4800, account number ending 4417) |
| Payment history and new payments | `GET` / `POST /accounts/{id}/bills` |
| Balance | `GET /accounts/{id}` |

- **Bills represent past payments.** A bill has a free-text `payee`, a `payment_amount`, a `payment_date` and a `status`: exactly "paid X to Y on Z". The memo goes in `nickname`. Purchases need a merchant id and withdrawals have no payee, so neither fits.
- `GET /bills` can fail unless both `payment_date` and `recurring_date` are sent, so both are always sent.
- In live mode a new bill doesn't change the Nessie balance; in mock mode the balance goes down.
- The base URL is `https://api.nessieisreal.com`; plain `http://` no longer connects. It can be overridden with `NESSIE_BASE_URL`.
- **Seed data**, the same in both modes:
  - balance $4,800.00, account ending 4417
  - $1,240.18 to United States Treasury on 2026-10-02, memo "Form 941 Q2 2026"
  - six supplier payments in September and October
  - no $520 payment

## Acceptance results

End-to-end run on dev, `NESSIE_MODE=mock`, fresh reset per scenario:

| Check | Result |
|---|---|
| `cp14_photo.jpg`: verified, Oct 2 payment found, leads with "real letter, already paid, don't pay again", `owner_task` with a call script, no `pay_bill` | Pass |
| CP14 without the seeded payment: `pay_bill` for $1,240.18 | Pass (account 4417, due date 2026-11-02) |
| `972cg.pdf`: verified, `pay_bill` for $520, asks about a reason for filing late | Pass |
| Approving the 972CG payment: paid, `executed`, Spanish confirmation with the amount and last 4 | Pass. "Listo, se pagaron $520.00 al United States Treasury desde la cuenta que termina en 4417…" A second approve throws. |
| Rejecting it: the reply offers the dispute path | Pass |
| `scam_irs_photo.jpg`: suspicious with readable reasons, no `pay_bill`, official IRS number | Pass. Flags the fake agency name, the 555 number, the non-IRS email, gift cards, Bitcoin and 8 pressure tactics. The reply gives 800-829-4933. |
| `inspection_yellow_photo.jpg`: yellow, score 77, the 3 majors, the reinspection date, no proposals | Pass |
| Re-uploading the same document doesn't create a second case or card | Pass |
| Every step appears in `events` with a readable summary | Pass |

UI checks (Track B, 390 px, on the `/dev` mock preview):
- The 972CG flow runs Approve, then the confirm dialog, then "Paid ✓ Confirmación #…". All five `pay_bill` and three `owner_task` states render.
- The call script expands, and the tap-to-call link is `tel:8008294933` at 44 px.
- The CP14 card shows "Verified sender" and "Already paid on Oct 2". The scam card shows the red Suspicious badge.
- Switching to English leaves no Spanish strings. No raw type codes appear as main labels.

After PR #7, the new sender rule was checked directly on three inputs:
- the scam letter: `suspicious`
- a California Department of Tax and Fee Administration letter: `unverified` (it was `suspicious` before)
- a real IRS letter: `verified`

## Deviations from the briefs

- **`verify_sender` lives in `convex/senderCheck.ts`**, a new file, rather than inside `officialContacts.ts`.
- **`load_playbook` takes an optional `caseId`**, so it can set `cases.playbookDocType` and tie the event to the case.
- **`propose_action` only accepts `pay_bill` and `owner_task`.** The other types aren't executable yet.
- **Agency names guide the payee match.** For the IRS, the bank check matches "United States Treasury", "US Treasury", "IRS", "EFTPS" and "Internal Revenue".
- **The date rule was relaxed.** The agent may write an ISO date out in words in the owner's language without changing it. Without this, replies showed `2026-10-02`.
- **The agent doesn't write text between tool calls.** The first run leaked an English planning sentence into the reply.
- **`notifyActionResult` notes are user-role messages** starting with `[system-note]`. The model reads them in order and the UI hides them. A system-role message in the middle of a thread is rejected by the Anthropic adapter.
- **`actions.get` takes a string** and returns `null` for a malformed id, so a bad marker from the model can't crash the chat.
- **UI languages are English, Spanish and Turkish.** Chinese, Vietnamese and Korean were dropped.
- **No scenario test script.** The end-to-end script took about 10 minutes per run and was removed in #6. Testing is by hand plus `testing:snapshot`.
- **`docs/google-oauth-setup.md` wasn't written.** Gmail was cut from the roadmap. Google sign-in setup for Step 3 lives in [docs/dev-setup.md](docs/dev-setup.md).

## Known issues still open

- **Live Nessie payments:** only the CP14 scenario has run end to end live. Paying a bill live hasn't been tried; approving the 972CG in the app checks it. If Nessie goes down, set `NESSIE_MODE=mock`; owners then need "Start over with demo data" to get a mock bank.
- **Wording varies between runs.** One CP14 reply corrected itself mid-sentence. Replies also switch between "usted" and "tú". A formality rule is planned for Step 5.
- **Spanish and Turkish need a native speaker's review:** the playbook glossary, the agent's replies and `messages/*.json`.
- **The bank lookback is relative to today.** Seeded payments are dated Sep and Oct 2026. After about mid-January 2027, the Oct 2 match falls outside the 120 days.
- **Still from Step 1:** multi-photo documents and no streaming.

## What Ledger supports

- **Full workflow** (check, explain, propose an action): IRS CP14, IRS 972CG, Alameda County health inspections.
- **Explanation only, no actions:** IRS CP504, city fines, city code violations, late business-license notices.
- **Anything else:** Ledger says it can't help yet. It still warns if the document looks like a scam.

The fixtures are AI-generated examples with SAMPLE watermarks. Production sets `IGNORE_SAMPLE_WATERMARKS=true` so judges can upload them. Before testing a real letter on dev, unset it, and black out SSNs, EINs and account numbers.

## Approve flow (for later steps)

- Approving a payment calls `actions.approve`, then `actions.execute`, then `nessie.payBill`, then `actions.finish`, then `agent.notifyActionResult`, which posts a hidden note and a reply. Reject and mark done also call `notifyActionResult`.
- `owner_task` payload: `{ instructions, phone?, callScript?: { en, translated }, payment?: { date, amount, payee, memo? } }`.
