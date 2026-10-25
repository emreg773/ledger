import type { Infer } from "convex/values";
import { OFFICIAL_CONTACTS, findAgency } from "./officialContacts";
import type { emailCategory } from "./schema";

// How Ledger sorts an email (gmail.ts). Rules, not AI: explainable, free, and
// email content never goes to Anthropic unless Ledger reads an attachment.

type Category = Infer<typeof emailCategory>;

const GOV_SUFFIX = /(\.gov|\.mil|\.gov\.[a-z]{2}|\.ca\.us|\.[a-z]{2}\.us)$/;
const OFFICIAL_DOMAINS = OFFICIAL_CONTACTS.flatMap((c) => c.domains);
// Words a fake "agency" email leans on.
const AGENCY_WORDS =
  /\b(irs|internal revenue|treasury|tax (enforcement|department|division)|franchise tax board|edd|department of|county of|city of|health department|social security)\b/i;
const PRESSURE =
  /(gift card|bitcoin|crypto|wire transfer|zelle|arrest|warrant|suspend|lawsuit|final (notice|warning)|immediate(ly)? (pay|action)|within 24 hours|act now)/i;
const BUSINESS =
  /\b(invoice|license|permit|inspection|tax|penalty|notice|payment due|past due|citation|fine|renewal|bill|statement|audit|compliance)\b/i;

const isGovDomain = (domain: string) =>
  GOV_SUFFIX.test(domain) || OFFICIAL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));

/** Sorts one email. Pure, so the rules are easy to check and explain. */
export function classify(e: {
  fromName: string;
  fromDomain: string;
  subject: string;
  snippet: string;
  newsletter: boolean;
}): { category: Category; reasons: string[] } {
  const text = `${e.subject} ${e.snippet}`;
  if (isGovDomain(e.fromDomain)) {
    const agency = OFFICIAL_CONTACTS.find((c) => c.domains.some((d) => e.fromDomain === d || e.fromDomain.endsWith(`.${d}`)));
    return {
      category: "government",
      reasons: [agency ? `Sent from ${e.fromDomain}, an official ${agency.agency} domain` : `Sent from ${e.fromDomain}, a government domain`],
    };
  }
  const claimed = findAgency(`${e.fromName} ${e.subject}`);
  const soundsOfficial = claimed !== undefined || AGENCY_WORDS.test(`${e.fromName} ${e.subject}`);
  const pressure = text.match(PRESSURE)?.[0];
  if (soundsOfficial && (pressure || !e.newsletter)) {
    const reasons = [
      claimed
        ? `Says it's from the ${claimed.agency}, but was sent from ${e.fromDomain}, not ${claimed.domains[0]}`
        : `Sounds like a government agency, but was sent from ${e.fromDomain}, not a government domain`,
    ];
    if (pressure) reasons.push(`Pressure or unusual payment: "${pressure}"`);
    return { category: "suspicious", reasons };
  }
  if (pressure && !e.newsletter) {
    return { category: "suspicious", reasons: [`Pressure or unusual payment: "${pressure}"`] };
  }
  if (!e.newsletter && BUSINESS.test(text)) {
    return { category: "business", reasons: [`Mentions "${text.match(BUSINESS)![0].toLowerCase()}"`] };
  }
  return { category: "other", reasons: e.newsletter ? ["Newsletter or mailing list"] : [] };
}
