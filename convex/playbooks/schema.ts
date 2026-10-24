import { z } from "zod";

// Official playbooks (brief Section 3). Facts come only from the listed sources;
// anything missing is written as "TODO: verify", never invented.

export const PLAYBOOK_DOC_TYPES = ["IRS_CP14", "IRS_972CG", "COUNTY_HEALTH_INSPECTION"] as const;
export type PlaybookDocType = (typeof PLAYBOOK_DOC_TYPES)[number];

export const playbookSchema = z.object({
  docType: z.enum(PLAYBOOK_DOC_TYPES),
  title: z.string(),
  whatItMeans: z.string(),
  keyFacts: z.array(z.string()),
  options: z.array(
    z.object({
      id: z.string(),
      when: z.string(),
      proposedActionType: z
        .enum(["pay_bill", "owner_task", "create_document", "send_email"])
        .nullable(),
    }),
  ),
  escalateIf: z.array(z.string()),
  glossary: z.array(z.object({ en: z.string(), es: z.string() })),
  sources: z.array(z.string().url()),
});

export type Playbook = z.infer<typeof playbookSchema>;
