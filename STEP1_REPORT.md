# Step 1 report

*Sat Oct 24, 2026. Brief: [docs/ledger-step1.md](docs/ledger-step1.md).*

**Status:** merged into `main` via PR #1 (`fix-extraction`). At review, typecheck and lint were re-run and passed. The fixture and acceptance results below come from Mert's runs on a local anonymous Convex backend. They haven't been re-run since the merge, and no cloud project exists yet.

Step 1 works end to end. A photo or PDF goes in through one intake function. Ledger reads it, opens a case, logs every step, and replies in the owner's language. All 10 fixtures pass (41/41 checks), and every acceptance check in Section 11 passed, both from the CLI and through the UI at phone width.

## What was built

| Area | Files | Key functions |
|---|---|---|
| Schema: all 8 tables + indexes | `convex/schema.ts` | |
| Demo owner + agent thread | `convex/owners.ts` | `seedDemoOwner`, `getDemoOwner`, `setLanguage` |
| Intake (one entry point for every channel) | `convex/intake.ts` | `ingestDocument` (internal), `ingestWebUpload` (thin public wrapper), shared `ingest()` |
| Ledger agent + `read_document` tool | `convex/agent.ts` | `ledgerAgent`, `respond`, `recordFailure`, `buildInstructions` |
| Extraction (zod schema, prompt, masking) | `convex/extraction.ts` | `extractFromStorage`, `runExtraction`, `maskSensitive` |
| Documents and cases | `convex/documents.ts` | `markExtracting`, `saveExtraction` (opens the case), `markFailed`, `generateUploadUrl` |
| Audit events | `convex/events.ts` | `logEvent`, `listForOwner` |
| Model config + demo flag | `convex/models.ts` | `MODEL_ID`, `IGNORE_SAMPLE_WATERMARKS` |
| Chat UI | `components/chat.tsx`, `components/document-card.tsx` | language picker, live messages, upload with compression, "What Ledger read" card |
| Test helpers | `convex/testing.ts`, `scripts/test-fixtures.ts` | `extractStorageId`, `recentMessages` |

## Package versions

| Package | Version |
|---|---|
| next / eslint-config-next | 16.4.3 |
| react / react-dom | 19.3.0 |
| convex | 1.48.0 |
| @convex-dev/agent | 0.7.8 |
| ai | 7.0.28 (pinned, see deviations) |
| @ai-sdk/anthropic | 4.0.15 (pinned) |
| @ai-sdk/provider / provider-utils | 4.0.3 / 5.0.10 |
| zod | 4.6.7 |
| typescript | 6.0.3 |
| tailwindcss / @tailwindcss/turbopack | 4.3.3 |
| shadcn / @base-ui/react | 4.22.1 / 1.9.0 |
| browser-image-compression | 2.0.2 |
| react-markdown | 10.1.0 |
| tsx | 4.23.15 |
| Model | `claude-sonnet-5-5` (chat and extraction) |

## Fixture results

`npm run test:fixtures`. Expected values come from `fixtures/README.md`. Every file also gets a "no full EIN anywhere in the output" check.

| File | Result | Got |
|---|---|---|
| photos/cp14_photo.jpg | PASS 6/6 | IRS_CP14, $1,240.18, due 2026-11-02, confidence 0.88 |
| pdf/cp14.pdf | PASS 6/6 | IRS_CP14, $1,240.18, due 2026-11-02, confidence 0.93 |
| pdf/972cg.pdf | PASS 6/6 | IRS_972CG, $520, due 2026-11-19, EIN masked to 6789 |
| photos/972cg_photo_page1.jpg | PASS 2/2 | IRS_972CG, $520, due 2026-11-19 |
| photos/972cg_photo_page2.jpg | PASS 1/1 | See known issues: type varies between runs |
| photos/inspection_yellow_photo.jpg | PASS 7/7 | Yellow, score 77, 3 major / 7 minor, reinspection 2026-10-28 |
| pdf/inspection_yellow.pdf | PASS 7/7 | Same as the photo |
| photos/scam_irs_photo.jpg | PASS 2/2 | UNKNOWN; the agent warns it's a likely scam and says not to pay |
| photos/menu_photo.jpg | PASS 2/2 | UNKNOWN |
| photos/cp14_blurry_photo.jpg | PASS 2/2 | Confidence 0.05, so the agent asks for a clearer photo |

## Acceptance checks (brief Section 11)

| Check | Result |
|---|---|
| `cp14_photo.jpg`: Spanish summary with $1,240.18 and Nov 2 | Pass ("Monto a pagar: $1,240.18. Fecha límite: 2 de noviembre de 2026.") |
| `menu_photo.jpg`: honest "I can't help with this" | Pass |
| `cp14_blurry_photo.jpg`: asks for a clearer photo | Pass |
| Switch to English: next reply is in English | Pass (CLI, and the UI picker plus a typed question) |
| Events list reads clearly | Pass (`document_received`, `tool_called`, `document_extracted`, `case_opened`, `agent_failed`, `language_changed`) |
| UI at phone width (375px) | Pass: upload, the collapsible card, the language switch, no horizontal scroll |

## Bugs found and fixed during testing

