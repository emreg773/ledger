import { playbookSchema } from "./schema";

// Only facts the team verified against the sources below.
export const irsCp504 = playbookSchema.parse({
  docType: "IRS_CP504",
  title: "IRS notice of intent to levy",
  whatItMeans:
    "A CP504 (CP504B for businesses) is the IRS's notice of intent to levy under Internal Revenue Code section 6331(d). The IRS sends it when a balance is still unpaid. If the balance isn't paid, the IRS may levy (take) the state tax refund; before levying other property, it must first send a separate final notice with the right to a hearing.",
  keyFacts: [
    "A CP504 (CP504B for businesses) is a notice of intent to levy under Internal Revenue Code section 6331(d).",
    "The IRS sends it when a balance is still unpaid.",
    "If the balance isn't paid, the IRS may levy the state tax refund.",
    "Before levying other property, the IRS must first send a separate final notice with the right to a hearing.",
    "If the balance was already paid or a payment plan exists, still call the number on the notice so the account reflects it.",
    "IRS business line: 800-829-4933.",
  ],
  options: [
    { id: "pay", when: "The balance is right, it hasn't been paid, and the account can cover it.", proposedActionType: "pay_bill" },
    { id: "payment_plan", when: "The balance is right but the owner can't pay it all now (irs.gov/paymentplan).", proposedActionType: "owner_task" },
    { id: "already_paid", when: "The bank shows the payment, or a payment plan exists: call the number on the notice so the account reflects it. Don't pay again.", proposedActionType: "owner_task" },
  ],
  escalateIf: [
    "A separate final notice with the right to a hearing arrives.",
    "The IRS can't find a payment the bank shows was made.",
  ],
  glossary: [
    { en: "levy", es: "embargo" },
    { en: "final notice", es: "aviso final" },
    { en: "notice of intent to levy", es: "aviso de intención de embargo" },
    { en: "balance due", es: "saldo adeudado" },
    { en: "payment plan", es: "plan de pagos" },
  ],
  sources: [
    "https://www.irs.gov/individuals/understanding-your-cp504-notice",
    "https://www.taxpayeradvocate.irs.gov/notices/notice-cp504/",
  ],
});
