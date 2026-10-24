import { playbookSchema } from "./schema";

export const irsCp14 = playbookSchema.parse({
  docType: "IRS_CP14",
  title: "IRS balance due notice",
  whatItMeans:
    "The IRS says a balance is due on a tax return you filed. The notice shows the amount due and the date to pay by. Penalties and interest keep growing until the balance is paid.",
  keyFacts: [
    "The notice shows the amount due and a pay-by date.",
    "Penalties and interest keep growing until the balance is paid.",
    "You can pay in full or set up a payment plan at irs.gov/paymentplan.",
    "If you disagree or already paid, call the number on the notice.",
    "IRS business line: 800-829-4933.",
  ],
  options: [
    { id: "pay", when: "The amount is right, it hasn't been paid, and the account can cover it.", proposedActionType: "pay_bill" },
    { id: "payment_plan", when: "The amount is right but the owner can't pay it all now (irs.gov/paymentplan).", proposedActionType: "owner_task" },
    { id: "already_paid", when: "The bank shows a matching payment already made. Call the number on the notice; don't pay again.", proposedActionType: "owner_task" },
    { id: "dispute", when: "The owner disagrees with the amount. Call the number on the notice.", proposedActionType: "owner_task" },
  ],
  escalateIf: [
    "The owner disagrees with the tax amount itself, not just whether it was paid.",
    "Several notices for the same period, or a later notice that mentions collection.",
  ],
  glossary: [
    { en: "balance due", es: "saldo adeudado" },
    { en: "penalty", es: "multa" },
    { en: "interest", es: "intereses" },
    { en: "payment plan", es: "plan de pagos" },
    { en: "notice", es: "aviso" },
  ],
  sources: [
    "https://www.irs.gov/individuals/understanding-your-cp14-notice",
    "https://www.irs.gov/payments",
  ],
});