1. **"Schema is too complex"** (`convex/extraction.ts`). Every extraction failed because optional fields inside the optional `inspection` object pushed the structured-output schema past the API's limit. The model now gets nullable fields there, and `toStoredExtraction()` drops the nulls, so storage keeps the brief's shape.
2. **Every reply after the first failed** (`convex/agent.ts`). `claude-sonnet-5-5` thinks before it answers, and the API returns that reasoning as signed blocks. The Agent component saves them and sends them back with the history on the next turn. The API rejected the replayed blocks ("bound to a different conversation"). Most likely cause: the history we send isn't byte-identical to what the model saw when it wrote them. The Agent sends a window of recent messages, and the instructions change when the owner switches language. The root cause wasn't confirmed.

   Fix: a `contextHandler` removes reasoning parts from **earlier turns** only.
   - **Kept:** every user message, every final reply, and every tool call and tool result, including the full extraction JSON. That's where all facts come from (Section 6: "only state facts from the extracted document data").
   - **Kept:** reasoning inside the **current** turn's tool loop. The API requires it when thinking and tool use are combined.
   - **Lost:** the model's scratch notes from earlier turns. The cost is small: in a later turn the model can't see *how* it reached an earlier answer, only the answer itself. There may also be less prompt-cache reuse.
   - **Alternatives if this ever matters:** find the real mismatch and stop modifying history, or turn thinking off for chat replies. Replies are short summaries of data already extracted, so they may not need thinking, and they'd come back faster. Neither has been tested.
3. **Font fell back to Times** (`app/globals.css`). `--font-sans` pointed at itself. It now points at Geist.

## Deviations from the brief

- **AI SDK pinned:** `ai@7.0.28`, `@ai-sdk/anthropic@4.0.15`. With `ai@7.0.152`, `new Agent(...)` fails typechecking (TS2590). These are the versions `@convex-dev/agent@0.7.8` is tested against. Don't `npm update` them without re-running `npm run typecheck`.
- **Extraction uses `generateText` with `Output.object`**, since `generateObject` is deprecated in AI SDK 7. Images and PDFs are both sent as `file` parts.
- **`fieldConfidence`**: the model returns a `{field, confidence}` list, and we store the `Record<string, number>` the brief specifies.
- **Nullable inspection fields** in the model schema (see bug 1). The stored shape is unchanged.
- **No case is opened** for `UNKNOWN` documents or for confidence below 0.6, so a blurry photo and its retake don't open two cases.
- **A document's arrival is a user message** in the thread with the marker `[document:<id>]`, which the UI renders as a document card.
- **Demo mode: `IGNORE_SAMPLE_WATERMARKS = true`** in `convex/models.ts`. Every fixture is watermarked SAMPLE, and without this flag the agent told the owner "this looks like a sample, don't pay" on every reply. The flag adds a rule to both prompts to treat those marks as absent. Scam detection is unchanged (verified with `scam_irs_photo.jpg`). **Set it to `false` before real documents go through.**

## Known issues and open questions

- **Multi-photo documents.** A `documents` row holds one file, so the two 972CG photos are read separately. Page 2 alone (the response page) was classified as IRS_972CG in one run and UNKNOWN in another. Multi-page PDFs work fine. Options: an optional `extraStorageIds` field, or merging photos into a PDF on upload.
- **The card shows raw type codes** ("IRS_972CG", "UNKNOWN"). `CASE_TITLES` in `convex/documents.ts` already has friendly names that the card could use.
- **UI labels are English only.** The agent replies in the owner's language, but buttons and card labels don't change.
- **No streaming.** Replies arrive whole after the "Ledger is working..." indicator. Upgrade path: `streamText` with `saveStreamDeltas`.
- **Replies take 10–20 seconds**, mostly extraction with Sonnet on a full-page image.
- **Old messages leak into replies.** Before the demo, start from a fresh thread: delete the owner and re-run `npm run seed`, or add a reset helper. Otherwise the test history makes the agent mention earlier messages (for example "es otra copia del aviso que ya vimos").
- **`read_document` doesn't check document ownership.** This is fine with one demo owner; fix it when auth arrives.
- **Re-reading a document opens a second case.**
- **All functions are public with no auth**, per the brief. Don't put real data in.
- **The local Convex backend is anonymous** (`anonymous:anonymous-ledger`). To share it with Emre, run `npx convex login` and link a cloud project.
- **Anthropic keys:** Console keys now start with `sk-ant-usr-` and work as normal `x-api-key` keys. A key that isn't copied in full at creation fails with "invalid x-api-key".
- **Laptop sleep breaks long runs.** API calls made while the Mac sleeps hang for many minutes, then fail with "connection reset". Keep the machine awake during `test:fixtures`.

## How to run

```bash
npm install                 # Node 22+
npx convex dev              # leave running
npx convex env set ANTHROPIC_API_KEY sk-ant-...
npm run seed                # María López / Taquería La Esquina + agent thread
npm run dev                 # http://localhost:3000
```

Tests and checks:

```bash
npm run test:fixtures             # all fixtures; results in test-results/fixtures.json
npm run test:fixtures -- cp14     # one fixture (substring match)
npx convex run testing:recentMessages '{"count": 4}'
npx convex run events:listForOwner '{"ownerId": "<id from npm run seed>"}'
npm run typecheck
```
