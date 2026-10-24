# Ledger: Build Brief, Step 1 of 8

You are building **Ledger** at a hackathon (Cal Hacks 13.0). The submission deadline is **Sunday Oct 25, 2026, 9:00 AM PT**, so favor working, simple code over clever code. This file gives you all the context you need. Read it fully before writing code.

---

## 1. What Ledger is

Ledger is a multilingual AI **agent** for immigrant small business owners (restaurants, cafes, corner shops) who have limited English and don't know US compliance rules. Ledger notices incoming government documents, figures out what they mean, does the follow-up work itself through connected digital tools, and asks the owner only to approve.

Ledger has three features. **We are building only Answer.**
- **Open:** permits and licenses (later)
- **Answer:** anything the government sends: IRS letters, health inspections, city fines (**now**)
- **Shield:** contracts, loans, lawyer letters, fake invoices (later)

Demo community: Spanish-speaking restaurant owners in Oakland, CA (Alameda County). Default owner language: **Spanish**. The app must work for any language the owner picks.

## 2. The agent principle (most important section)

Ledger **does the work**. The owner only snaps a photo, taps Approve, or signs. Never design a flow that hands the owner a list of instructions when Ledger could do the step itself.

Every action Ledger takes has an **autonomy level**:

| Level | Meaning | Examples |
|---|---|---|
| `auto` | Ledger does it without asking | Read documents, verify the sender, check bank history, research, draft replies, create PDF/Word files, add calendar events, set follow-ups |
| `one_tap` | Ledger prepares it fully, then executes after the owner taps Approve | Send an email, send a WhatsApp message to someone other than the owner, pay a bill |
| `human_only` | Only the owner can do it; Ledger prepares everything | Log into identity-verified government accounts, sign statements, mail a paper letter, make a phone call |

Ledger only acts through **digital integrations**:
- Gmail: read incoming notices, send emails
- WhatsApp (Twilio): message the owner and their staff, receive photos
- Documents: generate PDF and Word files
- Google Calendar: deadlines and follow-ups
- Capital One Nessie (sandbox bank): check payment history, pay after approval

No physical mail, no phone calls, no browser automation.

## 3. What Answer does (full feature, built over 8 steps)

Supported documents:
- IRS: tax bill (CP14), final notice before collection (CP504), proposed penalty (972CG)
- County: health inspection report and placard (green, yellow, red)
- City: fines, code violations, late business license notices
- Anything else: classify as `UNKNOWN`, say so honestly, suggest a professional

Full behavior:
1. **Notices arrive on their own** (Gmail inbox watch) or by photo (web or WhatsApp)
2. **Investigates without asking:** reads the document, verifies the sender against official contacts, checks Nessie for a matching past payment and the current balance, adds the deadline to Calendar
3. **Explains** in the owner's language, then proposes what it will do
4. **Prepares the response:** a reply as PDF (to send) and Word (to edit), with proof attached
   - If the agency accepts email: sends from Gmail after one tap
   - If not (the IRS generally expects mail, fax, or phone): sends the owner the finished, ready-to-sign PDF on WhatsApp, plus a short call script if a call is needed
   - If paying is the answer: pays through Nessie after one tap
5. **Inspections:** turns violations into tasks, WhatsApps each staff member in their own language, verifies their photo proofs, creates a bilingual kitchen checklist PDF, then emails the inspector after one tap
6. **Follow-ups:** scheduled jobs check Gmail and Nessie for replies and chase if nothing arrives

## 4. Roadmap (do NOT build future steps now)

1. **Step 1 (this file):** scaffold, full schema, channel-agnostic document intake, agent with `read_document`, web chat UI
2. Step 2: playbooks, sender verification, Nessie bank check, explanation, the action/approval system with Approve buttons
3. Step 3: PDF and Word generation (replies, checklists, case summaries)
4. Step 4: Gmail inbox watch and sending after approval
5. Step 5: WhatsApp channel for the owner, staff tasks, photo proof
6. Step 6: inspection mode end to end
7. Step 7: Calendar, follow-up jobs, audit dashboard
8. Step 8: polish, demo seed data, README

