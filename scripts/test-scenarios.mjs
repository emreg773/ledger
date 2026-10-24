/**
 * Step 2 acceptance scenarios (brief Section 11), end to end on the linked deployment.
 *
 *   npm run test:scenarios              # all scenarios (about 10 minutes)
 *   npm run test:scenarios -- 972       # only scenarios whose name contains "972"
 *
 * Each scenario runs admin:resetDemo, uploads a fixture through the real intake,
 * waits for the agent, and checks cases, actions, events and the reply. It leaves
 * the last scenario's data behind, so run npm run reset before a demo.
 * Needs npx convex dev running, ANTHROPIC_API_KEY, and NESSIE_MODE (mock or live).
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const FILTER = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(fn, args = {}) {
  const json = JSON.stringify(args).replace(/"/g, '\\"');
  const out = execSync(`npx convex run ${fn} "${json}"`, {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : null;
}

const MIME = { ".jpg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf" };

async function upload(file) {
  const snap = run("testing:snapshot");
  const mimeType = MIME[path.extname(file)];
  const url = run("documents:generateUploadUrl");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: readFileSync(path.join(REPO, "fixtures", file)),
  });
  const { storageId } = await res.json();
  run("intake:ingestWebUpload", { ownerId: snap.ownerId, storageId, mimeType });
}

/** Waits until the agent has answered: no pending messages, newest is an assistant reply. */
async function settle(minAssistant, timeoutMs = 240_000) {
  const start = Date.now();
  let stable = 0;
  while (Date.now() - start < timeoutMs) {
    await sleep(5000);
    const s = run("testing:snapshot", { messages: 30 });
    const busy =
      s.messages.some((m) => m.status === "pending" || m.status === "streaming") ||
      s.documents.some((d) => d.status === "received" || d.status === "extracting");
    const assistants = s.messages.filter((m) => m.role === "assistant" && m.text.trim()).length;
    if (!busy && assistants >= minAssistant) {
      if (++stable >= 2) return s;
    } else stable = 0;
  }
  throw new Error("timed out waiting for the agent");
}

