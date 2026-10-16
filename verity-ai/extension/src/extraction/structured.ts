import { normalizeNumber } from "./price";
import type { Cadence, EvidenceRef, PriceClaim } from "./schema";

const MAX_SCRIPT_CHARS = 200_000;
const MAX_QUOTE = 160;
const OFFER_TYPES = new Set(["Offer", "AggregateOffer"]);
const ITEM_TYPES = new Set(["Product", "Service", "SoftwareApplication", "WebApplication", "MobileApplication", "Course"]);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const typesOf = (n: Json): string[] => ([] as unknown[]).concat(n["@type"] ?? []).map(String);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function walk(node: unknown, visit: (n: Json) => void, depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit, depth + 1));
  if (!isObj(node)) return;
  visit(node);
  for (const v of Object.values(node)) if (typeof v === "object") walk(v, visit, depth + 1);
}

const CADENCE_UNIT: Record<string, { cadence: Cadence; detail: string | null }> = {
  MON: { cadence: "monthly", detail: null },
  ANN: { cadence: "annual", detail: null },
  YRS: { cadence: "annual", detail: null },
  WEE: { cadence: "other_recurring", detail: "weekly" },
  DAY: { cadence: "other_recurring", detail: "daily" },
};

export interface StructuredHit {
  name: string | null;
  nameQuote: EvidenceRef | null;
  prices: PriceClaim[];
}

/** Product/Offer data from JSON-LD. Each quote is an exact substring of the script text. */
export function readJsonLd(doc: Document): StructuredHit {
  const hit: StructuredHit = { name: null, nameQuote: null, prices: [] };
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  scripts.forEach((s, i) => {
    const raw = s.textContent ?? "";
    if (!raw || raw.length > MAX_SCRIPT_CHARS) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // malformed JSON-LD is common; other methods still run
    }
    const ref = `script[type="application/ld+json"]#${i + 1}`;
    const quoteOf = (re: RegExp): EvidenceRef | null => {
      const m = re.exec(raw);
      return m ? { quote: m[0].slice(0, MAX_QUOTE), source: "json_ld", ref, evidence_id: null } : null;
    };
    walk(data, (n) => {
      const types = typesOf(n);
      if (types.some((t) => ITEM_TYPES.has(t)) && typeof n.name === "string" && !hit.name) {
        hit.name = n.name.trim().slice(0, 200);
        hit.nameQuote = quoteOf(new RegExp(`"name"\\s*:\\s*"${escapeRe(n.name)}"`));
      }
      if (!types.some((t) => OFFER_TYPES.has(t))) return;
      const spec = isObj(n.priceSpecification) ? n.priceSpecification : null;
      const rawPrice = n.price ?? n.lowPrice ?? spec?.price;
      if (rawPrice === undefined || rawPrice === null) return;
      const amount = normalizeNumber(String(rawPrice).trim());
      if (amount === null) return;
      const currencyRaw = String(n.priceCurrency ?? spec?.priceCurrency ?? "").toUpperCase();
      const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : null;
      const refQty = spec && isObj(spec.referenceQuantity) ? spec.referenceQuantity.unitCode : undefined;
      const unit = String(refQty ?? spec?.unitCode ?? "").toUpperCase();
      const cad = CADENCE_UNIT[unit] ?? { cadence: "unknown" as Cadence, detail: null };
      const q = quoteOf(new RegExp(`"(?:price|lowPrice)"\\s*:\\s*"?${escapeRe(String(rawPrice))}"?`));
      if (!q) return;
      hit.prices.push({
        amount,
        currency,
        currency_symbol: null,
        currency_ambiguous: currency === null,
        cadence: cad.cadence,
        cadence_detail: cad.detail,
        role: "unknown",
        original_text: q.quote,
        methods: ["json_ld"],
        evidence: [q],
      });
    });
  });
  return hit;
}

const meta = (doc: Document, key: string): string | null => {
  const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`);
  const v = el?.getAttribute("content")?.trim();
  return v ? v : null;
};

/** Open Graph / product meta tags: a lower-trust fallback. */
export function readMeta(doc: Document): StructuredHit {
  const hit: StructuredHit = { name: null, nameQuote: null, prices: [] };
  const title = meta(doc, "og:title");
  if (title) {
    hit.name = title.slice(0, 200);
    hit.nameQuote = { quote: `og:title=${title}`.slice(0, MAX_QUOTE), source: "meta_tags", ref: 'meta[property="og:title"]', evidence_id: null };
  }
  const amountKey = ["product:price:amount", "og:price:amount"].find((k) => meta(doc, k));
  if (amountKey) {
    const rawAmt = meta(doc, amountKey)!;
    const amount = normalizeNumber(rawAmt);
    const cur = meta(doc, amountKey.replace("amount", "currency"))?.toUpperCase() ?? "";
    if (amount !== null) {
      const currency = /^[A-Z]{3}$/.test(cur) ? cur : null;
      const q: EvidenceRef = { quote: `${amountKey}=${rawAmt}`, source: "meta_tags", ref: `meta[property="${amountKey}"]`, evidence_id: null };
      hit.prices.push({
        amount, currency, currency_symbol: null, currency_ambiguous: currency === null,
        cadence: "unknown", cadence_detail: null, role: "unknown", original_text: q.quote, methods: ["meta_tags"], evidence: [q],
      });
    }
  }
  return hit;
}
