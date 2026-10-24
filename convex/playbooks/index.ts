import { countyHealthInspection } from "./countyHealthInspection";
import { irs972cg } from "./irs972cg";
import { irsCp14 } from "./irsCp14";
import type { Playbook } from "./schema";

const PLAYBOOKS: Record<string, Playbook> = {
  IRS_CP14: irsCp14,
  IRS_972CG: irs972cg,
  COUNTY_HEALTH_INSPECTION: countyHealthInspection,
};

export function getPlaybook(docType: string): Playbook | undefined {
  return PLAYBOOKS[docType];
}