const replies = (s) => s.messages.filter((m) => m.role === "assistant" && m.text.trim()).map((m) => m.text);
const report = [];
function check(scenario, name, pass, detail = "") {
  report.push({ scenario, name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const scenarios = {
  async cp14_paid() {
    run("admin:resetDemo");
    await upload("photos/cp14_photo.jpg");
    const s = await settle(1);
    const c = s.cases[0];
    check("cp14_paid", "verdict verified", c?.verification?.verdict === "verified", c?.verification?.reasons.join("; "));
    check("cp14_paid", "bank finds Oct 2 payment", c?.bankCheck?.matches[0]?.date === "2026-10-02");
    const task = s.actions.find((a) => a.type === "owner_task");
    check("cp14_paid", "owner_task with call script", !!task?.payload?.callScript?.en && !!task?.payload?.callScript?.translated);
    check("cp14_paid", "no pay_bill", !s.actions.some((a) => a.type === "pay_bill"));
    const text = replies(s).join("\n");
    check("cp14_paid", "reply has action marker", task ? text.includes(`[action:${task._id}]`) : false);
    for (const t of ["sender_verified", "playbook_loaded", "bank_checked", "action_proposed"]) {
      check("cp14_paid", `event ${t}`, s.events.some((e) => e.type === t));
    }
    console.log("\n--- reply ---\n" + text + "\n-------------");

    // Re-upload the same letter: still one case, no second card.
    await upload("photos/cp14_photo.jpg");
    const s2 = await settle(2);
    check("cp14_paid", "re-upload keeps one case", s2.cases.length === 1, `${s2.cases.length} case(s)`);
    check("cp14_paid", "re-upload: still one owner_task", s2.actions.filter((a) => a.type === "owner_task").length === 1);
    return s2;
  },

  async cp14_unpaid() {
    run("admin:resetDemo", { withoutTreasuryPayment: true });
    await upload("photos/cp14_photo.jpg");
    const s = await settle(1);
    const pay = s.actions.find((a) => a.type === "pay_bill");
    check("cp14_unpaid", "pay_bill for $1,240.18", pay?.payload?.amount === 1240.18, JSON.stringify(pay?.payload));
    console.log("\n--- reply ---\n" + replies(s).join("\n") + "\n-------------");
    return s;
  },

  async n972_approve() {
    run("admin:resetDemo");
    await upload("pdf/972cg.pdf");
    const s = await settle(1);
    const c = s.cases[0];
    check("972_approve", "verdict verified", c?.verification?.verdict === "verified", c?.verification?.reasons.join("; "));
    const pay = s.actions.find((a) => a.type === "pay_bill");
    check("972_approve", "pay_bill for $520", pay?.payload?.amount === 520);
    const text = replies(s).join("\n");
    check("972_approve", "asks about a reason for filing late", /\?/.test(text) && /1099/.test(text));
    console.log("\n--- reply ---\n" + text + "\n-------------");
    if (!pay) return s;
    run("actions:approve", { actionId: pay._id });
    const s2 = await settle(2);
    const done = s2.actions.find((a) => a._id === pay._id);
    check("972_approve", "action executed", done?.status === "executed", JSON.stringify(done?.result));
    const last = replies(s2).at(-1) ?? "";
    const conf = done?.result?.confirmationId ?? "???";
    check("972_approve", "confirmation reply has 4417 and confirmation", last.includes("4417") && last.includes(conf), last);
    try {
      run("actions:approve", { actionId: pay._id });
      check("972_approve", "second approve throws", false);
    } catch {
      check("972_approve", "second approve throws", true);
    }
    return s2;
  },

  async n972_reject() {
    run("admin:resetDemo");
    await upload("pdf/972cg.pdf");
    const s = await settle(1);
    const pay = s.actions.find((a) => a.type === "pay_bill");
    if (!pay) return check("972_reject", "pay_bill proposed", false);
    run("actions:reject", { actionId: pay._id });
    const s2 = await settle(2);
    const last = replies(s2).at(-1) ?? "";
    check("972_reject", "reply offers the dispute path", /disput|impugn|causa razonable|reasonable cause/i.test(last), last);
    return s2;
  },

  async scam() {
    run("admin:resetDemo");
    await upload("photos/scam_irs_photo.jpg");
    const s = await settle(1);
    const c = s.cases[0];
    check("scam", "verdict suspicious", c?.verification?.verdict === "suspicious", c?.verification?.reasons.join("; "));
    check("scam", "no pay_bill", !s.actions.some((a) => a.type === "pay_bill"));
    const text = replies(s).join("\n");
    check("scam", "reply gives 800-829-4933", text.includes("800-829-4933"));
    console.log("\n--- reply ---\n" + text + "\n-------------");
    return s;
  },

  async inspection() {
    run("admin:resetDemo");
    await upload("photos/inspection_yellow_photo.jpg");
    const s = await settle(1);
    check("inspection", "no proposals", s.actions.length === 0);
    const text = replies(s).join("\n");
    check("inspection", "mentions score 77", text.includes("77"));
    check("inspection", "mentions reinspection date (28)", /28/.test(text));
    console.log("\n--- reply ---\n" + text + "\n-------------");
    return s;
  },
};

const out = {};
for (const [name, fn] of Object.entries(scenarios)) {
  if (FILTER && !name.includes(FILTER)) continue;
  console.log(`\n== ${name}`);
  try {
    out[name] = await fn();
  } catch (e) {
    check(name, "ran without error", false, String(e.message ?? e).split("\n").slice(0, 3).join(" "));
  }
}
const failed = report.filter((r) => !r.pass).length;
console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} check(s) failed`} (${report.length} checks)`);
mkdirSync("test-results", { recursive: true });
writeFileSync("test-results/scenarios.json", JSON.stringify({ report, out }, null, 2));
console.log("Full output: test-results/scenarios.json");
process.exit(failed === 0 ? 0 : 1);
