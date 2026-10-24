# Handoff: where we left off

*Last updated: Fri Oct 23, 2026, ~11 PM. Deadline: Sun Oct 25, 9:00 AM PT.*

## TL;DR

Step 1 (of 8) is **written, typechecks, builds, and works up to the model call**. It has **never run against Claude** because there's no Convex cloud project or Anthropic key yet. Your first job: set those up (10 min), then run the fixture tests and fix what fails.

The brief is in [docs/ledger-step1.md](docs/ledger-step1.md). Read Sections 2, 8, 9, and 11 if nothing else.

## Your first 10 minutes

```bash
git clone https://github.com/emreg773/ledger.git && cd ledger
npm install                         # Node 22+ required
npx convex dev                      # log in, CREATE a new project called "ledger". Leave it running.
```

In a second terminal:

```bash
npx convex env set ANTHROPIC_API_KEY sk-ant-...
npm run seed                        # creates María López / Taquería La Esquina + agent thread
npm run dev                         # http://localhost:3000
```

Then invite Emre to the Convex project (dashboard → project settings → members) so they can run their own dev deployment in it.

## What's done

| Area | State | Where |
|---|---|---|
| Scaffold (Next 16, Tailwind 4, shadcn/ui on Base UI) | Done | `app/`, `components/ui/` |
| Full schema, all 8 tables + indexes | Done | `convex/schema.ts` |
| Demo owner seed + agent thread | Done, tested locally | `convex/owners.ts` (`seedDemoOwner`) |
| `ingestDocument`: one entry point for every channel | Done, tested via `npx convex run` | `convex/intake.ts` |
| Ledger agent + Section 6 prompt + `read_document` tool | Written, **not run against Claude** | `convex/agent.ts` |
| Extraction: zod schema, prompt, model call | Written, **not run against Claude** | `convex/extraction.ts` |
| SSN/EIN/account masking (prompt + regex pass before saving) | Written | `maskSensitive()` in `convex/extraction.ts` |
| Audit events (received, tool_called, extracted, case_opened, agent_failed, language_changed) | Done | `convex/events.ts` |
| Chat UI: language picker, live messages, upload w/ compression, "What Ledger read" card, working indicator | Builds; **not clicked through in a browser** | `components/chat.tsx`, `components/document-card.tsx` |
| Fixture harness | Done; upload + call path tested | `scripts/test-fixtures.ts` |
| Failure handling (agent error → doc marked failed, event, message in chat) | Tested locally | `respond` / `recordFailure` in `convex/agent.ts` |
| `STEP1_REPORT.md` | **Not written** (needs real test results) | — |

## Your next steps (in order)

1. **Setup** (above).
2. **Run the fixtures:** `npm run test:fixtures` (or `-- cp14` for one). Results print as PASS/FAIL; full JSON goes to `test-results/fixtures.json`. Expected values come from `fixtures/README.md`.
3. **Check the acceptance criteria that need the agent** (brief Section 11). Upload through the UI, or ingest from the CLI, then read replies with `npx convex run testing:recentMessages`:
   - `cp14_photo.jpg` → Spanish summary with $1,240.18 and Nov 2
   - `menu_photo.jpg` → honest "I can't help with this"
   - `cp14_blurry_photo.jpg` → asks for a clearer photo
   - switch language to English → next reply in English
   - `npx convex run events:listForOwner '{"ownerId":"..."}'` → readable rows
4. **Fix failures.** Most likely to need tuning: the extraction prompt (`EXTRACTION_PROMPT`) and `STEP1_RULES` in `convex/agent.ts`.
5. **Click through the UI on a phone-width window.** Upload, collapsible card, language switch.
6. **Write `STEP1_REPORT.md`** (brief Section 12). Most of the content is in this file; add the test results.
7. **Step 2:** see roadmap in the brief.

## Decisions and deviations from the brief (keep these in mind)

- **AI SDK pinned to older versions:** `ai@7.0.28`, `@ai-sdk/anthropic@4.0.15`. With the latest `ai@7.0.152`, `new Agent(...)` fails typechecking (TS2590: "union type too complex"). These are the exact versions `@convex-dev/agent@0.7.8` is tested against. The older provider does know `claude-sonnet-5-5`. **Don't `npm update` these** without re-running `npm run typecheck`.
- **TypeScript 6.0.3**, matching the agent package.
- **Extraction uses `generateText` + `Output.object`**, because `generateObject` is deprecated in AI SDK 7. Images and PDFs are both sent as `file` parts (`image` parts are deprecated).
- **`fieldConfidence`**: the model returns a list of `{field, confidence}`; we store the `Record<string, number>` the brief specifies.
- **No case is opened** for `UNKNOWN` documents or extractions with confidence below 0.6. Otherwise a blurry photo and its retake would open two cases.
- **Document arrival = a user message in the thread** with the marker `[document:<id>]`. The UI replaces that message with a document card. Gmail and WhatsApp will get this for free through `ingestDocument`.
- **Public vs internal:** `ingestDocument` is internal (for Gmail/WhatsApp/CLI). The web UI calls `ingestWebUpload`, a thin public wrapper around the same `ingest()` function. No intake logic lives in React.
- **`convex/shared.ts`** is imported by the frontend. Keep server imports out of it.
- **`cn`** imported from `"cn"` in `components/ui/*` is correct: it's shadcn 4's own package, not a typo.

## Known gaps / open questions

- **Multi-photo documents:** a `documents` row holds one file. The 972CG photos come as 2 separate JPEGs; multi-page *PDFs* work fine. Options for later: an optional `extraStorageIds` field, or merging photos into a PDF on upload.
- **UI labels are English only.** The agent replies in the owner's language; the buttons and card labels don't.
- **No streaming.** Replies arrive whole, with a "Ledger is working..." indicator. Easy upgrade: `streamText` with `saveStreamDeltas` (the message query already supports streams).
- **`read_document` doesn't check that the document belongs to the owner.** That's fine with one demo owner; fix when auth arrives.
- **Re-reading a document** creates a second case. Fine for now.
- **All functions are public with no auth** (per the brief). Don't put real data in.

## Git

- Repo: private, `emreg773/ledger`. Branch `main`.
- Work on branches (`step2-playbooks`, `fix-extraction`) and merge via PR; keep `main` demo-able.
- `.env.local` is gitignored; `npx convex dev` creates it. Secrets go in `npx convex env set`, never in git.
- `.gitattributes` forces LF line endings (Emre is on Windows).
- `convex/_generated/` **is** committed (Convex recommends it). It regenerates when `npx convex dev` runs.
