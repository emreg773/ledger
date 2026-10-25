# Dev setup

Ledger is one Convex project, `ledger` (team `emreg`). Convex gives every project **one shared production deployment and one dev deployment per team member**. Each deployment is a separate backend with its own database, files and environment variables.

| | Deployment | Used by |
|---|---|---|
| **Production** (shared) | `prod:majestic-wolverine-921` | Vercel. `npx vercel deploy --prod` from `main` runs `npx convex deploy` |
| **Emre's dev** | `dev:fast-fish-37` (https://fast-fish-37.convex.cloud) | Emre's `npx convex dev` and `npm run dev` |
| **Mert's dev** | `dev:utmost-mosquito-685` (https://utmost-mosquito-685.convex.cloud) | Mert's `npx convex dev` and `npm run dev` |

Your dev deployment only runs **your** working tree, so the two of you never overwrite each other's functions. Your data, uploads and test accounts are separate too. Code meets in `main`, and from there in production.

Merging to `main` doesn't deploy; production is deployed by hand (README, "Deploy"). Test on your own dev deployment first: `npx convex dev --start "npm run dev"` runs your backend and the site at http://localhost:3000 together.

## Environment variables

Set them with `npx convex env set NAME value`, which writes to your own dev deployment. For production, use `npx convex env set --prod NAME value`. You can also set them in the dashboard, under the deployment → Settings → Environment Variables. They're stored on the deployment at Convex, never in the repo or `.env.local`.

Every team member can see and change these values in the dashboard.

| Name | Each dev | Prod | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✓ | ✓ | Set a monthly spend limit on the key in the Anthropic console |
| `NESSIE_MODE` | `mock` or `live` | `live` | If Nessie breaks: `mock` (owners then need "Start over with demo data") |
| `NESSIE_API_KEY` | live only | ✓ | |
| `IGNORE_SAMPLE_WATERMARKS` | optional | `true` | Judges upload our SAMPLE fixtures |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | ✓ | ✓ | One Google OAuth client for every deployment; each deployment needs its redirect URI (below) |
| `SITE_URL` | `http://localhost:3000` | the Vercel URL | Where Google sign-in returns to |
| `JWT_PRIVATE_KEY`, `JWKS` | ✓ | ✓ | Set by `npx @convex-dev/auth` (add `--prod` for production). Different on each deployment |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | ✓ | ✓ | **The same pair everywhere.** The public key also goes to Vercel as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` |
| `VAPID_SUBJECT` | optional | recommended | `mailto:team@…`. Falls back to `SITE_URL` (https) or the repo URL |
| `LEDGER_DAILY_RUN_LIMIT` | optional | optional | Global cap on agent runs per day (default 600). `0` stops all runs |

**Shortcut: project defaults.** In the dashboard, under Project settings → Environment Variables, values set as *defaults* are copied into every **new** deployment of the project. Set the ones shared by every dev deployment there: `ANTHROPIC_API_KEY`, `NESSIE_MODE`, `NESSIE_API_KEY`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and the two `VAPID_` keys. A teammate's new dev deployment then starts with them. A deployment that already exists isn't changed, so set its values by hand.

## Google sign-in

1. In Google Cloud console, open APIs & Services → Credentials, and create an OAuth client of type **Web application**.
2. Add one **authorized redirect URI per deployment**, in the form `https://<deployment>.convex.site/api/auth/callback/google`:
   - `https://fast-fish-37.convex.site/api/auth/callback/google` (Emre's dev)
   - `https://majestic-wolverine-921.convex.site/api/auth/callback/google` (production)
   - `https://utmost-mosquito-685.convex.site/api/auth/callback/google` (Mert's dev)
3. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` on every deployment, or as project defaults.
4. On the **OAuth consent screen**, publish the app ("In production"). In "Testing", only listed test users can sign in. The basic scopes (openid, email, profile) don't need Google's verification.

Every new deployment needs its redirect URI added to the same client. Without it, Google refuses the sign-in with `redirect_uri_mismatch`.

## Setting up your dev deployment (each developer, once)

```bash
npx convex login                      # your own Convex account (you must be on team emreg)
npx convex dev --configure=existing   # pick team emreg, project "ledger": creates YOUR dev deployment
                                      # answer No to "Set up Convex AI files"
```

`npx convex dev` writes your deployment name and URL into `.env.local`; it isn't committed. Keep it running. Then, in a second terminal:

```bash
npx @convex-dev/auth --web-server-url http://localhost:3000   # JWT keys and SITE_URL on your deployment
npx convex env list                                           # check what's set (names only)
```

Then:
1. Set any variable from the table that's missing on your deployment (`npx convex env set NAME value`). Ask Emre for the VAPID private key; the pair must match everywhere.
2. Ask Emre to add your redirect URI to the Google client (the deployment name is in `.env.local`).
3. Run `npm run dev`, open http://localhost:3000 and sign in with Google.

## Production (once, by Emre)

```bash
npx convex env set --prod NAME value      # every variable in the Prod column
npx @convex-dev/auth --prod --web-server-url https://<vercel-url>
```

Deploy key for Vercel: dashboard → production → Settings → Deploy keys. It lets Vercel deploy to production without a login, so treat it like a password.

## Common commands

```bash
npm run reset                                   # dev only: deletes every owner and their data on YOUR dev deployment
npx convex run testing:snapshot '{"email": "you@gmail.com"}'       # an owner's cases, actions, events, messages
npx convex run testing:reseedBank '{"email": "you@gmail.com", "withoutTreasuryPayment": true}'
npx convex run events:listForOwner '{"ownerId": "<id>"}'
npm run test:fixtures                           # extraction fixtures
```
