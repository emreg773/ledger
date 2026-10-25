// Business or personal, for Google Calendar events (googleCalendar.ts).
// The home calendar shows business events by default (owners.calendarFilter).
// Decided by rules on the title, not by AI: events never go to Anthropic.

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

/** True when the title has a business word or a word of the business's own name. */
export function isBusinessEvent(title: string, businessName: string): boolean {
  const t = ` ${fold(title).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  if (BUSINESS_WORDS.some((w) => t.includes(` ${w.trim()}`))) return true;
  const own = fold(businessName)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3 && !["the", "and", "llc", "inc"].includes(w));
  return own.some((w) => t.includes(` ${w}`));
}
