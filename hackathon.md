# Hackathon log

- **Project:** Ledger
- **Event:** Cal Hacks 13.0
- **What it does:** A multilingual AI agent that reads government letters sent to small business owners, explains them in the owner's language and proposes follow-up actions the owner approves.
- **Live app:** https://ledger-ten-peach.vercel.app
- **Repo:** https://github.com/emreg773/ledger
- **Frontend:** Vercel
- **Convex deployment:** https://majestic-wolverine-921.convex.cloud
- **Components:** @convex-dev/agent
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, crons, scheduled functions, file storage, full text search, realtime useQuery, paginated queries
- **Auth:** Convex Auth
- **AI models:** claude-sonnet-5-5
- **Started:** 2026-10-24T05:54:05Z
- **Last updated:** 2026-10-25T14:54:41Z

## How we use Convex

- **Chat with the Ledger agent:** threads and messages live in the `@convex-dev/agent` component; the chat streams in live through a paginated query (`convex/convex.config.ts`, `convex/chat.ts`, `components/chat.tsx`).
- **Letter upload and reading:** photos and PDFs go to Convex file storage, and intake schedules the agent run so the upload returns at once (`convex/intake.ts`, `convex/extraction.ts`).
- **Action cards, cases and home tasks:** 41 indexes over the app tables in `convex/schema.ts`; owners approve actions through mutations in `convex/actions.ts`.
- **Notification center search:** a full text search index on notifications (`convex/schema.ts`, `convex/notifications.ts`).
- **Telegram bot and Google Calendar:** HTTP actions for the webhook and OAuth callback (`convex/http.ts`), plus hourly crons for calendar sync, Telegram nudges and upload cleanup (`convex/crons.ts`).
- **Live screens:** chat, home tasks, deadline calendar, case history and the notification center all use `useQuery` and update without a refresh.

## Log

- 2026-10-24 `ded1df4` Scaffold Next.js, Tailwind, shadcn/ui (`app/`, `fixtures/`)
- 2026-10-24 `ffacc8e` Convex schema, intake, agent, chat UI (`convex/schema.ts`, `convex/extraction.ts`, `components/chat.tsx`)
- 2026-10-24 `e5ba5e7` Fix "Schema is too complex" in extraction (`convex/extraction.ts`)
- 2026-10-24 `17728c8` Step 2 schema, Nessie stubs, reset helper (`convex/schema.ts`, `convex/nessie.ts`)
- 2026-10-24 `059fcee` Action system (`convex/actions.ts`)
- 2026-10-24 `b0fd24d` Action cards and live activity (`components/action-card.tsx`)
- 2026-10-24 `2fd2978` Playbooks, sender check, bank check (`convex/agent.ts`, `convex/senderCheck.ts`)
- 2026-10-24 `7584fba` Auth and ownership checks (`convex/owners.ts`, `convex/push.ts`)
- 2026-10-24 `cc9b0a4` Sign-in, onboarding, web push client, PWA (`components/app.tsx`)
- 2026-10-24 `2a84d11` Upload checks and push sending (`convex/pushNode.ts`)
- 2026-10-24 `e07b06a` Notification center and home screen (`components/notification-center.tsx`)
- 2026-10-25 `880da5e` Google Calendar sync (`convex/googleCalendar.ts`)
- 2026-10-25 `a459124` Case memory (`convex/cases.ts`, `components/case-history.tsx`)
- 2026-10-25 `c4d1cdc` Deadline reminders and demo clock (`convex/deadlines.ts`)
- 2026-10-25 `45b5ef5` Chinese, Vietnamese, Korean (`messages/`)
- 2026-10-25 `777fad0` Telegram bot (`convex/telegram.ts`)
- 2026-10-25 `36ce1dd` Staged attachments with a note (`convex/intake.ts`)
- 2026-10-25 `9fba27e` Remove Gmail integration (`convex/gmail.ts`)
- 2026-10-25 `c7c1374` Landing page (`components/landing.tsx`)
- 2026-10-25 `aa71f56` Conversations, Telegram nudges, multi-page letters (`convex/nudges.ts`)
- 2026-10-25 `27659ff` Telegram multiple attachments (`convex/telegram.ts`)
- 2026-10-25 `e83b420` UI bug fixes (`convex/agent.ts`, `convex/actions.ts`)
- 2026-10-25 `e328df2` Nudge fixes (`convex/nudges.ts`)
- 2026-10-25 `56a4c8c` Date fixes (`convex/clock.ts`, `convex/events.ts`)
- 2026-10-25 `3044364` Remove rate limits (`convex/limits.ts`)
