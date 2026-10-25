// General due dates for the forms Ledger's supported letters are about.
// Hardcoded on purpose. Rules checked on irs.gov (Oct 24, 2026):
// - Form 941: due the last day of the month after each quarter; a Saturday,
//   Sunday or legal holiday moves it to the next business day.
//   https://www.irs.gov/taxtopics/tc758, https://www.irs.gov/publications/p509
// - Form 1099-NEC: due January 31 to recipients and the IRS, with the same
//   weekend and holiday rule.
//   https://www.irs.gov/instructions/i1099mec

export type GeneralDate = {
  key: string;
  date: string; // ISO
  form: "941" | "1099-NEC";
  period: string; // English, for the title
  link: string;
};

export const GENERAL_DATES: GeneralDate[] = [
  // Oct 31, 2026 is a Saturday.
  { key: "general|941|2026Q3", date: "2026-11-02", form: "941", period: "Q3 2026", link: "https://www.irs.gov/forms-pubs/about-form-941" },
  // Jan 31, 2027 is a Sunday.
  { key: "general|941|2026Q4", date: "2027-02-01", form: "941", period: "Q4 2026", link: "https://www.irs.gov/forms-pubs/about-form-941" },
  { key: "general|1099NEC|2026", date: "2027-02-01", form: "1099-NEC", period: "2026", link: "https://www.irs.gov/forms-pubs/about-form-1099-nec" },
  { key: "general|941|2027Q1", date: "2027-04-30", form: "941", period: "Q1 2027", link: "https://www.irs.gov/forms-pubs/about-form-941" },
  // Jul 31, 2027 is a Saturday.
  { key: "general|941|2027Q2", date: "2027-08-02", form: "941", period: "Q2 2027", link: "https://www.irs.gov/forms-pubs/about-form-941" },
];
