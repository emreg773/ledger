import { v } from "convex/values";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { internalMutation } from "./_generated/server";
import { caseVerification } from "./schema";
import { logEvent } from "./events";
import type { Extraction } from "./extraction";
import { findAgency, officialPhone, OFFICIAL_CONTACTS, type OfficialContact } from "./officialContacts";

// verify_sender (brief Section 4). Rule-based, no LLM call: the printed contacts
// are matched against the official list, and red flags make it suspicious.

export type Verdict = "verified" | "suspicious" | "unverified";

export type SenderCheck = {
  verdict: Verdict;
  reasons: string[];
  /** The agency the letter names, or the one it seems to impersonate. */
  agency?: string;
  /** The official number to give the owner (never the one printed on a suspicious letter). */
  officialPhone?: string;
};

const RISKY_PAYMENT_METHODS: { pattern: RegExp; label: string }[] = [
  { pattern: /gift ?cards?|itunes|google play|steam card|prepaid card/i, label: "gift cards" },
  { pattern: /bitcoin|crypto|btc|ethereum|usdt|tether/i, label: "cryptocurrency" },
  { pattern: /wire|western union|moneygram/i, label: "a wire transfer" },
  { pattern: /zelle|venmo|cash ?app|paypal/i, label: "a payment app" },
];

/**
 * Keywords in a printed agency name that imitate a known agency without matching
 * it, e.g. "Internal Revenue Tax Enforcement Division". Only the name is checked:
 * a real state tax letter mentions "tax" too and must not count as imitating the IRS.
 */
const IMPERSONATION_HINTS: { pattern: RegExp; agency: string }[] = [
  { pattern: /internal revenue|\birs\b|treasury/i, agency: "IRS" },
  { pattern: /alameda/i, agency: "Alameda County Environmental Health" },
  { pattern: /oakland/i, agency: "City of Oakland" },
];

const GOVERNMENT_DOMAIN = /\.(gov|us)$/;

function nationalDigits(phone: string): string | undefined {
  return parsePhoneNumberFromString(phone, "US")?.nationalNumber;
}

function domainOf(value: string): string | undefined {
  const host = value.includes("@") ? value.split("@").pop() : value.replace(/^[a-z]+:\/\//i, "").split("/")[0];
  return host?.toLowerCase().replace(/^www\./, "").trim() || undefined;
}

const isAgencyDomain = (domain: string, contact: OfficialContact) =>
  contact.domains.some((d) => domain === d || domain.endsWith(`.${d}`));

export function checkSender(x: Extraction): SenderCheck {
  const reasons: string[] = [];
  const flags: string[] = [];

  const named = findAgency(x.issuer.agencyName);
  const imitated = named
    ? undefined
    : OFFICIAL_CONTACTS.find(
        (c) => c.agency === IMPERSONATION_HINTS.find((h) => h.pattern.test(x.issuer.agencyName))?.agency,
      );
  const impersonated = named ?? imitated;
  if (imitated) {
    flags.push(`"${x.issuer.agencyName}" looks like the ${imitated.agency} but isn't its real name`);
  } else if (!named) {
    // A real agency we don't have contacts for yet (another county, a state
    // agency). Not a red flag: the result is "unverified" unless other flags fire.
    reasons.push(`"${x.issuer.agencyName}" isn't on Ledger's list of agencies yet, so its contacts couldn't be checked`);
  }

  // Phones
  let contactMatches = 0;
  for (const phone of x.printedContacts.phones) {
    const digits = nationalDigits(phone);
    if (!digits) continue;
    if (digits.slice(0, 3) === "555" || digits.slice(3, 6) === "555") {
      flags.push(`Phone ${phone} is a 555 number, which agencies don't use`);
      continue;
    }
    const official = impersonated?.phones.find((p) => nationalDigits(p.number) === digits);
    if (named && official) {
      contactMatches++;
      reasons.push(`Phone ${phone} matches the official ${named.agency} number (${official.label})`);
    } else if (impersonated) {
      reasons.push(`Phone ${phone} isn't on the official ${impersonated.agency} list`);
    }
  }

  // Websites and emails
  for (const site of x.printedContacts.websites) {
    const domain = domainOf(site);
    if (!domain || !named) continue;
    if (isAgencyDomain(domain, named)) {
      contactMatches++;
      reasons.push(`Website ${site} is on the official ${named.agency} domain`);
    }
  }
  for (const email of x.printedContacts.emails) {
    const domain = domainOf(email);
    if (!domain) continue;
    const agency = impersonated ?? named;
    if (agency && isAgencyDomain(domain, agency)) {
      if (named) contactMatches++;
      reasons.push(`Email ${email} is on the official ${agency.agency} domain`);
    } else if (!agency && GOVERNMENT_DOMAIN.test(domain)) {
      reasons.push(`Email ${email} is on a government domain`);
    } else {
      flags.push(`Email ${email} isn't from ${agency ? `an official ${agency.agency}` : "a government"} domain`);
    }
  }

  // How it wants to be paid, and pressure
  const methods = x.requestedPaymentMethods ?? [];
  for (const { pattern, label } of RISKY_PAYMENT_METHODS) {
    const hit = methods.find((m) => pattern.test(m));
    if (hit) flags.push(`Asks for payment by ${label} ("${hit}"); agencies never ask for this`);
  }
  for (const tactic of x.pressureTactics ?? []) {
    flags.push(`Pressure tactic: "${tactic}"`);
  }

  const verdict: Verdict = flags.length > 0 ? "suspicious" : contactMatches > 0 ? "verified" : "unverified";
  if (verdict === "unverified") reasons.push("No printed phone, website or email matched the official list");
  return {
    verdict,
    reasons: verdict === "suspicious" ? [...flags, ...reasons] : reasons,
    agency: impersonated?.agency,
    officialPhone: officialPhone(impersonated),
  };
}

/** Saves the result on the document's case (opening one for a suspicious letter) and logs it. */
export const saveSenderCheck = internalMutation({
  args: {
    documentId: v.id("documents"),
    verification: caseVerification,
    agency: v.optional(v.string()),
  },
  handler: async (ctx, { documentId, verification, agency }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    let caseId = doc.caseId;
    // Unknown documents don't open a case, but a suspected scam gets one so the
    // warning and the reasons show on the card and in the case list.
    if (!caseId && verification.verdict === "suspicious") {
      const existing = await ctx.db
        .query("cases")
        .withIndex("by_document", (q) => q.eq("documentId", documentId))
        .first();
      caseId =
        existing?._id ??
        (await ctx.db.insert("cases", {
          ownerId: doc.ownerId,
          documentId,
          docType: (doc.extraction as Extraction | undefined)?.docType ?? "UNKNOWN",
          title: agency ? `Suspicious letter claiming to be from the ${agency}` : "Suspicious letter",
          status: "open",
          createdAt: Date.now(),
        }));
      await ctx.db.patch(documentId, { caseId });
      if (!existing) {
        await logEvent(ctx, {
          ownerId: doc.ownerId,
          caseId,
          type: "case_opened",
          summary: "Opened case: Suspicious letter",
          data: { documentId },
        });
      }
    }
    if (caseId) await ctx.db.patch(caseId, { verification });

    const label = { verified: "Sender verified", suspicious: "Sender suspicious", unverified: "Sender not verified" }[
      verification.verdict
    ];
    await logEvent(ctx, {
      ownerId: doc.ownerId,
      caseId,
      type: "sender_verified",
      summary: `${label}: ${verification.reasons.slice(0, 3).join("; ")}`,
      data: { documentId, ...verification },
    });
    return { caseId: caseId ?? null };
  },
});
