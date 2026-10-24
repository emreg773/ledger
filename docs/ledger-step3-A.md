# Ledger: Step 3 Brief, Track A (backend: accounts, security, push)

You are continuing **Ledger**, a hackathon project (Cal Hacks 13.0, deadline **Sunday Oct 25, 2026, 9:00 AM PT**). Steps 1 and 2 are merged on `main`. Before writing code, read these files in the repo:
- `docs/ledger-step1.md`, Sections 1 to 3: what Ledger is and the agent principle.
- `STEP2_REPORT.md`: what exists now, especially "Current status" and "What's needed for production".
- `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`: the web push pattern this step follows. It uses `web-push` and VAPID keys.

Two developers work in parallel. **You are Track A (backend).** Track B is building sign-in, onboarding, the service worker and the Vercel deploy from a sibling brief. Stick to the files you own (Section 10) and the contract (Section 8).

---

## 0. Changes since Step 2 (decided by the team)

**The goal changed: ship a live link judges can sign into and use.** We cut features to get there.

| Step | Track A | Track B |
|---|---|---|
| **3 (this file)** | Google sign-in on Convex, one owner per account, ownership checks everywhere, a Nessie bank per user, rate limits, the production deployment, sending web pushes | Sign-in and onboarding screens, the app shell, the service worker, the PWA manifest, the push opt-in, Vercel |
| 4 | Responses: the agent drafts reply letters, dispute statements and checklists as PDFs (`generate_document`), plus deadline reminders by push | Generated-document cards and preview, the reminder UI |
| 5 | Demo hardening, Spanish review, a formality rule | Landing page, downloadable sample letters, README, phone check |

**Cut:** Gmail intake (it needs a seeded Gmail account), WhatsApp and staff tasks, inspection mode end to end, the calendar, and the audit dashboard (the activity feed already shows the audit trail).

## 1. Goal of Step 3

Anyone with a Google account can open the live link, sign in, set up their business, and get the full Step 2 experience **on their own data**. Nobody can see anyone else's data, and nobody can run up the Claude bill. When Ledger finishes reading a letter or an action completes, the owner gets a push notification.

