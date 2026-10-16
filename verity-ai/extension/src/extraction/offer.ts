import { findPrices } from "./price";
import {
  EXTRACTION_SCHEMA_VERSION,
  type EvidenceRef,
  type ExtractionMethod,
  type PriceClaim,
  type StructuredOffer,
  type TermClaim,
  type TextBlock,
  type TrialClaim,
} from "./schema";
import { readJsonLd, readMeta } from "./structured";
import { TERM_RULES, cadenceNear, findTrial, roleFor } from "./terms";

const MAX_QUOTE = 200;
const THRESHOLD = /\b(?:over|above|orders?\s+of|spend|min(?:imum)?\.?|more\s+than)\s*$/i;
const unknownTerm = (): TermClaim => ({ state: "unknown", value: null, evidence: null });

/** Sentence-ish segments; each is an exact substring of the block text. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z$€£₹¥(])/).map((s) => s.trim()).filter(Boolean);
}

function visibleRef(block: TextBlock, sentence: string): EvidenceRef {
  return { quote: sentence.slice(0, MAX_QUOTE), source: "visible_text", ref: block.selector, evidence_id: block.id };
}


function mergePrice(into: PriceClaim, other: PriceClaim): void {
  for (const m of other.methods) if (!into.methods.includes(m)) into.methods.push(m);
  for (const e of other.evidence) if (!into.evidence.some((x) => x.quote === e.quote)) into.evidence.push(e);
  if (into.currency === null && other.currency) {
    into.currency = other.currency;
    into.currency_ambiguous = false;
  }
  if (into.cadence === "unknown" && other.cadence !== "unknown") {
    into.cadence = other.cadence;
    into.cadence_detail = other.cadence_detail;
  }
  if (into.role === "unknown" && other.role !== "unknown") into.role = other.role;
}

/** Collapse duplicates (same amount, currency, cadence, role) while keeping every evidence reference. */
export function dedupe(prices: PriceClaim[]): PriceClaim[] {
  const out: PriceClaim[] = [];
  for (const p of prices) {
    const loose = out.find(
      (o) =>
        o.amount === p.amount &&
        (o.currency === p.currency || o.currency === null || p.currency === null) &&
        (o.cadence === "unknown" || p.cadence === "unknown" || o.cadence === p.cadence) &&
        (o.role === "unknown" || p.role === "unknown" || o.role === p.role),
    );
    if (loose) mergePrice(loose, p);
    else out.push({ ...p, methods: [...p.methods], evidence: [...p.evidence] });
  }
  return out;
}

export interface OfferInput {
  doc: Document;
  blocks: TextBlock[];
  url: string;
  hostname: string;
  title: string;
  now?: Date;
}

