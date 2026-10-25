/**
 * Points the team's Telegram bot at one Convex deployment.
 *
 *   npm run telegram:webhook -- https://<deployment>.convex.site          # secrets from your dev deployment's env
 *   npm run telegram:webhook -- https://<deployment>.convex.site --prod   # secrets from production's env
 *
 * There's one bot for the whole team, so its webhook points at one deployment at
 * a time. Calls setWebhook with url = <site>/telegram/webhook and the deployment's
 * TELEGRAM_WEBHOOK_SECRET (Telegram sends it back in X-Telegram-Bot-Api-Secret-Token),
 * then prints getWebhookInfo. TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are
 * read from the Convex env (or from your shell, if set there); neither is printed.
 */
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const site = args.find((a) => a.startsWith("https://"))?.replace(/\/$/, "");
const prod = args.includes("--prod");
if (!site) {
  console.error("Usage: npm run telegram:webhook -- https://<deployment>.convex.site [--prod]");
  process.exit(1);
}

function convexEnv(name: string): string {
  if (process.env[name]) return process.env[name]!;
  try {
    const value = execSync(`npx convex env get ${name}${prod ? " --prod" : ""}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (value) return value;
  } catch {}
  console.error(`${name} isn't set on the ${prod ? "production" : "dev"} deployment (npx convex env set ${name} ...${prod ? " --prod" : ""})`);
  process.exit(1);
}

const token = convexEnv("TELEGRAM_BOT_TOKEN");
const secret = convexEnv("TELEGRAM_WEBHOOK_SECRET");
const api = (method: string) => `https://api.telegram.org/bot${token}/${method}`;

async function main() {
  const set = await fetch(api("setWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${site}/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: true, // don't replay messages sent while the webhook pointed elsewhere
    }),
  });
  console.log("setWebhook:", JSON.stringify(await set.json()));
  const info = await fetch(api("getWebhookInfo"));
  console.log("getWebhookInfo:", JSON.stringify(await info.json(), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