**Demo moment this step must produce:**
1. A judge opens the Vercel URL on their phone and taps "Continue with Google".
2. They enter their name and business and pick Spanish. Their sandbox bank is created automatically.
3. They upload the CP14 sample and lock their phone.
4. A push arrives: *"Ledger leyó su carta del IRS: ya está pagada"* (Ledger read your IRS letter: it's already paid). Tapping it opens that case in the app.

## 2. Pre-step tasks (do these first, about 30 minutes)

1. **Install** `@convex-dev/auth`, `@auth/core` (the version its peer dependency asks for), `web-push` and `@convex-dev/rate-limiter`. Pin exact versions as the other packages are. Don't `npm update` anything else; the AI SDK packages are pinned for a reason.
2. **Schema changes and contract stubs** (Sections 8 and 9). Push them together with stubs for every Track A contract function, so Track B can build against them. Open this as a small PR and merge it before anything else, as in Step 2.
3. **Google OAuth client** (Section 3). Share the dev client ID with Track B only if they need it; the secret stays in the Convex env.
4. **Tell Track B when the stubs are merged.** The UI's arguments change (Section 8), so B can't finish until then.

## 3. Sign-in: Convex Auth with Google

Follow the Convex Auth docs (labs.convex.dev/auth) for the **React (client-only)** setup, not the Next.js server-side setup. Ledger's whole UI is a client component, and the client-only setup needs no `proxy.ts`. (Next 16 renamed `middleware.ts` to `proxy.ts`, and the Convex Auth Next.js helpers may still assume the old name, so avoid that path.)

- `convex/auth.ts`: `convexAuth({ providers: [Google] })`. Export `auth`, `signIn`, `signOut`, `store`, `isAuthenticated`.
- `convex/http.ts`: `auth.addHttpRoutes(http)`.
- `convex/auth.config.ts`: as the docs say.
- Run `npx @convex-dev/auth` once per deployment. It sets `JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL`.
- **Google Cloud console:**
  - Create an OAuth client of type "Web application".
  - Add one authorized redirect URI per Convex deployment: `https://<deployment>.convex.site/api/auth/callback/google`. Dev is `fast-fish-37`; production comes from Section 6.
  - Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` on each deployment.
  - **Publish the consent screen ("In production").** In "Testing" mode, only listed test users can sign in, and judges would be locked out. The basic scopes (openid, email, profile) don't need Google's verification.
- `SITE_URL`: `http://localhost:3000` on dev, and the Vercel URL on production.

## 4. One owner per account, and ownership checks

**`convex/access.ts`** (new):
```ts
export async function requireOwner(ctx: QueryCtx | MutationCtx): Promise<Doc<"owners">>
// signed out → throws "Not signed in"; signed in but no owner yet → throws "Not onboarded"
export async function requireOwnerOf<T extends { ownerId: Id<"owners"> }>(
  ctx: QueryCtx | MutationCtx, row: T | null,
): Promise<T>   // throws "Not found" when the row is missing or belongs to someone else
```
Use `getAuthUserId(ctx)` and the `owners.by_userId` index. Return "Not found" for someone else's row, never "Forbidden", so ids can't be probed.

**Every public function derives the owner from the session.** Remove the `ownerId` argument from all of them:
- `cases.get`, `cases.listForOwner`
- `documents.generateUploadUrl`, `documents.listForOwner`
- `events.listRecentForOwner`
- `events.listForOwner`: make it internal; it's a debug helper
- `intake.ingestWebUpload`
- `chat.sendMessage`
- `chat.listThreadMessages`: keep the `threadId` argument (`useUIMessages` needs it), but throw unless it equals the viewer's `owner.agentThreadId`. This resolves the existing `TODO(auth)`.
- `owners.setLanguage`
- `owners.getDemoOwner`: delete it. `owners.me` replaces it.

Queries the UI calls while a user is signed out or not yet onboarded should return `null` or `[]`, not throw. Only mutations throw.

`convex/actions.ts` is Track B's. B adds the same checks there using your `requireOwnerOf`. Merge `access.ts` in the stubs PR so B can use it right away.

**Internal functions stay as they are.** They're unreachable from the client. Keep `ownerId` arguments on `ingestDocument`, `agent.respond`, the tools and `nessie.*`.

**Check after the change:** run `grep -n "= query\|= mutation\|= action" convex/*.ts` and confirm every public function either calls `requireOwner` / `requireOwnerOf` or is deliberately public (the auth routes).

## 5. Onboarding, per-user bank, and demo data

**`owners.completeOnboarding({ name, businessName, preferredLanguage, city? })`** (mutation):
- It requires a signed-in user with no owner yet. If one exists, it updates the profile instead of creating a second owner.
- It creates the owner with `userId` and `email` from the auth user. `city` defaults to "Oakland", county to "Alameda" and state to "CA". The playbooks and contacts only cover Alameda, so Track B's form says so.
- It creates the agent thread, as `insertDemoOwner` does today.
- It seeds that owner's bank: `seedLiveBank` scheduled when `NESSIE_MODE=live`, `seedMockBank` otherwise. Each owner gets their own Nessie customer and account, with the same seed data as María (balance $4,800, the Oct 2 Treasury payment of $1,240.18, the supplier payments, no $520 payment). Without this, the bank check only works for María.
- It logs `owner_created`.
- Validate the inputs: trimmed, non-empty, at most 80 characters, and a language from `LANGUAGES` in `convex/shared.ts`.

**`owners.resetMyData()`** (mutation): the per-user version of `admin.resetDemo`. It deletes the caller's thread messages, documents and storage files, generated documents, cases, actions, tasks and events, then reseeds their bank. It keeps the owner row, the profile and the push subscriptions. Track B shows it as "Start over with demo data". Factor the deletion loop out of `admin.resetDemo` into a helper that both use.

**`owners.deleteMyAccount()`** (mutation): the same deletion plus the push subscriptions, the owner row and the auth user, with its sessions and accounts. Real people may upload real letters, so they need a way out.

**`admin.resetDemo`:** keep it internal, for dev. It no longer creates María. `owners.seedDemoOwner` and `insertDemoOwner` go away; the `seed` and `reset` scripts in `package.json` are Track B's to update (Section 10).

**The SAMPLE watermark rule** stays env-driven. Set `IGNORE_SAMPLE_WATERMARKS=true` on production, since judges will upload our samples.

## 6. Abuse limits and the production deployment

**Rate limits** with `@convex-dev/rate-limiter`, registered in `convex/convex.config.ts`:
- Uploads (`ingestWebUpload`): 10 per owner per hour
- Chat messages (`sendMessage`): 40 per owner per hour
- A **global** cap on agent runs: 600 per day across all owners, overridable with the `LEDGER_DAILY_RUN_LIMIT` env var. It's the kill switch for the Claude bill.
- Over a limit, the mutation throws a `ConvexError` with `{ code: "rate_limited", retryAfterMs }`. Track B shows it as a friendly translated message. Don't schedule the agent run.
- Also set a monthly spend limit on the Anthropic key in the Anthropic console. That's one minute of work, and the rate limits are no substitute for it.

**Upload checks** in `ingestWebUpload`: accept only `image/*` and `application/pdf`, and reject files over 10 MB. Use `ctx.db.system.get(storageId)` for the size, and delete rejected files from storage.

**Production deployment:**
- Production is the project's **prod** deployment. Get a deploy key (dashboard → Settings → Deploy keys) and give it to Track B for Vercel. Vercel's build runs `npx convex deploy`, so **every merge to `main` deploys the backend to production.** Keep `main` working.
- Set the prod env with `npx convex env set --prod` (or in the dashboard): `ANTHROPIC_API_KEY`, `NESSIE_MODE`, `NESSIE_API_KEY`, `IGNORE_SAMPLE_WATERMARKS=true`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `SITE_URL` (the Vercel URL, from Track B), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Then run `npx @convex-dev/auth --prod`.
- **Nessie on prod:** use `live`. If Nessie misbehaves during judging, run `npx convex env set --prod NESSIE_MODE mock`. Owners seeded in live mode then need "Start over with demo data" to get a mock bank, so say so in the report.
- Update `docs/dev-setup.md` with the prod deployment name, the env list, and how to add a redirect URI.

## 7. Web push (sending)

**Keys:** generate a VAPID key pair once with `npx web-push generate-vapid-keys`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` address for the team) on both deployments. Give the public key to Track B for `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Use the same pair on dev and prod, so subscriptions keep working when testing.

**`convex/push.ts`** (queries and mutations) and **`convex/pushNode.ts`** (`"use node"`, because `web-push` needs Node):
- `push.saveSubscription({ endpoint, keys: { p256dh, auth }, userAgent? })`: upserts by `endpoint` for the caller's owner. If the endpoint belongs to another owner (a shared browser), move it to this one.
- `push.removeSubscription({ endpoint })`
- `push.mySubscriptionCount()`: Track B shows "Notifications on" from it.
- `push.sendTest()`: sends "Notifications are on" to the caller's devices.
- `push.notifyOwner({ ownerId, kind, caseId?, actionId? })` (internal mutation): builds the message and schedules `pushNode.send`.
- `pushNode.send` (internal action): calls `webpush.sendNotification` for each of the owner's subscriptions. **Delete a subscription when the push service answers 404 or 410.** Log other failures as `push_failed` events, and never throw back into the agent.

**Payload** (Track B's service worker reads it):
```json
{ "title": "Ledger", "body": "…", "url": "/?case=<caseId>", "tag": "case-<caseId>" }
```
`tag` makes a newer notification for the same case replace the older one.

**When to send** (you own every trigger; Track B never calls `notifyOwner`):

| `kind` | Sent from | When |
|---|---|---|
| `document_read` | end of `agent.respond` | the run had a `documentId`, finished without error, and proposed no actions |
| `action_needed` | end of `agent.respond` | the run had a `documentId` and proposed at least one action |
| `action_done` | after the follow-up reply that `notifyActionResult` schedules | an action was executed, failed, or was marked done |
| `document_failed` | `agent.recordFailure` | reading failed |

Don't push for replies to typed chat messages; the owner is already looking at the app.

**Text:** short templates in `convex/push.ts` for `en`, `es` and `tr`, in the owner's `preferredLanguage`. Fill in facts from the case: the friendly document name, the amount and deadline when present, and the verdict ("parece una estafa" when `suspicious`). Never put SSNs, EINs, account numbers or the letter's text in a push. They go through Google's and Apple's servers and show on lock screens. Amounts and the last 4 digits of the account are fine.

Log `push_sent` with a readable summary ("Push sent to 2 devices: IRS letter already paid").

## 8. Contract for Step 3 (shared with Track B)

**Track A implements** (all public; the owner always comes from the session):

| Function | Type | Args | Returns |
|---|---|---|---|
| `owners.me` | query | `{}` | the owner, or `null` when signed out or not onboarded |
| `owners.completeOnboarding` | mutation | `{ name, businessName, preferredLanguage, city? }` | `ownerId` |
| `owners.setLanguage` | mutation | `{ language }` | `null` |
| `owners.resetMyData` | mutation | `{}` | `null` |
| `owners.deleteMyAccount` | mutation | `{}` | `null` (B signs out afterwards) |
| `documents.generateUploadUrl` | mutation | `{}` | upload URL |
| `documents.listForOwner` | query | `{}` | documents |
| `intake.ingestWebUpload` | mutation | `{ storageId, mimeType }` | as now; may throw `rate_limited`, `unsupported_file` or `file_too_large` |
| `chat.sendMessage` | mutation | `{ text }` | `null`; may throw `rate_limited` |
| `chat.listThreadMessages` | query | as now (`threadId`, `paginationOpts`, `streamArgs`) | as now; throws if the thread isn't the viewer's |
| `events.listRecentForOwner` | query | `{ sinceMs?, limit? }` | as now |
| `cases.listForOwner` | query | `{}` | as now |
| `cases.get` | query | `{ caseId }` | the case, or `null` if it isn't the viewer's |
| `push.saveSubscription` | mutation | `{ endpoint, keys: { p256dh, auth }, userAgent? }` | `null` |
| `push.removeSubscription` | mutation | `{ endpoint }` | `null` |
| `push.mySubscriptionCount` | query | `{}` | `number` |
| `push.sendTest` | mutation | `{}` | `null` |
| `requireOwner`, `requireOwnerOf` | helpers in `convex/access.ts` | see Section 4 | |

Errors the UI must handle are `ConvexError`s with a `code`: `not_signed_in`, `not_onboarded`, `rate_limited` (with `retryAfterMs`), `unsupported_file`, `file_too_large`.

**Track B implements:**
- `convex/actions.ts`: remove `ownerId` arguments from the public functions; check ownership with `requireOwnerOf`. `actions.propose` and `actions.execute` stay internal and unchanged.
- Everything in the browser: sign-in, onboarding, the service worker, push subscription, the manifest, Vercel.

## 9. Schema changes (Track A owns `convex/schema.ts`)

- Spread `authTables` from `@convex-dev/auth/server` into the schema.
- `owners`: add `userId: v.id("users")` (required) and the index `by_userId`. Dev data has owners without it, so run `admin.resetDemo` (which now leaves no owner) right after pushing. Production starts empty.
- New table `pushSubscriptions`: `ownerId`, `endpoint`, `keys: { p256dh, auth }`, `userAgent?`, `createdAt`. Indexes `by_owner` and `by_endpoint`.
- Event types to add: `owner_onboarded`, `data_reset`, `push_sent`, `push_failed`, `rate_limited`.

## 10. Files you own

`convex/schema.ts`, `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts`, `convex/access.ts`, `convex/push.ts`, `convex/pushNode.ts`, `convex/convex.config.ts`, `convex/agent.ts`, `convex/intake.ts`, `convex/documents.ts`, `convex/cases.ts`, `convex/events.ts`, `convex/owners.ts`, `convex/admin.ts`, `convex/nessie.ts`, `convex/chat.ts`, `convex/testing.ts`, `docs/dev-setup.md`, and the Convex and Google Cloud dashboards.

Don't edit `convex/actions.ts` (Track B), `app/`, `components/`, `lib/`, `messages/`, `public/`, `scripts/` or `package.json` scripts. Ask Track B instead. Adding your dependencies to `package.json` is fine; tell B.

## 11. Git

- Branches: `a/step3-auth-stubs` (merge first), then `a/step3-...` for features.
- Open a PR for each and request a review from Track B. Merge to `main` at least every 2 hours. From the moment Vercel is connected, **`main` is production**, so test on dev before merging.
- On the shared dev deployment, `npx convex dev` pushes your working tree. Keep `main` merged into your branch before running it.

## 12. Acceptance criteria

On production, from a fresh Google account:
- [ ] Sign in with Google on a phone and on a desktop. A Google account that isn't on any test-user list can sign in.
- [ ] Onboarding creates exactly one owner. Running it twice updates the profile.
- [ ] The new owner's CP14 upload finds the Oct 2 payment in **their own** bank (check in `testing:snapshot`); the Step 2 acceptance results still hold.
- [ ] A second account sees none of the first account's documents, cases, actions, events or messages. Try it by calling `cases.get` and `chat.listThreadMessages` from the second account with the first account's ids: you get `null` or an error, never data.
- [ ] Every public function in `convex/` either checks ownership or is an auth route (the grep in Section 4).
- [ ] The 11th upload in an hour is refused with `rate_limited`, and no agent run starts.
- [ ] A 15 MB file and a `.docx` are refused.
- [ ] With a subscription saved, uploading the CP14 sends exactly one `action_needed` push (or `document_read` if nothing is proposed), in the owner's language, with no sensitive numbers.
- [ ] Approving the 972CG payment sends an `action_done` push.
- [ ] Uninstalling the app or revoking permission makes the next push delete that subscription (404 or 410).
- [ ] "Start over with demo data" leaves a clean thread and a reseeded bank. "Delete my account" removes everything, and signing in again starts onboarding.
- [ ] `NESSIE_MODE=mock` passes all of the above.

## 13. When you finish

Write `STEP3_REPORT_A.md` at the repo root: what you built, the deployment names and env list (no secret values), the acceptance results, deviations, known issues, and what Track B and Step 4 need to know.
