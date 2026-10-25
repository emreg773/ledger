/**
 * Fixture test harness.
 *
 *   npm run test:fixtures              # photos + PDFs
 *   npm run test:fixtures -- cp14      # only files whose path contains "cp14"
 *
 * A key with "+" sends several files as the pages of one document, as the web
 * composer does when the owner attaches more than one file.
 *
 * Uploads each fixture to Convex storage, runs the internal extraction action
 * (testing:extractStorageId) via `npx convex run`, and compares the result with
 * the expected values from fixtures/README.md (encoded below by hand).
 * Needs `npx convex dev` running and ANTHROPIC_API_KEY set in Convex.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Extraction } from "../convex/extraction";

type Check = { name: string; pass: (x: Extraction) => boolean };

const digits = (s: string) => s.replace(/\D/g, "");
const hasPhone = (x: Extraction, phone: string) =>
  x.printedContacts.phones.some((p) => digits(p).endsWith(digits(phone)));
const countSeverity = (x: Extraction, s: string) =>
  x.inspection?.violations.filter((v) => v.severity === s).length ?? 0;

const is = <K extends keyof Extraction>(field: K, value: Extraction[K]): Check => ({
  name: `${String(field)} = ${JSON.stringify(value)}`,
  pass: (x) => x[field] === value,
});

const CP14: Check[] = [
  is("docType", "IRS_CP14"),
  is("amountDue", 1240.18),
  is("deadline", "2026-11-02"),
  { name: "phone 800-829-4933", pass: (x) => hasPhone(x, "800-829-4933") },
  { name: "confidence >= 0.6", pass: (x) => x.overallConfidence >= 0.6 },
];
const N972CG: Check[] = [
  is("docType", "IRS_972CG"),
  is("amountDue", 520),
  is("deadline", "2026-11-19"),
  { name: "phone 800-829-4933", pass: (x) => hasPhone(x, "800-829-4933") },
  { name: "EIN masked to 6789", pass: (x) => x.identifiersMasked.some((i) => i.includes("6789")) },
];
const INSPECTION: Check[] = [
  is("docType", "COUNTY_HEALTH_INSPECTION"),
  { name: "placard yellow", pass: (x) => x.inspection?.placardColor === "yellow" },
  { name: "score 77", pass: (x) => x.inspection?.score === 77 },
  { name: "reinspection 2026-10-28", pass: (x) => x.inspection?.reinspectionDate === "2026-10-28" },
  { name: "3 major", pass: (x) => countSeverity(x, "major") === 3 },
  { name: "7 minor", pass: (x) => countSeverity(x, "minor") === 7 },
];

const FIXTURES: Record<string, Check[]> = {
  "photos/cp14_photo.jpg": CP14,
  "pdf/cp14.pdf": CP14,
  "pdf/972cg.pdf": N972CG,
  // Single pages of a 2-page letter: only check what that page can show.
  "photos/972cg_photo_page1.jpg": [is("docType", "IRS_972CG")],
  "photos/972cg_photo_page2.jpg": [],
  // Both pages sent together: one document, so the full-letter checks apply.
  "photos/972cg_photo_page1.jpg+photos/972cg_photo_page2.jpg": N972CG,
  "photos/inspection_yellow_photo.jpg": INSPECTION,
  "pdf/inspection_yellow.pdf": INSPECTION,
  "photos/scam_irs_photo.jpg": [
    {
      name: "not CP14/CP504/972CG",
      pass: (x) => !["IRS_CP14", "IRS_CP504", "IRS_972CG"].includes(x.docType),
    },
  ],
  "photos/menu_photo.jpg": [is("docType", "UNKNOWN")],
};

// Applies to every fixture: the fake EIN 12-3456789 must never appear in full.
const NO_FULL_EIN: Check = {
  name: "no full EIN",
  pass: (x) => !/12-?3456789/.test(JSON.stringify(x)),
};

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

function convexRun(fn: string, args: object = {}): unknown {
  // Escaped double quotes work in both cmd.exe and POSIX shells.
  const json = JSON.stringify(args).replace(/"/g, '\\"');
  const out = execSync(`npx convex run ${fn} "${json}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(out);
}

async function upload(file: string) {
  const mimeType = MIME[path.extname(file)];
  const uploadUrl = convexRun("testing:uploadUrl") as string;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: readFileSync(path.join("fixtures", file)),
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: string };
  return { storageId, mimeType };
}

async function runFixture(file: string, checks: Check[]) {
  const [first, ...extraPages] = await Promise.all(file.split("+").map(upload));
  const extraction = convexRun("testing:extractStorageId", {
    ...first,
    ...(extraPages.length ? { extraPages } : {}),
  }) as Extraction;
  const results = [...checks, NO_FULL_EIN].map((c) => {
    let pass = false;
    try {
      pass = c.pass(extraction);
    } catch {
      pass = false;
    }
    return { check: c.name, pass };
  });
  return { file, extraction, results };
}

async function main() {
  const filter = process.argv[2];
  const files = Object.keys(FIXTURES).filter((f) => !filter || f.includes(filter));
  const report = [];
  let failed = 0;

  for (const file of files) {
    process.stdout.write(`\n${file}\n`);
    try {
      const r = await runFixture(file, FIXTURES[file]);
      for (const { check, pass } of r.results) {
        if (!pass) failed++;
        process.stdout.write(`  ${pass ? "PASS" : "FAIL"}  ${check}\n`);
      }
      const x = r.extraction;
      process.stdout.write(
        `  got: ${x.docType}, amount=${x.amountDue}, deadline=${x.deadline}, confidence=${x.overallConfidence}\n`,
      );
      report.push(r);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      const reason = msg.split("\n").find((l) => l.includes("Uncaught")) ?? msg.split("\n")[0];
      process.stdout.write(`  ERROR ${reason}\n`);
      report.push({ file, error: msg });
    }
  }

  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/fixtures.json", JSON.stringify(report, null, 2));
  process.stdout.write(`\n${failed === 0 ? "ALL PASSED" : `${failed} check(s) failed`}. Full output: test-results/fixtures.json\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
