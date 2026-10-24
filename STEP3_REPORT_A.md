# Step 3 report, Track A (backend: accounts, security, push)

*Sat Oct 24, 2026. Brief: [docs/ledger-step3-A.md](docs/ledger-step3-A.md).*

**Status:** the backend for Step 3 is built and deployed to the **dev** deployment. Typecheck and lint pass. Nothing has been tested end to end yet, because three things only you or Track B can do:
- create the Google OAuth client (sign-in needs it)
- set the production secrets
- the sign-in UI (Track B)

The acceptance table below says what was checked and what is waiting.

## Merged PRs

| PR | Branch | What |
|---|---|---|
| #9 | `a/step3-auth-stubs` | Convex Auth with Google, `access.ts`, every public function scoped to the session owner, owner functions, per-owner bank, push subscription functions, the schema |
| #11 | `a/step3-push-limits` | Rate limits and the daily kill switch, upload checks, push sending (`pushNode.ts`) with every trigger, hourly cleanup of unused uploads, dev setup docs, this report |

## What was built

| Area | Files | Notes |
|---|---|---|
| Sign-in | `convex/auth.ts`, `auth.config.ts`, `http.ts` | Google provider. Routes at `https://<deployment>.convex.site/api/auth/...` |
| Ownership | `convex/access.ts` | `viewerOwner` (null when signed out, for queries), `requireOwner` (throws `not_signed_in` or `not_onboarded`), `requireOwnerOf` (throws `not_found` for missing rows and other owners' rows alike) |
| Public functions | `cases`, `documents`, `events`, `intake`, `chat`, `owners`, `push` | The owner always comes from the session. `chat.listThreadMessages` throws unless the thread is the viewer's. `events.listForOwner` is internal now. |
| Owners | `convex/owners.ts` | `me`, `completeOnboarding` (one owner per user, a second call updates the profile, inputs validated), `setLanguage`, `resetMyData`, `deleteMyAccount` |
| Per-owner bank | `convex/nessie.ts` | `seedBankFor`: the same demo history for every owner. Mock rows are per owner now; they used to be one shared set. Live mode creates a Nessie customer and account per owner, in the owner's name. |
| Deletion | `convex/admin.ts` | `deleteOwnerData`, `deleteOwner`, `deleteAuthUser` (sessions, refresh tokens, accounts, verification codes). `resetDemo` deletes every owner and no longer creates María. |
| Limits | `convex/limits.ts`, `convex.config.ts` | 10 uploads and 40 chat messages per owner per hour; a global cap of 600 agent runs per day (`LEDGER_DAILY_RUN_LIMIT`). Refusals are `ConvexError({ code: "rate_limited", retryAfterMs })`. |
| Upload checks | `convex/intake.ts` | JPEG, PNG, WebP or PDF only (`unsupported_file`); 10 MB max (`file_too_large`). The stored file's content type is checked, not just the client's claim. |
| Unused uploads | `convex/crons.ts`, `admin.cleanupOrphanUploads` | Hourly. Deletes files older than an hour that no document uses. |
| Push | `convex/push.ts`, `convex/pushNode.ts` | Subscriptions upsert by endpoint and move between owners on a shared browser. Messages are in en, es and tr. Sending runs in Node with `web-push`; a 404 or 410 deletes the subscription; other failures log `push_failed` and never throw. |
| Test helpers | `convex/testing.ts` | `snapshot` and `recentMessages` take `email`; `reseedBank` (with `withoutTreasuryPayment`) replaces the old reset flag |

### Push triggers

| `kind` | When |
|---|---|
| `action_needed` | A document run finished and proposed at least one action on its case |
| `document_read` | A document run finished with no new proposal |
| `document_failed` | Reading failed, the photo was too unclear (confidence below 0.6), or the agent run crashed |
| `action_done` | After the follow-up reply to an executed or failed action, or an owner task marked done. Not for rejections. |
| `test` | `push.sendTest` |

Replies to typed chat messages never push.

Examples of the push text:
- "Ledger leyó su carta del IRS: ya está pagada. Toque para revisar el siguiente paso."
- "Ledger leyó su carta del IRS: $520.00, vence el 19 nov"
- "Pagado: $520.00 de la cuenta que termina en 4417."

A push only contains the friendly document name, the amount, the deadline, the verdict and the account's last 4 digits.

The payload is `{ title: "Ledger", body, url: "/?case=<caseId>", tag: "case-<caseId>" }`. Pushes not tied to a case use `url: "/"` and `tag: "ledger-<kind>"`.

## Deployments and env (no values)

| | Dev (Emre's; each member has their own) | Production |
|---|---|---|
| Deployment | `dev:fast-fish-37` | `prod:majestic-wolverine-921` |
| Set | `ANTHROPIC_API_KEY`, `NESSIE_MODE`, `NESSIE_API_KEY`, `SITE_URL` (http://localhost:3000), `JWT_PRIVATE_KEY`, `JWKS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | **Nothing yet** |
| Missing | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (and optionally `VAPID_SUBJECT`) | Everything; see [docs/dev-setup.md](docs/dev-setup.md) |

VAPID public key, which Vercel needs as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: `BETEnx_bSXID-K7M0D6ELX4Xszf7wpVJ1EwGibvbm34PayRHGB3v076uzD-_tae--a9034HF2-0qqxcUg29b2eY`. The same pair is used on dev and production.

## Acceptance (brief Section 12)

| Check | Result |
|---|---|
| Google sign-in on phone and desktop, by an account not on a test-user list | **Waiting:** Google OAuth client and Track B's sign-in screen |
| Onboarding creates exactly one owner; running it again updates the profile | Built (`completeOnboarding` checks `by_userId` first). Not run. |
| A new owner's CP14 finds the Oct 2 payment in their own bank | Built (`seedBankFor` per owner). Not run. |
| A second account sees none of the first's data | Built: `cases.get` returns `null`, and `chat.listThreadMessages` throws `not_found`. Not run with two accounts. |
| Every public function checks ownership or is an auth route | **Pass** for Track A's files (grep in brief Section 4). `actions.ts` is Track B's to update. |
| The 11th upload in an hour is refused with `rate_limited`, and no agent run starts | Built: the check runs before the document is created and the run scheduled. Not run. |
| A 15 MB file and a `.docx` are refused | Built (`file_too_large`, `unsupported_file`). Not run. |
| CP14 sends exactly one `action_needed` (or `document_read`) push, in the owner's language, with no sensitive numbers | Built. Not run: needs a subscription from Track B's service worker. |
| Approving the 972CG payment sends `action_done` | Built. Not run. |
| A revoked permission makes the next push delete the subscription | Built (404 and 410). Not run. |
| "Start over" leaves a clean thread and a reseeded bank; "Delete my account" removes everything | Built. `resetMyData` creates a new thread; `deleteMyAccount` also removes the auth user. Not run. |
| `NESSIE_MODE=mock` passes all of the above | Not run |

## Deviations from the brief

- **Temporary compatibility, so `main` keeps compiling** until Track B's UI switches over:
  - The old `ownerId` arguments are still accepted and ignored.
  - `owners.getDemoOwner` is an alias of `owners.me`.

  Both are marked `TODO(step3)` and go away in a follow-up PR once B's PR lands.
- **`owners.userId` is still optional** in the schema. The dev deployment has an owner from Step 2 without it, and the reset that deletes that owner was blocked for me (it deletes data). Run `npm run reset` on dev; then `userId` can become required.
- **Refused uploads can't delete their file in the same call.** A mutation that throws rolls back all its writes, including the storage delete. The hourly cleanup removes those files instead.
- **For the same reason, refused requests don't log a `rate_limited` event.** Only skipped follow-up replies, which don't throw, log one.
- **Uploads accept JPEG, PNG, WebP and PDF**, not every `image/*`. Other image types would only fail later in extraction.
- **Over the daily cap, the follow-up reply after an action is skipped.** The action card still shows the result.
- **The VAPID subject falls back to `SITE_URL`**, when it's https, and then to the repo URL. Dev's `http://localhost` isn't accepted by push services.
- **`events.listForOwner` is internal,** as the brief says.

## Known issues

- **Nothing has been tested with a real sign-in yet.** See the acceptance table.
- **Your `npx convex dev` window stopped pushing during this step.** I deployed with `npx convex dev --once`. Restart the watcher.
- **`actions.ts` has no ownership checks yet.** That's Track B's part of this step: `approve`, `reject`, `markDone`, `get` and `listForCase` still take any `actionId` or `caseId`.
- **Owners seeded with live Nessie keep live account ids if production switches to mock.** They need "Start over with demo data" to get a mock bank.

## For Track B and Step 4

- **Sign-in:** wrap the app in `ConvexAuthProvider` (`@convex-dev/auth/react`) and use `useAuthActions().signIn("google")`. That's the client-only setup; no `proxy.ts`.
- **Routing:** `owners.me` returns `null` both when signed out and when not onboarded. Use `useConvexAuth().isAuthenticated` to tell them apart.
- **Error codes:** `not_signed_in`, `not_onboarded`, `not_found`, `invalid_input` (with `field`), `rate_limited` (with `retryAfterMs`), `unsupported_file`, `file_too_large`.
- **`actions.ts`:** use `requireOwnerOf(ctx, await ctx.db.get(actionId))`.
- **Push:**
  - `saveSubscription` upserts.
  - `mySubscriptionCount` returns `0` when signed out.
  - `sendTest` pushes "Notifications are on" in the owner's language.
- **Step 4:** new agent tools must take the owner from `ctx.userId`, as today. For reminder pushes, add a `kind` to `pushKind` and `message()` in `convex/push.ts`.
