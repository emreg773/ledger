# Ledger

A multilingual AI agent for immigrant small business owners. Snap a photo of a government letter; Ledger reads it, explains it in your language, and does the follow-up work. Built at Cal Hacks 13.0.

Current status: **Step 3 of 5 is live** at **https://ledger-ten-peach.vercel.app**: Google sign-in, one account per business, a sandbox bank per user, and web push. Reports: [STEP1_REPORT.md](STEP1_REPORT.md), [STEP2_REPORT.md](STEP2_REPORT.md), [STEP3_REPORT.md](STEP3_REPORT.md), [STEP3.5_REPORT.md](STEP3.5_REPORT.md) (notification history, Google Calendar). Step 3 briefs: [docs/ledger-step3-A.md](docs/ledger-step3-A.md) (backend) and [docs/ledger-step3-B.md](docs/ledger-step3-B.md) (frontend and deploy).

## Stack

Next.js 16 (App Router) + Tailwind 4 + shadcn/ui · Convex (DB, storage, scheduler) · Convex Auth (Google) · `@convex-dev/agent` · Vercel AI SDK 7 + Anthropic (`claude-sonnet-5-5`) · Web Push (service worker in `public/sw.js`) · Vercel

## Setup

Requires Node 22+.

```bash
npm install
npx convex dev            # first run: log in, create/select the "ledger" project; keep it running
npx convex env set ANTHROPIC_API_KEY sk-ant-...   # once per deployment
npm run dev               # http://localhost:3000: sign in with Google, then set up your business
```

There's no seeded demo owner any more: each Google account gets its own owner, chat and sandbox bank. "Start over with demo data" in the app menu resets yours. Sign-in and push need env setup on the deployment; see [docs/dev-setup.md](docs/dev-setup.md).

For push notifications locally, set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in `.env.local` (the same public key as the deployment's `VAPID_PUBLIC_KEY`).

## Deploy

Production is deployed with the Vercel CLI from a checkout of the code to ship (the repo is private on another GitHub account, so Vercel's free plan can't deploy it from git):

```bash
npx vercel deploy --prod
```

The build runs `npx convex deploy --cmd 'npm run build'` (see `vercel.json`), so it deploys the Convex functions to production and then the frontend. Merging to `main` does **not** update the site. Vercel env: `CONVEX_DEPLOY_KEY` (prod) and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. The production Convex env is listed in [STEP3_REPORT.md](STEP3_REPORT.md).

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
  owners.ts        owner profile, onboarding, language
  chat.ts          message list + text send for the UI
  events.ts        append-only audit log
  testing.ts       harness helpers (internal)
  shared.ts        constants shared with the frontend (no server imports)
components/app.tsx                                  sign-in → onboarding → chat
components/chat.tsx, app-menu.tsx, *-card.tsx       the chat, header menu and cards
lib/push.ts, components/notifications.tsx, public/sw.js   web push, browser side
scripts/test-fixtures.ts                            fixture pass/fail harness
fixtures/                                           fake sample documents + expected values
```

## Git workflow

- `main` is always demo-able. Production is deployed by hand (see Deploy). Work on a branch (`step2-playbooks`, `fix-upload`), open a PR, merge when it runs.
- Pull often; Convex schema changes affect both of us.
- Never commit keys. `.env.local` is gitignored; secrets go in `npx convex env set`.
