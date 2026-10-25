# Step 3.5 report: notification history and Google Calendar sync

*Sat Oct 24, 2026. Follows [STEP3_REPORT.md](STEP3_REPORT.md). This report covers the backend and behavior of the two features, not the UI. The UI (home screen, calendar, notification panel) is described in the PRs.*

**Status**
- Both features are **live on production** (https://ledger-ten-peach.vercel.app). They were deployed from their branches with the Vercel CLI.
- They are **not on `main` yet:** PR #14 (notification history) and PR #15 (Google Calendar, stacked on #14) are open.
- **Google Calendar sync is working on production:** one connected calendar, 247 events synced, no errors.
- **The notification history has 0 entries on production.** It started recording at the deploy, and no letter has been processed since.

| Feature | PR | Branch | Deployed | Verified on production |
|---|---|---|---|---|
| Notification history | #14 | `b/notification-center` | Yes | Functions answer; not yet with real notifications |
| Google Calendar (read-only) | #15 | `b/google-calendar` | Yes | Yes: connect, token exchange, sync of 247 events |

## 1. Notification history

Every notification Ledger sends is now kept, so the owner can look back, search and filter. It's recorded whether or not the owner has a device subscribed to push.

### How it works

- **One recording point:** `queuePush` in `convex/push.ts`, which every notification already goes through.
  - It inserts a row into the new `notifications` table before deciding whether to send a push.
  - Owners without push still get the history.
  - Test pushes (`push.sendTest`) aren't recorded.
- **Category, decided on the server from the push kind and the case:**

| Push kind | Category | Headline (en) |
|---|---|---|
| `action_needed` | `needs_action` | Action needed |
| `document_read`, verdict `suspicious` | `alert` | Possible scam |
| `document_read`, otherwise | `letter` | Letter read |
| `document_failed` | `alert` | Couldn't read your document |
| `action_done`, action failed | `alert` | Didn't go through |
| `action_done`, `pay_bill` executed | `done` | Payment made |
| `action_done`, other | `done` | Done |

- **What's stored:** the headline and body in the owner's language at the time, the case and action ids, a `searchText` field, the time and `readAt`. No new sensitive data: the body is the same text as the push, which never contains SSNs, EINs, account numbers or the letter's text.
- **Search:** a Convex search index on `searchText`, filtered by owner and optionally by category. `searchText` combines:
  - the headline and body in the owner's language
  - the English headline and English summary
  - the document type (e.g. `IRS CP14`)

  So "IRS", "payment" or "multa" all find the same notification whatever the owner's language.
- **Time-sensitive pinning:** decided in the browser, because it depends on today's date and the server query is cached. The server returns the facts with each notification: the case's deadline, its status, and whether it still has a proposed action.
  - **Pin rule:** the case isn't resolved, it still has an action waiting on the owner, and its deadline is within 14 days or already past.
  - Only the newest notification of each case is pinned, soonest deadline first. Everything else stays in time order, or relevance order when searching.
  - The rule is in `lib/notifications.ts` (`PIN_WITHIN_DAYS = 14`).
- **Read state:** `readAt` is set when the owner opens a notification, or for all of them with "mark all read". The unread count drives the badge.
- **Deletion:** "Start over with demo data" and "Delete my account" delete the owner's notifications (`admin.deleteOwnerData`).

### API

| Function | Type | Args | Returns |
|---|---|---|---|
| `notifications.list` | query | `{ search?, category? }` | Up to 100, newest first (or by relevance with `search`), each with `case: { docType, title, deadline?, status, hasPendingAction }`. `[]` when signed out. |
| `notifications.unreadCount` | query | `{}` | Number; `0` when signed out |
| `notifications.markRead` | mutation | `{ notificationId }` | Only the owner's own |
| `notifications.markAllRead` | mutation | `{}` | |
| `actions.listOpenForOwner` | query | `{}` | The owner's proposed actions, newest first (the "To do" list) |

### Schema

- `notifications`:
  - fields: `ownerId`, `kind`, `category` (`needs_action` / `alert` / `letter` / `done`), `title`, `body`, `caseId?`, `actionId?`, `searchText`, `createdAt`, `readAt?`
  - indexes: `by_owner`, `by_owner_and_category`, `by_owner_and_read`
  - search index: `search_text`

### Known limits

- **Notifications sent before the deploy aren't in the history.** Recording started with the deploy.
- **Stored text stays in the language it was sent in.** Changing the language doesn't translate old notifications, but search still works in English.
- **Pinning uses the browser's date,** so it changes at the owner's midnight, not the server's.
- **Not yet checked with real notifications on production.** Uploading a letter there should produce one row, and the CP14 should be pinned (deadline Nov 2).

## 2. Google Calendar sync (read-only)

The owner can connect their Google Calendar. Ledger copies their events and shows them next to the letters' deadlines. Ledger never writes to the calendar.

### How it works

- **A separate OAuth flow from sign-in,** on the same Google OAuth client:
  - Calendar access (`calendar.readonly`) is a **sensitive scope**. An unverified app shows Google's "hasn't verified this app" screen for it, and the user cap is 100.
  - Asking for it only when the owner connects a calendar keeps sign-in free of that screen.
- **Flow:**
  1. `googleCalendar.startConnect` creates a single-use `state` (10-minute lifetime) and returns Google's consent URL. It asks for `access_type=offline` and `prompt=consent`, so Google returns a refresh token.
  2. Google redirects to `GET /calendar/callback` on the Convex site. The callback:
     - checks and consumes the state
     - exchanges the code
     - checks that the calendar scope was actually granted
     - saves the tokens and starts a sync
  3. The owner lands back on the home screen with `?calendar=connected`, or with `?calendar=error&reason=…`.
- **Failure reasons,** shown to the owner and logged:
  - `cancelled`: the owner pressed Cancel
  - `state`: unknown, used or expired
  - `token`: the exchange failed
  - `scope`: the calendar checkbox on Google's screen wasn't ticked
  - `no_refresh_token`

  `scope` is the easy one to hit, because Google shows the permission as a checkbox that starts unticked. It was the cause of the first failed connect on production. It's also logged as a `calendar_connect_failed` event.
- **Sync:**
  - Covers the primary calendar, from 31 days back to 120 days ahead, single events (recurring ones expanded), at most 1,000.
  - Runs on connect and then hourly (`crons.ts`, `googleCalendar.syncAll`, owners staggered by 2 seconds).
  - The access token is refreshed from the refresh token when it has less than a minute left.
  - Each sync replaces the owner's copied events.
- **What's stored per event:** title (up to 200 characters), start date, start time (`HH:MM`, or none for all-day events) and the link to the event in Google Calendar. The date and time are taken as Google gives them, in the calendar's time zone.
- **Revoked access:** if the owner removes Ledger's access in their Google account, the next sync gets `invalid_grant` (or a 401 or 403). The connection is marked `revoked`, the copied events are deleted, and the UI offers to reconnect.
- **Disconnect and deletion:** "Disconnect" and "Delete my account" revoke the grant at Google and delete the connection and the events. "Start over" deletes the events but keeps the connection, and the next sync refills them.
- **Privacy:**
  - The refresh and access tokens never leave the backend; no public query returns them.
  - Events are not sent to Anthropic.
  - The privacy policy has a Google Calendar section, including Google's Limited Use requirement.

### API

| Function | Type | Args | Returns |
|---|---|---|---|
| `googleCalendar.status` | query | `{}` | `null` signed out; `{ connected: false }`; or `{ connected: true, calendarName?, lastSyncedAt?, error? }` |
| `googleCalendar.events` | query | `{ from, to }` (ISO dates) | The owner's events in that range, up to 500 |
| `googleCalendar.startConnect` | mutation | `{}` | Google's consent URL |
| `googleCalendar.syncNow` | mutation | `{}` | Schedules a sync |
| `googleCalendar.disconnect` | mutation | `{}` | Revokes, deletes the connection and events |
| `GET /calendar/callback` | HTTP | `code`, `state` | Redirects to the app |

### Schema

| Table | Fields | Index |
|---|---|---|
| `calendarConnections` | `ownerId`, `refreshToken`, `accessToken?`, `accessTokenExpiresAt?`, `calendarName?`, `connectedAt`, `lastSyncedAt?`, `error?` | `by_owner` |
| `calendarEvents` | `ownerId`, `googleId`, `title`, `date`, `time?`, `htmlLink?` | `by_owner_and_date` |
| `calendarOAuthStates` | `ownerId`, `state`, `createdAt` | `by_state` |

`calendarOAuthStates` is renamed to `googleOAuthStates` (with a `purpose`) in the Gmail work in progress, so Calendar and Gmail can share the OAuth helpers.

### Google Cloud setup (done)

1. Google Calendar API enabled.
2. Redirect URIs on the web client:
   - `https://majestic-wolverine-921.convex.site/calendar/callback`
   - `https://fast-fish-37.convex.site/calendar/callback`
3. `calendar.readonly` added under Data Access.

### Verified on production

- `/calendar/callback` without parameters redirects to `?calendar=error`, and with a bad state to `reason=state`.
- **First real connect:** failed with `scope`, because the checkbox wasn't ticked. This led to the failure reasons above.
- **Second connect:** succeeded. `calendar_connected` was logged, and 247 events synced with no error.

### Known limits

- **Every owner who connects sees Google's "hasn't verified this app" screen** (Advanced, then continue), and at most 100 users can connect. Removing it needs Google's verification of the sensitive scope, which takes days to weeks.
- **Only the primary calendar is synced.**
- **Events more than 120 days ahead aren't shown.** Changes in Google appear within the hour, or at once with `syncNow`.
- **Do not upload a logo on Google's Branding page:** it triggers branding verification, which needs domain ownership and a 24-hour wait.

## In progress: Gmail triage (not deployed)

On branch `b/google-calendar` (uncommitted when this report was written):
- **Access:** Gmail read-only, with the same OAuth flow. `gmail.readonly` is a restricted scope, so connecting shows the same warning screen. The team chose this knowingly.
- **Filtering:** Gmail's own filters go first (spam, trash, Promotions, Social, Forums are never fetched).
- **Sorting:** rule-based, with no AI call:
  - **government:** a `.gov` domain or an official agency domain
  - **suspicious:** sounds like an agency but isn't one, or uses pressure or unusual payment methods
  - **business**
  - **other:** newsletters end up here
- **Attachments:** a PDF or photo attached to a government email goes through the normal intake automatically (at most 3 per sync), so Ledger reads it like an uploaded letter.
- **Notifications:** government emails without an attachment, and suspicious emails, get a notification.
- **Storage:** only headers, the snippet and attachment metadata are stored, never email bodies.

## PRs and next steps

1. **Review and merge #14, then #15.** The live site runs their code but `main` doesn't have it. Merging doesn't redeploy anything, because production is deployed with the Vercel CLI.
2. **Test the notification history on production:**
   - Upload the CP14 and check that one `needs_action` notification is recorded and pinned.
   - Search "IRS" and check that it's found.
3. **Finish and test Gmail.** It needs, in Google Cloud: the Gmail API enabled, the `/gmail/callback` redirect URIs, and `gmail.readonly` under Data Access.
