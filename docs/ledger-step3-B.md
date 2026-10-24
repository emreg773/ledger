# Ledger: Step 3 Brief, Track B (sign-in, onboarding, push, deploy)

You are continuing **Ledger**, a hackathon project (Cal Hacks 13.0, deadline **Sunday Oct 25, 2026, 9:00 AM PT**). Steps 1 and 2 are merged on `main`. Before writing code, read these files in the repo:
- `docs/ledger-step1.md`, Sections 1 to 3: what Ledger is and the agent principle.
- `STEP2_REPORT_A.md`: what exists now, especially "Current status" and "For Track B and Step 3".
- `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`: the manifest, service worker, push subscription and iOS install pattern this step follows. This is Next 16; its docs win over what you remember.

Two developers work in parallel. **You are Track B (frontend and deploy).** Track A is building Google sign-in on Convex, one owner per account, ownership checks, per-user banks, rate limits and push sending from a sibling brief. Stick to the files you own (Section 9) and the contract (Section 7).

---

## 0. Changes since Step 2 (decided by the team)

**The goal changed: ship a live link judges can sign into and use.** We cut features to get there.

| Step | Track A | Track B |
|---|---|---|
| **3 (this file)** | Google sign-in on Convex, one owner per account, ownership checks everywhere, a Nessie bank per user, rate limits, the production deployment, sending web pushes | Sign-in and onboarding screens, the app shell, the service worker, the PWA manifest, the push opt-in, Vercel |
| 4 | Responses: the agent drafts reply letters, dispute statements and checklists as PDFs (`generate_document`), plus deadline reminders by push | Generated-document cards and preview, the reminder UI |
| 5 | Demo hardening, Spanish review, a formality rule | Landing page, downloadable sample letters, README, phone check |

**Cut:** Gmail intake, WhatsApp and staff tasks, inspection mode end to end, the calendar, and the audit dashboard.

## 1. Goal of Step 3

Anyone with a Google account can open the live link, sign in, set up their business, and use Ledger on their own data. They can turn on notifications and get a push when Ledger finishes reading a letter or an action completes. On iPhone they're guided to add Ledger to the Home Screen first, because iOS only allows web push for installed apps.

**Demo moment this step must support:**
1. A judge opens the Vercel URL on their phone and taps "Continue with Google".
2. They enter their name and business and pick Spanish. The whole UI switches to Spanish.
3. Ledger asks to turn on notifications; they accept.
4. They upload the CP14 sample and lock their phone. A push arrives. Tapping it opens the app scrolled to that case.

## 2. Pre-step tasks (do these first)

1. **Vercel project (about 20 minutes, no waiting on Track A).**
   - Import the GitHub repo into Vercel.
   - Build command: `npx convex deploy --cmd 'npm run build'`. This deploys the Convex functions to **production** and builds Next against the prod URL. From then on, **every merge to `main` deploys to production.**
   - Env: `CONVEX_DEPLOY_KEY` (the prod deploy key, from Track A) and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (from Track A). `npx convex deploy` sets `NEXT_PUBLIC_CONVEX_URL` itself.
   - Send Track A the production URL right away. They need it for `SITE_URL` and for Google sign-in.
   - Turn off Vercel preview deployments for branches, or give them no deploy key. A preview build must never deploy branch code to the prod backend.
2. **Wait for Track A's stubs PR** (`a/step3-auth-stubs`) before changing the Convex calls in the UI. Until it's merged, build the new screens against `lib/mocks.ts`, as in Step 2.

## 3. Sign-in

Use Convex Auth's **React (client-only)** setup, not its Next.js server-side setup. The UI is already a client component, and this avoids `proxy.ts` (Next 16's new name for `middleware.ts`).

- `app/ConvexClientProvider.tsx`: replace `ConvexProvider` with `ConvexAuthProvider` from `@convex-dev/auth/react`.
- `app/page.tsx` decides what to show:
  - `useConvexAuth()` is loading → a quiet spinner
  - signed out → the **sign-in screen**
  - signed in and `owners.me` is `null` → **onboarding**
  - otherwise → the chat
- **Sign-in screen:**
  - The Ledger name and a one-line pitch: snap a photo of any government letter; Ledger reads it, explains it in your language, and does the follow-up work.
  - One "Continue with Google" button: `signIn("google")` from `useAuthActions`.
  - A small language switcher (en, es, tr) that only changes this screen. Use the browser language as the default.
  - The privacy line from Section 5.
- **Sign out:** in the app menu (Section 4).
- If Google sign-in comes back with an error, show it in plain words and keep the button.

## 4. Onboarding and app shell

