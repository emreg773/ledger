# Ledger

A multilingual AI agent for immigrant small business owners. Snap a photo of a government letter; Ledger reads it, explains it in your language, and does the follow-up work. Built at Cal Hacks 13.0.

Current status: **Step 1 of 8** (document intake, `read_document`, web chat). See [HANDOFF.md](HANDOFF.md) for where we left off and [docs/ledger-step1.md](docs/ledger-step1.md) for the brief.

## Stack

Next.js 16 (App Router) + Tailwind 4 + shadcn/ui · Convex (DB, storage, scheduler) · `@convex-dev/agent` · Vercel AI SDK 7 + Anthropic (`claude-sonnet-5-5`)

## Setup

Requires Node 22+.

```bash
npm install
npx convex dev            # first run: log in, create/select the "ledger" project; keep it running
npx convex env set ANTHROPIC_API_KEY sk-ant-...   # once per deployment
npm run seed              # creates the demo owner (María López, Taquería La Esquina)
npm run dev               # http://localhost:3000
```

Each teammate gets their own Convex **dev** deployment inside the shared project, so data and API keys don't collide. Set the API key on yours.

## Testing

```bash
npm run test:fixtures             # all fixtures (needs `npx convex dev` running)
npm run test:fixtures -- cp14     # only files matching "cp14"
npx convex run testing:extractStorageId '{"storageId":"...","mimeType":"image/jpeg"}'
npx convex run testing:recentMessages     # latest agent replies
```

Intake without the UI (how Gmail/WhatsApp will call it):

```bash
npx convex run intake:ingestDocument '{"ownerId":"...","storageId":"...","mimeType":"image/jpeg","source":"web_upload"}'
```

## Layout

```
convex/
  schema.ts        all tables for Steps 1-8
  intake.ts        ingestDocument: the one entry point for every channel
  agent.ts         Ledger agent, instructions, read_document tool, respond action
  extraction.ts    zod extraction schema, prompt, masking, model call
  documents.ts     document rows, extraction save, case creation
  owners.ts        demo owner seed, language
  chat.ts          message list + text send for the UI
  events.ts        append-only audit log
  testing.ts       harness helpers (internal)
  shared.ts        constants shared with the frontend (no server imports)
components/chat.tsx, components/document-card.tsx   the one-page UI
scripts/test-fixtures.ts                            fixture pass/fail harness
fixtures/                                           fake sample documents + expected values
```

## Git workflow

- `main` is always demo-able. Work on a branch (`step2-playbooks`, `fix-upload`), open a PR, merge when it runs.
- Pull often; Convex schema changes affect both of us.
- Never commit keys. `.env.local` is gitignored; secrets go in `npx convex env set`.
