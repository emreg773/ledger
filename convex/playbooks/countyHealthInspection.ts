import { playbookSchema } from "./schema";

export const countyHealthInspection = playbookSchema.parse({
  docType: "COUNTY_HEALTH_INSPECTION",
  title: "Alameda County health inspection",
  whatItMeans:
    "The county inspected your restaurant and posted a color placard. Green means pass, yellow means conditional pass, and red means closure. A yellow placard stays posted until the reinspection, for at most about one week.",
  keyFacts: [
    "Green: pass.",
    "Yellow: conditional pass. A score of 75 to 79, or two or more major violations corrected during the inspection.",
    "Red: closure. A score below 75, or a major violation that couldn't be corrected.",
    "A yellow placard stays posted until reinspection, for at most about one week.",
    "Major violations are CDC risk factors; minor violations are retail practices.",
  ],
  options: [
    { id: "fix_before_reinspection", when: "Yellow placard: fix every violation before the reinspection date.", proposedActionType: null },
  ],
  escalateIf: ["Red placard (closure)."],
  glossary: [
    { en: "placard", es: "cartel (placa)" },
    { en: "conditional pass", es: "aprobado con condiciones" },
    { en: "major violation", es: "infracción grave" },
    { en: "minor violation", es: "infracción menor" },
    { en: "reinspection", es: "reinspección" },
  ],
  sources: ["https://health.alamedacountyca.gov/frequently-asked-questions-food-safety/"],
});