**Onboarding** (one screen, phone-first):
- Fields: name, business name and language (three big buttons: Español, English, Türkçe). City defaults to Oakland, with a note that Ledger currently knows Alameda County agencies (IRS, Alameda County Environmental Health, City of Oakland).
- Submit calls `owners.completeOnboarding`. The bank is seeded in the background. Then show the chat with a short welcome:
  - Ledger works on a **sandbox bank**: the money is fake and the account was created for them.
  - Try a sample letter; Step 5 adds downloadable samples.
  - Turn on notifications.

**App shell.** Add a header menu to the chat with:
- Language: the existing picker, now calling `owners.setLanguage({ language })`
- Notifications: on or off, from `push.mySubscriptionCount`, plus "Send a test notification" (`push.sendTest`)
- "Start over with demo data": confirm, then `owners.resetMyData`
- "Delete my account": confirm with a typed or double confirmation, then `owners.deleteMyAccount` and `signOut()`
- Sign out
- A small "Sandbox bank" label wherever the bank or a payment appears (the Approve card and the bank check), so no judge thinks real money moved.

**Calls to update** (the owner now comes from the session; see Section 7):
- `components/chat.tsx`: `useQuery(api.owners.me)` replaces `getDemoOwner`. Drop `ownerId` from `documents.listForOwner`, `events.listRecentForOwner`, `cases.listForOwner`, `documents.generateUploadUrl`, `intake.ingestWebUpload`, `chat.sendMessage` and `owners.setLanguage`.
- Delete the "No owner yet. Run npm run seed" screen.
- `app/dev/page.tsx` (the card preview): keep it on mocks, or put it behind `process.env.NODE_ENV !== "production"`. It must not ship as a public page that calls the backend.

**Errors.** Mutations can throw a `ConvexError` with a `code`. Show each as a translated, friendly message in the composer area, never a raw error:
- `rate_limited`: "You've sent a lot in the last hour. Try again in {minutes} minutes." Use `retryAfterMs`.
- `unsupported_file`: "Ledger reads photos and PDFs."
- `file_too_large`: "That file is over 10 MB."
- `not_signed_in` / `not_onboarded`: go back to sign-in or onboarding.

**Deep links.** A push opens `/?case=<caseId>`. Scroll to the first message in the chat that references that case's document or actions, and highlight it briefly. If there's no match, just open the chat.

## 5. Privacy notice

Real people may upload real letters. Add one line under the upload button and on the sign-in screen, translated:

> Hackathon prototype. Before uploading a real letter, cover your SSN, EIN and account numbers. Your files are read by Anthropic's Claude.

Also link "Delete my account" from the welcome message.

## 6. PWA and web push (browser side)

**Manifest:** `app/manifest.ts`, as in the Next PWA guide:
- `name` "Ledger" and a short description
- `start_url` "/" and `display` "standalone"
- theme and background colors from the existing tokens in `app/globals.css`
- icons at 192 px and 512 px in `public/icons/`, plus `apple-icon.png` (180 px) in `app/`. A simple monogram is fine.