export function extractOffer({ doc, blocks, url, hostname, title, now = new Date() }: OfferInput): StructuredOffer {
  const ld = readJsonLd(doc);
  const mt = readMeta(doc);

  const candidates: PriceClaim[] = [...ld.prices];
  const terms: Partial<Record<(typeof TERM_RULES)[number]["key"], TermClaim>> = {};
  let trial: TrialClaim = { ...unknownTerm(), duration: null, unit: null };

  for (const block of blocks) {
    for (const s of sentences(block.text)) {
      for (const m of findPrices(s)) {
        // "free shipping over $50" is a threshold, not a charge.
        if (THRESHOLD.test(s.slice(Math.max(0, m.index - 20), m.index))) continue;
        const cad = cadenceNear(s, m.index, m.end);
        candidates.push({
          amount: m.amount,
          currency: m.currency,
          currency_symbol: m.symbol,
          currency_ambiguous: m.ambiguous,
          cadence: cad.cadence,
          cadence_detail: cad.detail,
          role: roleFor(s, m.index, m.end),
          original_text: m.raw,
          methods: ["visible_text"],
          evidence: [visibleRef(block, s)],
        });
      }
      if (trial.state === "unknown") {
        const t = findTrial(s);
        if (t.state === "stated") {
          trial = { state: "stated", value: t.value, duration: t.duration, unit: t.unit, evidence: visibleRef(block, s) };
        }
      }
      for (const rule of TERM_RULES) {
        if (!terms[rule.key] && rule.test.test(s)) {
          terms[rule.key] = { state: "stated", value: rule.value(s), evidence: visibleRef(block, s) };
        }
      }
    }
  }
  candidates.push(...mt.prices);

  const prices = dedupe(candidates);
  // Shipping, fee and tax amounts are terms, not plan prices.
  const planPrices = prices.filter((p) => !["shipping", "fee", "tax"].includes(p.role));
  const headline = planPrices.filter((p) => p.role !== "renewal" && p.role !== "introductory");
  const ambiguous = new Set(headline.map((p) => `${p.amount}|${p.currency ?? p.currency_symbol}`)).size > 1;
  const intro = planPrices.find((p) => p.role === "introductory") ?? null;
  const renewal = planPrices.find((p) => p.role === "renewal") ?? null;

  const recurring = new Set(planPrices.filter((p) => p.cadence !== "unknown" && p.cadence !== "one_time").map((p) => p.cadence));
  const intervalPrice = planPrices.find((p) => p.cadence === "monthly" || p.cadence === "annual" || p.cadence === "other_recurring");
  const billing_interval: TermClaim =
    recurring.size === 1 && intervalPrice
      ? {
          state: "stated",
          value: intervalPrice.cadence === "other_recurring" ? intervalPrice.cadence_detail : intervalPrice.cadence,
          evidence: intervalPrice.evidence[0] ?? null,
        }
      : unknownTerm();

  const h1Text = (doc.querySelector("h1")?.textContent ?? "").replace(/\s+/g, " ").trim();
  const name: TermClaim = ld.name
    ? { state: "stated", value: ld.name, evidence: ld.nameQuote }
    : h1Text && h1Text.length <= 150
      ? { state: "stated", value: h1Text, evidence: { quote: h1Text.slice(0, MAX_QUOTE), source: "visible_text", ref: "h1", evidence_id: null } }
      : mt.name
        ? { state: "stated", value: mt.name, evidence: mt.nameQuote }
        : unknownTerm();

  const methods = new Set<ExtractionMethod>();
  for (const p of prices) p.methods.forEach((m) => methods.add(m));
  if (name.evidence) methods.add(name.evidence.source);

  const limitations = ["Only text visible on this page was read; checkout steps and other pages may show additional fees or terms."];
  if (ambiguous) limitations.push("Several different prices were found and may belong to different plans; none was chosen for you.");
  if (planPrices.some((p) => p.currency === null)) limitations.push("Some amounts use a shared symbol (such as $), so the currency is not confirmed.");

  let confidence: StructuredOffer["confidence"];
  let reason: string;
  const corroborated = planPrices.some((p) => p.methods.length > 1);
  const allStated = planPrices.length > 0 && planPrices.every((p) => p.cadence !== "unknown" && p.currency !== null);
  if (planPrices.length === 0) {
    confidence = "low";
    reason = "No price was found on the page.";
  } else if (ambiguous && !planPrices.some((p) => p.cadence !== "unknown")) {
    confidence = "low";
    reason = "Multiple prices were found without a clear billing period.";
  } else if (!ambiguous && (corroborated || allStated)) {
    confidence = "high";
    reason = corroborated ? "Price confirmed by both structured data and visible text." : "Price, currency and billing period are all stated.";
  } else {
    confidence = "medium";
    reason = "A price was found, but its currency, billing period or plan is not fully stated.";
  }

  return {
    schema_version: EXTRACTION_SCHEMA_VERSION,
    extracted_at: now.toISOString(),
    page: { url, hostname, title },
    name,
    prices,
    ambiguous_prices: ambiguous,
    trial,
    introductory_price: intro,
    renewal_price: renewal,
    billing_interval,
    renewal_language: terms.renewal_language ?? unknownTerm(),
    shipping: terms.shipping ?? unknownTerm(),
    setup_fee: terms.setup_fee ?? unknownTerm(),
    mandatory_fees: terms.mandatory_fees ?? unknownTerm(),
    taxes: terms.taxes ?? unknownTerm(),
    cancellation: terms.cancellation ?? unknownTerm(),
    refund: terms.refund ?? unknownTerm(),
    auto_renewal: terms.auto_renewal ?? unknownTerm(),
    minimum_commitment: terms.minimum_commitment ?? unknownTerm(),
    confidence,
    confidence_reason: reason,
    methods_used: [...methods],
    limitations,
  };
}