Design Step 1 so these slot in without rewrites. That's why the full schema is defined now, and why document intake must not depend on the web UI.

## 5. Tech stack (fixed, do not substitute)

- **Frontend:** Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui, lucide-react, react-markdown, browser-image-compression, Convex React client
- **Backend:** Convex (database, functions, file storage, scheduler, cron jobs, HTTP endpoints)
- **Agent:** `@convex-dev/agent` (Convex Agent component), Vercel AI SDK (`ai`) with `@ai-sdk/anthropic`, model **`claude-sonnet-5-5`**, `zod`
- **Later steps (do not install yet):** `date-fns`, `libphonenumber-js`, `pdf-lib`, `docx`, `googleapis`, `twilio`, `@convex-dev/workflow`. Libraries that need Node.js will run in Convex Node actions (files starting with `"use node"`).
- **Hosting:** Vercel (frontend), Convex Cloud (backend)
- **No auth for now.** One hardcoded demo owner.

### Verify APIs against current docs
The Convex Agent component and the AI SDK change between versions (for example, `maxSteps` versus `stopWhen: stepCountIs(n)`, and tool schemas as `args` versus `inputSchema`). **Do not guess APIs.** Check:
- https://docs.convex.dev/agents (overview, tools, threads, messages, human-in-the-loop)
- https://www.npmjs.com/package/@convex-dev/agent
- AI SDK docs for the Anthropic provider, image and file message parts, and structured output (`generateObject` or current equivalent)
- https://docs.claude.com/en/api/overview (vision and PDF support)

If `claude-sonnet-5-5` is not accepted by the provider, stop and report it. Don't silently switch models. Pin exact versions in `package.json` once things work.

## 6. Agent instructions (use as the agent's system prompt)

```
You are Ledger, a compliance agent for small business owners in the US.

How you work:
- You do the work yourself. Investigate, prepare, and draft before you ask the owner anything.
- Ask the owner only to approve an action, to sign something, or for information you cannot get yourself.
- Never give the owner a to-do list for steps you could do with your tools.

How you talk:
- Always reply in the owner's preferred language: {language}.
- Write like a short WhatsApp message: plain words, short sentences, the key number and date first.

Accuracy and safety:
- Only state facts from the extracted document data or official playbooks. Never invent amounts,
  dates, phone numbers, email addresses, websites, or legal rules.
- If a field is missing or low-confidence, say you're not sure and ask for a clearer photo.
- Never send, pay, or message anyone other than the owner without explicit owner approval.
- Never ask the owner to type a full SSN, EIN, or bank account number.
- Audit letters, lawsuits, and unsupported documents: say so clearly and recommend a licensed
  professional (CPA, enrolled agent, or lawyer).
- End explanations of legal or tax documents with one short line saying this is not legal or tax advice.
```

## 7. Data model (define the full schema now)

The Agent component stores threads and messages itself. These are our app tables. Add indexes for the obvious lookups (by owner, by case, by status).

- **owners:** `name`, `businessName`, `preferredLanguage` (BCP-47, e.g. `"es"`), `city`, `county`, `state`, `email?`, `whatsappNumber?`, `agentThreadId`
- **staff** (Step 5): `ownerId`, `name`, `role`, `preferredLanguage`, `whatsappNumber`
- **documents:** `ownerId`, `storageId`, `mimeType`, `source`: `"web_upload" | "gmail" | "whatsapp"`, `sourceRef?` (e.g. Gmail message ID), `receivedAt`, `extraction?` (Section 8), `status`: `"received" | "extracting" | "extracted" | "failed"`, `error?`
- **cases:** `ownerId`, `documentId`, `docType`, `title`, `amountDue?`, `deadline?` (ISO date), `status`: `"open" | "awaiting_owner" | "in_progress" | "resolved" | "escalated"`, `createdAt`
- **actions** (proposed and executed actions; this is how approvals work, Step 2):
  `caseId`, `ownerId`, `type`: `"send_email" | "send_whatsapp" | "pay_bill" | "create_document" | "add_calendar_event" | "schedule_followup"`, `autonomyLevel`: `"auto" | "one_tap" | "human_only"`, `status`: `"proposed" | "approved" | "rejected" | "executed" | "failed"`, `summary` (one human-readable line), `payload` (object), `result?` (object), `createdAt`, `decidedAt?`, `executedAt?`