**Service worker:** `public/sw.js`, registered on load with `navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })`.
- `push`: parse the payload `{ title, body, url, tag }` (Track A's contract) and call `self.registration.showNotification(title, { body, tag, icon, badge, data: { url } })`. Always show something; if the payload doesn't parse, show "Ledger has an update".
- `notificationclick`: close the notification. Focus an open Ledger window and navigate it to `data.url`, or open a new one.
- No offline caching in this step. A stale cached app is worse than no app during judging.
- Add headers for `/sw.js` in `next.config.ts`: `Content-Type: application/javascript; charset=utf-8` and `Cache-Control: no-cache, no-store, must-revalidate`, as the guide shows.

**Opt-in flow** (`components/notifications.tsx`):
- **Ask after a user action, never on page load.** Browsers block or penalize prompts that aren't tied to a tap. Show a "Turn on notifications" banner in the chat after onboarding and after the first upload; the tap calls `Notification.requestPermission()`.
- On "granted": `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(NEXT_PUBLIC_VAPID_PUBLIC_KEY) })`, then `push.saveSubscription` with `endpoint` and `keys` from `subscription.toJSON()`, plus `navigator.userAgent`.
- Turning notifications off calls `subscription.unsubscribe()` and `push.removeSubscription`.
- On every load, if permission is granted and a subscription exists, call `push.saveSubscription` again. It's an idempotent upsert, and it covers a browser that rotated its endpoint or a different user signing in on the same device.
- **Permission denied:** say how to turn it back on in the browser settings; don't keep asking.
- **iPhone and iPad:**
  - When `navigator.userAgent` matches iOS and the app isn't installed (`window.matchMedia("(display-mode: standalone)").matches` is false), replace the banner with install steps: tap Share, then "Add to Home Screen", then open Ledger from the Home Screen.
  - Push needs iOS 16.4 or later.
  - Sign-in carries over into the installed app only if the user signs in again there. Say so in the install steps.
- **Unsupported browsers** (no `PushManager`): hide the notification controls.

**Translations:** every new string goes into `messages/en.json`, `es.json` and `tr.json`. Spanish and Turkish should sound natural, and Spanish uses formal "usted" consistently, matching the agent.

## 7. Contract for Step 3 (shared with Track A)

**Track A implements** (all public; the owner always comes from the session):

| Function | Type | Args | Returns |
|---|---|---|---|
| `owners.me` | query | `{}` | the owner, or `null` when signed out or not onboarded |
| `owners.completeOnboarding` | mutation | `{ name, businessName, preferredLanguage, city? }` | `ownerId` |
| `owners.setLanguage` | mutation | `{ language }` | `null` |
| `owners.resetMyData` | mutation | `{}` | `null` |
| `owners.deleteMyAccount` | mutation | `{}` | `null` (you sign out afterwards) |
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
| `requireOwner(ctx)`, `requireOwnerOf(ctx, row)` | helpers in `convex/access.ts` | | the owner / the row; throw when not allowed |

Track A also sends every push. You never call a push-sending function; you only manage subscriptions.

**Push payload** your service worker receives:
```json
{ "title": "Ledger", "body": "…", "url": "/?case=<caseId>", "tag": "case-<caseId>" }
```

**Track B implements** in `convex/actions.ts`:
- Remove the `ownerId` argument from every public function (`approve`, `reject`, `markDone`, `get`, `listForCase`).
- Load the row and pass it through `requireOwnerOf(ctx, row)` before doing anything. For `listForCase`, check the case.
- `get` and `listForCase` return `null` or `[]` for someone else's ids; the mutations throw.
- `propose`, `execute`, `finish` and the other internal functions stay unchanged.
- `lib/contract.ts`: update the types if the shapes change.

## 8. Scripts and docs

- `package.json`: remove the `seed` script (there's no demo owner any more). Keep `reset` pointed at `admin:resetDemo` for dev, which now wipes everything. Add whatever Track A's dependencies need.
- `README.md`: update "Current status" to Step 3, the live URL, and the new setup (sign in instead of seeding).
- `scripts/test-fixtures.ts` calls internal functions only, so it should keep working. Confirm it does.

## 9. Files you own

`convex/actions.ts`, `app/`, `components/`, `lib/`, `messages/`, `public/`, `scripts/`, `next.config.ts`, `package.json` scripts, `README.md`, and the Vercel project.

Don't edit `convex/schema.ts` or any other Track A file (`auth.ts`, `http.ts`, `access.ts`, `push.ts`, `pushNode.ts`, `owners.ts`, `agent.ts`, `intake.ts`, `documents.ts`, `cases.ts`, `events.ts`, `chat.ts`, `admin.ts`, `nessie.ts`, `testing.ts`). If you need a backend change, ask Track A.

## 10. Git

- Branches: `b/step3-...`. Open a PR for each and request a review from Track A.
- Merge `main` into your branch before running `npx convex dev`; on the shared dev deployment it pushes your working tree.
- Once Vercel is connected, **`main` is production.** Check each PR locally against dev before merging, and open the live URL after every merge.

## 11. Acceptance criteria

On the production URL:
- [ ] Phone (iOS Safari and Android Chrome) and desktop: sign in with Google, onboard, and land in the chat in the chosen language.
- [ ] Reloading keeps you signed in. Sign out returns to the sign-in screen.
- [ ] A second Google account sees an empty chat, not the first account's data.
- [ ] Uploading the CP14 shows live activity and the Step 2 reply and cards, as before; Approve on the 972CG still works and shows "Sandbox bank".
- [ ] Android Chrome and desktop Chrome: turn on notifications from the banner; "Send a test notification" arrives.
- [ ] With the phone locked, uploading the CP14 produces one push. Tapping it opens the app at that case.
- [ ] iPhone: the install steps show in Safari. After Add to Home Screen and signing in again, notifications can be turned on and a test push arrives.
- [ ] Turning notifications off stops pushes to that device.
- [ ] Rate-limit and file errors show as friendly translated messages.
- [ ] "Start over with demo data" and "Delete my account" work, each after a confirmation.
- [ ] No page on production shows mock data or "run npm run seed". `/dev` is not reachable, or uses mocks only.
- [ ] Lighthouse's PWA check finds the manifest and the service worker.

## 12. When you finish

Write `STEP3_REPORT_B.md` at the repo root: the live URL, what you built, the browsers and devices you tested, the acceptance results, deviations, known issues, and what Step 4 needs to know.
