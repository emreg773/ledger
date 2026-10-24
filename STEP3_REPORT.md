# Step 3 report (final): live with Google sign-in, accounts and web push

*Sat Oct 24, 2026. Briefs: [docs/ledger-step3-A.md](docs/ledger-step3-A.md) (Track A, backend) and [docs/ledger-step3-B.md](docs/ledger-step3-B.md) (Track B, frontend and deploy). This report replaces `STEP3_REPORT_A.md`.*

**Status: live at https://ledger-ten-peach.vercel.app.**
- Anyone with a Google account can sign in, set up their business, and get their own chat and sandbox bank.
- Nobody can see anyone else's data, and rate limits cap the Claude bill.

**Verified on production:**
- Google sign-in
- onboarding
- the per-owner Nessie bank

**Not yet run on production:**
- uploading a letter
- approving a payment
- web push
- the second-account isolation check

See [Acceptance](#acceptance).

Track B's work (PR #10, `b/step3-frontend`) is what's deployed, but it isn't merged into `main` yet.

## Roadmap change

The team cut features to ship a live link for the judges:

| Step | What |
|---|---|
| **3 (this report)** | Google sign-in, one owner per account, ownership checks, a sandbox bank per user, rate limits, production deployment, web push |
| 4 | Responses: the agent drafts reply letters, dispute statements and checklists as PDFs, plus deadline reminders by push |
| 5 | Demo polish: landing page, downloadable sample letters, Spanish review, a formality rule, README |

**Cut:** Gmail intake (it needed a seeded Gmail account), WhatsApp and staff tasks, inspection mode end to end, the calendar, and the audit dashboard. The activity feed already shows the audit trail.

## PRs

| PR | Track | Branch | What | State |
|---|---|---|---|---|
| #8 | both | `docs/step3-briefs` | The Step 3 briefs | Merged |
| #9 | A | `a/step3-auth-stubs` | Convex Auth with Google, `access.ts`, every public function scoped to the session owner, owner functions, per-owner bank, push subscriptions, schema | Merged |
| #11 | A | `a/step3-push-limits` | Rate limits and the daily kill switch, upload checks, push sending with every trigger, hourly cleanup of unused uploads | Merged |
| #12, #13 | A | `a/step3-report-fix`, `a/dev-setup-per-member` | Report fix; one Convex dev deployment per team member | Merged |
| #10 | B | `b/step3-frontend` | Sign-in, onboarding, app menu, web push client, PWA, privacy and terms pages, ownership checks in `actions.ts`, Vercel config, these reports | **Open (draft); this is what's live** |

## What was built

### Track A: backend

| Area | Files | Notes |
|---|---|---|
| Sign-in | `convex/auth.ts`, `auth.config.ts`, `http.ts` | Google provider. Routes at `https://<deployment>.convex.site/api/auth/...` |
| Ownership | `convex/access.ts` | `viewerOwner` (null when signed out, for queries), `requireOwner` (throws `not_signed_in` or `not_onboarded`), `requireOwnerOf` (throws `not_found` for missing rows and other owners' rows alike) |
| Public functions | `cases`, `documents`, `events`, `intake`, `chat`, `owners`, `push` | The owner always comes from the session. `chat.listThreadMessages` throws unless the thread is the viewer's. `events.listForOwner` is internal. |
| Owners | `convex/owners.ts` | `me`, `completeOnboarding` (one owner per user; a second call updates the profile), `setLanguage`, `resetMyData`, `deleteMyAccount` |
| Per-owner bank | `convex/nessie.ts` | `seedBankFor`: the same demo history for every owner. Live mode creates a Nessie customer and account per owner. |
| Deletion | `convex/admin.ts` | `deleteOwnerData`, `deleteOwner`, `deleteAuthUser` (sessions, refresh tokens, accounts). `resetDemo` deletes every owner. |
| Limits | `convex/limits.ts`, `convex.config.ts` | 10 uploads and 40 chat messages per owner per hour; 600 agent runs per day across everyone (`LEDGER_DAILY_RUN_LIMIT`). Refusals are `ConvexError({ code: "rate_limited", retryAfterMs })`. |
| Upload checks | `convex/intake.ts` | JPEG, PNG, WebP or PDF only (`unsupported_file`); 10 MB max (`file_too_large`). The stored file's real content type is checked. |
| Unused uploads | `convex/crons.ts` | Hourly. Deletes files older than an hour that no document uses. |
| Push sending | `convex/push.ts`, `convex/pushNode.ts` | Subscriptions upsert by endpoint. Messages in en, es and tr. A 404 or 410 deletes the subscription; other failures log `push_failed` and never throw. |
| Test helpers | `convex/testing.ts` | `snapshot` and `recentMessages` take `email`; `reseedBank` (with `withoutTreasuryPayment`) |

**Push triggers:**

| `kind` | When |
|---|---|
| `action_needed` | A document run finished and proposed at least one action |
| `document_read` | A document run finished with no new proposal |
| `document_failed` | Reading failed, the photo was too unclear, or the agent run crashed |
| `action_done` | After the follow-up reply to an executed or failed action, or a task marked done |
| `test` | `push.sendTest` |

- Replies to typed chat messages never push.
- A push contains only:
  - the friendly document name
  - the amount and the deadline
  - the verdict
  - the account's last 4 digits
- Example: "Ledger leyó su carta del IRS: $520.00, vence el 19 nov".
- The payload is `{ title, body, url: "/?case=<caseId>", tag: "case-<caseId>" }`.

### Track B: frontend and deploy

| Area | Files | Notes |
|---|---|---|
| Sign-in | `app/ConvexClientProvider.tsx`, `components/app.tsx` | Convex Auth's client-only setup (no `proxy.ts`). The page shows sign-in, then onboarding, then the chat. The sign-in screen has a language choice (browser language by default) and the privacy notice. A push link (`/?case=…`) survives signing in. |
| Onboarding | `components/app.tsx` | Name, business name and language as three large buttons. Notes that Ledger knows the IRS and Oakland / Alameda County agencies. |
| App menu | `components/app-menu.tsx` | Language, notifications on/off, test notification, "Start over with demo data", "Delete my account" (type a word to confirm), sign out, privacy and terms |
| Welcome card | `components/chat.tsx` | Shown until the first message: what Ledger does, that the bank is a sandbox, and that the account can be deleted |
| Errors | `lib/errors.ts` | `rate_limited`, `unsupported_file`, `file_too_large` and session errors show as translated messages, never a raw error |
| Sandbox labels | `components/action-card.tsx`, `components/document-card.tsx` | "Sandbox bank" on the payment card, its confirm dialog and the bank-check line |
| Push, browser side | `lib/push.ts`, `components/notifications.tsx`, `public/sw.js` | The prompt appears only after a tap. On iPhone in Safari it shows Add to Home Screen steps instead; when blocked, it shows how to unblock. The subscription is saved again on every load. Tapping a notification opens `/?case=<id>`, scrolls to that letter and highlights it. No offline caching. |
| PWA | `app/manifest.ts`, `public/icons/`, `app/apple-icon.png`, `app/layout.tsx`, `next.config.ts` | Manifest, icons, iPhone home-screen settings, `sw.js` served with no-cache headers |
| Ownership in actions | `convex/actions.ts` | `approve`, `reject` and `markDone` use `requireOwnerOf`. `get` and `listForCase` return `null` / `[]` for other owners' ids. The internal `finish` looks the action up directly: it runs after a payment with no session, so the session check would have failed every approved payment. |
| Legal pages | `app/privacy/page.tsx`, `app/terms/page.tsx`, `components/legal-page.tsx` | English. Required by Google's consent screen. Linked from sign-in, onboarding and the menu. A contact email shows if `NEXT_PUBLIC_CONTACT_EMAIL` is set. |
| Deploy | `vercel.json`, `.vercelignore` | Builds with `npx convex deploy --cmd 'npm run build'`; preview builds are skipped; CLI deploys never upload `.env.local` |
| Translations | `messages/{en,es,tr}.json` | Every new string in three languages, formal "usted" in Spanish |

## Production setup

| | Value |
|---|---|
| Frontend | Vercel, project `ledger` on the `thespiritpilot` account (Hobby): https://ledger-ten-peach.vercel.app |
| Backend | Convex `prod:majestic-wolverine-921` |
| Google OAuth | Client "Ledger" in Google Cloud. Redirect URIs for `fast-fish-37` and `majestic-wolverine-921`. Consent screen **In production**, External, no logo. Home, privacy and terms point to the live site. |

**How deploys work:** with the Vercel CLI, from a checkout of the code to deploy. Run `npx vercel deploy --prod` (it uses `vercel.json`). Git deploys don't work:
- The repo is private on another GitHub account, and Vercel's free plan won't import it or deploy other people's commits; it asks for Pro.
- So merging to `main` does **not** update the site.
- Making the repo public would remove the restriction.

**Production Convex env** (names only): `ANTHROPIC_API_KEY`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `IGNORE_SAMPLE_WATERMARKS` (true), `JWKS`, `JWT_PRIVATE_KEY` (production's own pair, separate from dev), `NESSIE_API_KEY`, `NESSIE_MODE` (live), `SITE_URL` (the Vercel URL), `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`. `VAPID_SUBJECT` is unset; it falls back to `SITE_URL`.

**Vercel env (Production):** `CONVEX_DEPLOY_KEY` (production key, `deployment:deploy` permission only), `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

**Google sign-in gotcha:** an uploaded logo makes Google require branding verification, which needs proof of owning the home page domain and a 24-hour wait. Removing the logo let the app publish without verification. Ledger only asks for name and email, which need none.

## Acceptance

| Check | Result |
|---|---|
| Google sign-in by an account not on a test-user list | **Pass on production.** The sign-in redirect reaches Google with the production callback, and a real account signed in. |
| Onboarding creates exactly one owner | **Pass on production:** one user, one owner, events `owner_onboarded` and `bank_seeded` |
| The new owner gets their own bank | **Pass on production:** a live Nessie account ending 4417 |
| The sign-in, onboarding, menu, welcome card, banner states and delete dialog render at phone width | Pass (local and `/dev` preview); sign-in also on production |
| `/privacy`, `/terms`, `sw.js` and the manifest are public; `/dev` returns 404 | Pass on production |
| Every public function checks ownership or is an auth route | Pass, including `actions.ts` |
| A new owner's CP14 finds the Oct 2 payment in their own bank | Not run on production yet |
| A second account sees none of the first's data | Built and typechecked. Not run with two accounts. |
| The 11th upload in an hour is refused; a 15 MB file and a `.docx` are refused | Built. Not run. |
| A CP14 upload sends one push in the owner's language; approving the 972CG sends `action_done` | Built. Not run: production has no push subscriptions yet. |
| iPhone: install steps in Safari; push after Add to Home Screen | Built. Not run on a device. |
| "Start over" and "Delete my account" | Built, with confirmations. Not run on production. |

## Deviations from the briefs

- **Deploys go through the Vercel CLI, not git** (see Production setup).
- **Track B first called Track A's functions through hand-typed references** (`lib/backend.ts`), so it could build before #9 landed. After #9 merged it switched to the generated `api`, and the file is gone.
- **Track A kept temporary compatibility:** old `ownerId` arguments are accepted and ignored, and `owners.getDemoOwner` aliases `owners.me` (all marked `TODO(step3)`). The UI no longer uses either, so they can be removed once #10 is merged.
- **`owners.userId` is still optional** in the schema. Dev had a Step 2 owner without it. It can become required after a dev reset.
- **Uploads accept JPEG, PNG, WebP and PDF**, not every image type.
- **Refused uploads can't delete their file in the same call,** because a throwing mutation rolls back. The hourly cleanup removes them. For the same reason, refused requests don't log a `rate_limited` event.
- **Over the daily cap, the follow-up reply after an action is skipped.** The card still shows the result.
- **Privacy and terms pages were added**, which the briefs didn't plan. Google's consent screen requires them.

## Known issues

- **PR #10 isn't merged.** Production runs its code; `main` doesn't have it yet. After merging, also remove Track A's `TODO(step3)` compatibility code.
- **Mert's local setup uses Emre's dev deployment.** #13 gives each member their own dev deployment, but Mert's `.env.local` points at `fast-fish-37`, and #10's backend was pushed there during setup. Mert should create his own dev deployment as described in [docs/dev-setup.md](docs/dev-setup.md), and add its Google redirect URI.
- **`docs/dev-setup.md` still has a TODO** for the production deployment name: `majestic-wolverine-921`.
- **A production deploy key was pasted in plain text during setup.** If it wasn't deleted then, delete it in the Convex dashboard (production, Settings, URL & Deploy Key); Vercel uses a newer one.
- **No contact email on the legal pages** until `NEXT_PUBLIC_CONTACT_EMAIL` is set on Vercel.
- **Owners seeded with live Nessie keep live account ids** if production switches to mock. They need "Start over with demo data".
- **Spanish and Turkish need a native speaker's review**, including the new Step 3 strings.

## Next

1. On production, from a phone:
   - upload the CP14 and the 972CG
   - approve the payment
   - turn on notifications and check the pushes, on iPhone after Add to Home Screen
   - sign in with a second Google account and check it sees nothing
2. Merge #10, then remove the `TODO(step3)` compatibility code.
3. Step 4: responses (`generate_document`) and deadline reminders. For reminder pushes, add a `kind` to `pushKind` and `message()` in `convex/push.ts`.
