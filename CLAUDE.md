# Instructions for Claude

Read [AGENTS.md](AGENTS.md) too (Next.js notes).

## Deploying production

- **Don't use GitHub Actions to deploy unless the user explicitly asks for it in this conversation.** That means: don't run or re-run the "Deploy production" workflow (`gh workflow run`, `gh run rerun`, the Actions tab), and don't add or re-enable automatic triggers (`push`, `pull_request`, schedules) in `.github/workflows/deploy.yml`.
- **Merging to `main` doesn't deploy.** Don't merge a PR in order to deploy it.
- **To deploy when asked:** from an up-to-date `main` (or the branch the user names), run `npx vercel deploy --prod` from the repo root. The build runs `npx convex deploy` first, so the Convex backend ships too. See README, "Deploy".
- **Say which commit was deployed,** and that production is shared by the whole team.
