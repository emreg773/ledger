// Official contacts for the sender check (brief Section 4). Verified by the team;
// entries marked TODO: verify are listed but not yet confirmed on the agency's site.

export type OfficialContact = {
  agency: string;
  /** Lowercase substrings that identify this agency in a printed agency name. */
  nameMatches: string[];
  phones: { number: string; label: string; verified: boolean }[];
  domains: string[];
  address?: string;
};

export const OFFICIAL_CONTACTS: OfficialContact[] = [
  {
    agency: "IRS",
    nameMatches: ["internal revenue service", "department of the treasury", "irs"],
    phones: [
      { number: "800-829-4933", label: "Business and Specialty Tax Line", verified: true },
      // TODO: verify
      { number: "800-829-1040", label: "Individuals", verified: false },
    ],
    domains: ["irs.gov", "treasury.gov"],
  },
  {
    agency: "Alameda County Environmental Health",
    nameMatches: ["alameda county"],
    phones: [{ number: "(510) 567-6700", label: "Environmental Health", verified: true }],
    domains: ["acgov.org", "alamedacountyca.gov"],
    address: "1131 Harbor Bay Parkway, Alameda CA 94502",
  },
  {
    agency: "City of Oakland",
    nameMatches: ["city of oakland"],
    phones: [], // TODO: verify
    domains: ["oaklandca.gov"],
  },
];

/** The agency whose name appears in the printed agency name, if any. */
export function findAgency(agencyName: string): OfficialContact | undefined {
  const name = agencyName.toLowerCase();
  return OFFICIAL_CONTACTS.find((c) =>
    c.nameMatches.some((m) => (m === "irs" ? /\birs\b/.test(name) : name.includes(m))),
  );
}

/** The official phone to give the owner instead of a number printed on a suspicious letter. */
export function officialPhone(contact: OfficialContact | undefined): string | undefined {
  return contact?.phones.find((p) => p.verified)?.number;
}
