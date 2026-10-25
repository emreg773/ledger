// Business or personal, for Google Calendar events (googleCalendar.ts).
// The home calendar shows business events by default (owners.calendarFilter).
// Of those, compliance events (deadlines, filings, permits) can get Telegram
// nudges (calendarCompliance.ts). Decided by rules on the title, not by AI:
// events never go to Anthropic.

/** Lowercase, without accents, so "Inspección" matches "inspeccion". */
const fold = (s: string) =>
  s.toLocaleLowerCase("en-US").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

// Words that mark a small business's events, in English, Spanish and Turkish
// (folded). Matched as word starts, so "deliver" covers "delivery".
const BUSINESS_WORDS = [
  // en
  "invoice", "payment", "pay ", "tax", "irs", "accountant", "cpa", "bookkeep", "payroll", "supplier",
  "vendor", "deliver", "order", "inventory", "stock", "restock", "shipment", "pickup", "inspect",
  "health dept", "permit", "license", "licence", "renewal", "insurance", "rent", "lease", "landlord",
  "bank", "loan", "meeting", "client", "customer", "catering", "shift", "staff", "employee", "hiring",
  "interview", "staff training", "maintenance", "repair", "plumber", "electrician", "pest", "hood clean",
  "equipment", "quarterly", "deadline", "due", "filing", "hearing", "sba", "farmers market", "booth",
  // es
  "factura", "pago", "impuesto", "contador", "nomina", "proveedor", "entrega", "pedido", "inventario",
  "inspeccion", "permiso", "licencia", "renovacion", "seguro", "renta", "alquiler", "banco", "prestamo",
  "reunion", "cliente", "turno", "empleado", "mantenimiento", "reparacion", "plazo",
  "vence",
  // tr
  "fatura", "odeme", "vergi", "muhasebe", "maas", "bordro", "tedarik", "teslimat", "siparis", "stok",
  "envanter", "denetim", "teftis", "ruhsat", "lisans", "yenileme", "sigorta", "kira", "banka", "kredi",
  "toplanti", "musteri", "vardiya", "personel", "calisan", "bakim", "tamir", "ekipman", "son gun",
  "beyanname",
].map(fold);

// Business words that name a deadline or an obligation to a government office
// (folded). A staff meeting or a delivery is business, but not compliance.
const COMPLIANCE_WORDS = [
  // en
  "tax", "irs", "permit", "license", "licence", "renewal", "inspect", "health dept", "insurance",
  "filing", "deadline", "due", "hearing", "quarterly",
  // es
  "impuesto", "inspeccion", "permiso", "licencia", "renovacion", "seguro", "plazo", "vence",
  // tr
  "vergi", "denetim", "teftis", "ruhsat", "lisans", "yenileme", "sigorta", "son gun", "beyanname",
].map(fold);

/** The title as " word word ", folded, for word-start matching. */
const words = (title: string) => ` ${fold(title).replace(/[^\p{L}\p{N}]+/gu, " ")} `;

/** True when the title has a business word or a word of the business's own name. */
export function isBusinessEvent(title: string, businessName: string): boolean {
  const t = words(title);
  if (BUSINESS_WORDS.some((w) => t.includes(` ${w.trim()}`))) return true;
  const own = fold(businessName)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3 && !["the", "and", "llc", "inc"].includes(w));
  return own.some((w) => t.includes(` ${w}`));
}

/** True when the title names a deadline or an obligation (taxes, permits, inspections, filings). */
export function isComplianceEvent(title: string): boolean {
  const t = words(title);
  return COMPLIANCE_WORDS.some((w) => t.includes(` ${w.trim()}`));
}
