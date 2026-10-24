# Dev setup

Ledger has two Convex deployments in project `ledger` (team `emreg`):

| | Deployment | Used by |
|---|---|---|
| **Dev** (shared by both tracks) | `dev:fast-fish-37`, https://fast-fish-37.convex.cloud | `npx convex dev` on your machine, `npm run dev` at http://localhost:3000 |
| **Production** | `prod:<name>`: see the Convex dashboard (TODO: fill in after the first deploy) | Vercel. Every merge to `main` runs `npx convex deploy` |

`main` is production once Vercel is connected. Test on dev before merging.

## Environment variables

Set them with `npx convex env set NAME value` (dev) or `npx convex env set --prod NAME value` (production), or in the dashboard. Never commit values.

| Name | Dev | Prod | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✓ | ✓ | Set a monthly spend limit on the key in the Anthropic console |
| `NESSIE_MODE` | `mock` or `live` | `live` | If Nessie breaks: `mock` (owners then need "Start over with demo data") |
| `NESSIE_API_KEY` | live only | ✓ | |
| `IGNORE_SAMPLE_WATERMARKS` | optional | `true` | Judges upload our SAMPLE fixtures |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | ✓ | ✓ | One Google OAuth client, both redirect URIs (below) |
| `SITE_URL` | `http://localhost:3000` | the Vercel URL | Where Google sign-in returns to |
| `JWT_PRIVATE_KEY`, `JWKS` | ✓ | ✓ | Set by `npx @convex-dev/auth` (add `--prod` for production) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | ✓ | ✓ | The same pair on both, from `npx web-push generate-vapid-keys`. The public key also goes to Vercel as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` |
| `VAPID_SUBJECT` | optional | recommended | `mailto:team@…`. Falls back to `SITE_URL` (https) or the repo URL |
| `LEDGER_DAILY_RUN_LIMIT` | optional | optional | Global cap on agent runs per day (default 600). `0` stops all runs |

## Google sign-in

1. In Google Cloud console, open APIs & Services → Credentials, and create an OAuth client of type **Web application**.
2. Add one **authorized redirect URI** per deployment:
   - `https://fast-fish-37.convex.site/api/auth/callback/google` (dev)
   - `https://<prod-name>.convex.site/api/auth/callback/google` (production)
3. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` on both deployments.
4. On the **OAuth consent screen**, publish the app ("In production"). In "Testing", only listed test users can sign in. The basic scopes (openid, email, profile) don't need Google's verification.

To add a deployment later, add its redirect URI to the same client.

## First-time link (done once)

```bash
npx convex login
npx convex dev --configure=new   # answer No to "link your existing deployment" and to "Set up Convex AI files"
npx @convex-dev/auth --web-server-url http://localhost:3000   # JWT keys and SITE_URL on dev
```

Then invite the other developer to the Convex team (dashboard, Team settings, Members).

## Joining

```bash
npx convex login
npx convex dev --configure=existing   # pick team, project "ledger", then the shared dev deployment
npm run dev                           # http://localhost:3000, then sign in with Google
```

**Careful:** on a shared deployment, `npx convex dev` pushes *your* working tree. Keep `main` merged into your branch before running it, or you'll overwrite the other track's functions.

## Common commands

```bash
npm run reset                                   # dev only: deletes every owner and their data
npx convex run testing:snapshot '{"email": "you@gmail.com"}'       # an owner's cases, actions, events, messages
npx convex run testing:reseedBank '{"email": "you@gmail.com", "withoutTreasuryPayment": true}'
npx convex run events:listForOwner '{"ownerId": "<id>"}'
npm run test:fixtures                           # extraction fixtures
```
