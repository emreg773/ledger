# Dev setup (shared Convex deployment)

Both tracks use one shared Convex **cloud dev deployment**, so actions, cases and events written by one track are visible to the other.

**Deployment:** `dev:fast-fish-37` (team `emreg`, project `ledger`), URL https://fast-fish-37.convex.cloud

## First-time link (done once, by Track A)

```bash
npx convex login                 # opens a browser; log in with the team account
npx convex dev --configure=new   # create project "ledger" in the team; choose a cloud dev deployment
                                 # answer No to "link your existing deployment" and to "Set up Convex AI files"
npx convex env set ANTHROPIC_API_KEY sk-ant-...
npx convex env set NESSIE_MODE mock          # or "live" with NESSIE_API_KEY set
npm run reset                    # María, her thread, and her (mock) bank data
```

Then invite the other developer to the Convex team (dashboard, Team settings, Members).

## Joining (Track B)

```bash
npx convex login
npx convex dev --configure=existing   # pick team, project "ledger", then the shared dev deployment
npm run dev                           # http://localhost:3000
```

`npx convex dev` writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into `.env.local`. Secrets (`ANTHROPIC_API_KEY`, `NESSIE_API_KEY`) live in the deployment env, not in `.env.local`.

**Careful:** on a shared deployment, `npx convex dev` pushes *your* working tree. Keep `main` merged into your branch before running it, or you'll overwrite the other track's functions.

## Common commands

```bash
npm run reset                    # wipe María's thread, documents, cases, actions, tasks, events; re-seed
npm run seed                     # seed only if no owner exists
npm run test:fixtures            # extraction fixtures
npx convex run events:listRecentForOwner '{"ownerId": "<id>"}'
npx convex run testing:recentMessages '{"count": 4}'
```
