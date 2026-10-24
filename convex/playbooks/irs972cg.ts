import { playbookSchema } from "./schema";

export const irs972cg = playbookSchema.parse({
  docType: "IRS_972CG",
  title: "IRS proposed penalty for information returns",
  whatItMeans:
    "The IRS is proposing a penalty because information returns, such as Form 1099, were filed late or incorrectly. It is a proposal: you must respond within 45 days of the notice date. If you don't respond, the IRS assesses the penalty.",
  keyFacts: [
    "This is a proposed penalty for information returns (such as Form 1099) filed late or incorrectly.",
    "Respond within 45 days of the notice date.",
    "Options: agree and pay, partly agree, or disagree with a signed statement explaining reasonable cause.",
    "If there's no response, the IRS assesses the penalty.",
    "For returns due in 2026: $60 per return if filed within 30 days late, $130 if more than 30 days late but by August 1, $340 after August 1.",
  ],
  options: [
    { id: "agree", when: "The returns were late and there was no reasonable cause. Agree and pay.", proposedActionType: "pay_bill" },
    { id: "partly_agree", when: "Only some of the returns were late or wrong.", proposedActionType: "create_document" },
    { id: "disagree", when: "There was a reasonable cause for the late filing. Send a signed statement explaining it.", proposedActionType: "create_document" },
  ],
  escalateIf: [
    "The penalty is large or covers many returns.",
    "The owner wants to argue reasonable cause and the reason is complicated.",
  ],
  glossary: [
    { en: "proposed penalty", es: "multa propuesta" },
    { en: "information return", es: "declaración informativa" },
    { en: "reasonable cause", es: "causa razonable" },
    { en: "signed statement", es: "declaración firmada" },
    { en: "assess", es: "imponer (la multa)" },
  ],
  sources: ["https://www.irs.gov/payments/information-return-penalties"],
});