- **tasks** (Step 6, staff work items): `caseId`, `ownerId`, `staffId?`, `description`, `descriptionTranslated?`, `status`: `"open" | "sent" | "proof_received" | "verified" | "rejected"`, `proofStorageId?`, `verificationNote?`
- **generatedDocuments** (Step 3): `caseId`, `ownerId`, `kind`: `"pdf" | "docx"`, `purpose` (e.g. `"dispute_letter"`, `"kitchen_checklist"`), `storageId`, `createdAt`
- **events** (audit log, append-only): `ownerId`, `caseId?`, `type` (e.g. `"document_received"`, `"document_extracted"`, `"tool_called"`, `"action_proposed"`, `"action_executed"`), `summary` (readable reason), `data?`, `at`

Log an **event** for every meaningful step from day one. The audit trail is a key judging point.

## 8. The `read_document` tool

When a document arrives, the agent calls `read_document`. The tool:
1. Loads the file from Convex storage (JPEG, PNG, WebP, or PDF; multi-page PDFs are expected)
2. Calls Claude through the AI SDK's structured output with the file and the zod schema below
3. Saves the result to `documents.extraction`, creates a `cases` row (unless `docType` is `UNKNOWN`), logs events, and returns the extraction to the agent

### Extraction schema (zod)

```ts
docType: enum [
  "IRS_CP14", "IRS_CP504", "IRS_972CG",
  "COUNTY_HEALTH_INSPECTION",
  "CITY_FINE", "CITY_CODE_VIOLATION", "CITY_LICENSE_LATE_NOTICE",
  "UNKNOWN"
]
issuer: { agencyName: string, level: "federal" | "state" | "county" | "city" | "unknown" }
noticeCode?: string           // e.g. "CP14", as printed
noticeDate?: string           // ISO date
taxFormAndPeriod?: string     // e.g. "Form 941, period ending 2026-06-30"
amountDue?: number            // USD
deadline?: string             // ISO date; empty if none printed
recipientName?: string
recipientBusiness?: string
printedContacts: {
  phones: string[]
  emails: string[]
  websites: string[]
  mailingAddresses: string[]
}
acceptedResponseMethods: ("online" | "email" | "phone" | "mail" | "fax" | "in_person")[]
                              // only methods the document itself mentions; drives what Ledger can do digitally
paymentInstructions?: string  // how the letter says to pay, briefly
mainIssue: string             // one sentence, English
inspection?: {                // only for COUNTY_HEALTH_INSPECTION
  placardColor?: "green" | "yellow" | "red"
  score?: number
  inspectionDate?: string
  reinspectionDate?: string
  violations: {
    code?: string
    description: string
    severity: "major" | "minor" | "unknown"
    correctedOnSite?: boolean
    points?: number
  }[]
}
identifiersMasked: string[]   // any SSN/EIN/account numbers seen, masked to last 4, e.g. "EIN ending 6789"
documentLanguage: string
fieldConfidence: Record<string, number>  // 0 to 1 per extracted field
overallConfidence: number               // 0 to 1
```

Rules for the extraction prompt:
- Extract only what is printed. Leave fields empty rather than guess.
- **Never return a full SSN, EIN, or bank account number.** Mask to the last 4 digits.
- Suspicious letters (gift-card demands, threats, fake agency names) must not be classified as a real notice type just because they mention the IRS. If no real notice code is printed, use `UNKNOWN`. Step 2 adds the full scam check.
- If `overallConfidence < 0.6`, the agent asks for a clearer photo instead of explaining.

## 9. Channel-agnostic intake (important for Steps 4 and 5)

Build one internal entry point that every channel will call:

```
ingestDocument({ ownerId, storageId, mimeType, source, sourceRef? })
```

It creates the `documents` row, logs `document_received`, and starts the agent on the owner's thread so it calls `read_document`. Run the agent asynchronously with the Convex scheduler so intake returns immediately. The web upload is just the first caller. Gmail (Step 4) and WhatsApp (Step 5) will call the same function. **Do not put intake logic in React components or in a web-only mutation.**

The agent's replies live in the owner's thread. The web UI reads them now; in Step 5 they will also be delivered over WhatsApp.

## 10. Step 1 scope

### Build
1. **Scaffold:** Next.js + Convex (Convex Next.js template), Tailwind, shadcn/ui. Install the Step 1 stack only. Register the Agent component in `convex/convex.config.ts`.
2. **Schema:** all tables from Section 7, with indexes.
3. **Demo owner seed:** a mutation creating owner "María López", business "Taquería La Esquina", language `es`, Oakland, Alameda County, CA, plus their agent thread. Run it once with `npx convex run`.
4. **Web upload:** compress images with browser-image-compression (about 1600 px on the long side), upload to Convex storage through an upload URL, then call `ingestDocument` with `source: "web_upload"`. PDFs upload unchanged. Max 10 MB.
5. **Agent:** a Convex Agent with the Section 6 instructions and one tool, `read_document`. For now, its reply after reading is a short summary: what the document is, who sent it, the amount, and the deadline. Proposals and actions come in Step 2.
6. **Chat UI (mobile-first, one page):**
   - Header with business name and a language selector (es, en, zh, vi, tr, ko) that updates `owners.preferredLanguage`
   - Live message list rendered with react-markdown
   - Text input plus an upload button (`accept="image/*,application/pdf"`, camera allowed on mobile)
   - Under each processed document, a collapsible card "What Ledger read" showing extracted fields and confidence
   - A small "Ledger is working..." state while the agent runs
7. **Test harness:** an internal Convex action that runs extraction on a given storage ID and prints the JSON, plus a script that uploads every file in `fixtures/` and prints a pass/fail comparison against the expected values in `fixtures/README.md`.
8. **Env:** `ANTHROPIC_API_KEY` set in Convex (`npx convex env set ANTHROPIC_API_KEY ...`). Never commit keys. Add `.env.example`.

### Fixtures
The team has sample documents in `ledger-fixtures.zip`. Unzip it into `fixtures/` at the repo root. It contains `photos/`, `clean/`, `pdf/`, `source/`, and a `README.md` with the expected extraction values for every file. **All fixtures are fake and watermarked SAMPLE.**

### Do NOT build yet
Playbooks, scam check, Nessie, actions and Approve buttons, PDF/Word generation, Gmail, WhatsApp, Calendar, cron jobs, staff tasks, dashboard, auth, voice.

## 11. Acceptance criteria

- [ ] `npm run dev` plus `npx convex dev` run locally with no errors
- [ ] `photos/cp14_photo.jpg` gives `IRS_CP14`, amount `1240.18`, deadline `2026-11-02`, phone `800-829-4933`, and a Spanish reply
- [ ] `pdf/972cg.pdf` (2 pages) gives `IRS_972CG`, amount `520`, deadline `2026-11-19`; the full fake EIN on page 2 appears only masked (`6789`)
- [ ] `photos/inspection_yellow_photo.jpg` gives `COUNTY_HEALTH_INSPECTION`, yellow, score 77, reinspection `2026-10-28`, 3 major plus 7 minor violations
- [ ] `photos/scam_irs_photo.jpg` is **not** classified as CP14, CP504, or 972CG
- [ ] `photos/menu_photo.jpg` gives `UNKNOWN` and an honest "I can't help with this" reply
- [ ] `photos/cp14_blurry_photo.jpg` gives a request for a clearer photo
- [ ] Switching the language to English makes the next reply English
- [ ] `ingestDocument` works when called directly with `npx convex run` (no UI involved)
- [ ] `events` has readable rows for received, tool called, and extracted
- [ ] No full SSN or EIN appears anywhere in stored data or replies

## 12. When you finish

Write `STEP1_REPORT.md` at the repo root with:
- What you built (files and functions, briefly)
- Exact package versions
- The fixture test results (pass/fail per file)
- Any deviation from this brief and why
- Known bugs or open questions
- How to run the app and the test harness

Keep the code simple and commented where intent isn't obvious. Prefer small, readable Convex functions over abstractions.
