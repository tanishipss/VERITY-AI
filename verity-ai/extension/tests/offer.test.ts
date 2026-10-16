import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { extractPage } from "../src/content/extract";
import { dedupe, extractOffer } from "../src/extraction/offer";
import { findPrices, normalizeNumber } from "../src/extraction/price";
import { EXTRACTION_SCHEMA_VERSION, type EvidenceRef, type StructuredOffer } from "../src/extraction/schema";
import { cadenceNear, findTrial } from "../src/extraction/terms";

const load = (name: string): StructuredOffer => {
  document.documentElement.innerHTML = readFileSync(join(__dirname, "fixtures", name), "utf8");
  const r = extractPage();
  const blocks = r.evidence.map((e) => ({ id: e.id, text: e.text, selector: r.sources?.[e.id] ?? null }));
  return extractOffer({
    doc: document,
    blocks,
    url: r.page.url,
    hostname: r.page.merchant_domain,
    title: r.page.title,
    now: new Date("2026-10-16T00:00:00Z"),
  });
};
const pageText = () => (document.documentElement.textContent ?? "").replace(/\s+/g, " ");

describe("number normalization", () => {
  it.each([
    ["19.99", "19.99"],
    ["1,299.00", "1299.00"],
    ["1.299,00", "1299.00"],
    ["19,99", "19.99"],
    ["1,299", "1299"],
    ["1 299,50", "1299.50"],
    ["1'299.50", "1299.50"],
    ["1,23,456.00", "123456.00"],
    ["5", "5"],
    ["12.5", "12.50"],
  ])("%s -> %s", (input, expected) => expect(normalizeNumber(input)).toBe(expected));

  it.each(["1,2,3", "12,34,5", "1.2.3.4x", "", ",99", "1,234,56789"])("rejects malformed %j", (input) => {
    expect(normalizeNumber(input)).toBeNull();
  });
});

describe("findPrices", () => {
  it("reads currency symbols and codes", () => {
    const p = findPrices("US$89.00, €9,99, 12 GBP, £5, ₹499, 20 EUR");
    expect(p.map((x) => [x.amount, x.currency])).toEqual([
      ["89.00", "USD"], ["9.99", "EUR"], ["12", "GBP"], ["5", "GBP"], ["499", "INR"], ["20", "EUR"],
    ]);
  });
  it("keeps bare $ and ¥ currency unknown", () => {
    const p = findPrices("$10 and ¥3,000");
    expect(p.map((x) => [x.currency, x.ambiguous])).toEqual([[null, true], [null, true]]);
    expect(p[1].amount).toBe("3000");
  });
  it("supports trailing symbols and keeps original text", () => {
    const [p] = findPrices("Nur 9,99 € pro Monat");
    expect(p).toMatchObject({ amount: "9.99", currency: "EUR", raw: "9,99 €" });
  });
  it("skips malformed amounts instead of guessing", () => {
    expect(findPrices("Total $1,2,3 today")).toEqual([]);
  });
});

describe("cadence and trials", () => {
  const cad = (s: string) => {
    const [m] = findPrices(s);
    return cadenceNear(s, m.index, m.end).cadence;
  };
  it("detects monthly, annual, other and one-time", () => {
    expect(cad("$12/month")).toBe("monthly");
    expect(cad("$12 per month")).toBe("monthly");
    expect(cad("$99/yr")).toBe("annual");
    expect(cad("$99 billed annually")).toBe("annual");
    expect(cad("$3 per week")).toBe("other_recurring");
    expect(cad("$89 one-time payment")).toBe("one_time");
  });
  it("leaves cadence unknown when unstated", () => expect(cad("Only $19 today")).toBe("unknown"));
  it("parses trials, including word numbers", () => {
    expect(findTrial("Start your 7-day free trial")).toMatchObject({ state: "stated", duration: 7, unit: "day" });
    expect(findTrial("Try it free for 14 days")).toMatchObject({ duration: 14, unit: "day" });
    expect(findTrial("one month free trial")).toMatchObject({ duration: 1, unit: "month" });
    expect(findTrial("No trial text here")).toMatchObject({ state: "unknown", duration: null });
  });
});

describe("fixtures", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "";
  });

  it("one-time product: JSON-LD corroborated by visible text", () => {
    const o = load("one-time.html");
    expect(o.schema_version).toBe(EXTRACTION_SCHEMA_VERSION);
    expect(o.name).toMatchObject({ state: "stated", value: "Trail Pack 30L" });
    expect(o.prices).toHaveLength(1);
    expect(o.prices[0]).toMatchObject({ amount: "89.00", currency: "USD", cadence: "one_time" });
    expect(o.prices[0].methods).toEqual(expect.arrayContaining(["json_ld", "visible_text"]));
    expect(o.shipping.value).toBe("free");
    expect(o.taxes.value).toBe("excluded");
    expect(o.refund.value).toBe("30 days");
    expect(o.confidence).toBe("high");
    expect(o.trial.state).toBe("unknown");
    expect(o.cancellation.state).toBe("unknown");
  });

  it("subscription: keeps both plans, does not pick one", () => {
    const o = load("subscription.html");
    expect(o.prices.map((p) => [p.amount, p.cadence]).sort()).toEqual([["12", "monthly"], ["99", "annual"]]);
    expect(o.ambiguous_prices).toBe(true);
    expect(o.billing_interval.state).toBe("unknown");
    expect(o.cancellation.value).toBe("anytime");
    expect(o.auto_renewal.state).toBe("stated");
    expect(o.minimum_commitment.state).toBe("stated");
    expect(o.prices.every((p) => p.currency === null && p.currency_ambiguous)).toBe(true);
  });

  it("trial offer: intro/renewal split, EUR decimal comma, structured cadence", () => {
    const o = load("trial.html");
    expect(o.trial).toMatchObject({ state: "stated", duration: 7, unit: "day" });
    expect(o.introductory_price).toMatchObject({ amount: "1", currency: "EUR" });
    expect(o.renewal_price).toMatchObject({ amount: "9.99", currency: "EUR", cadence: "monthly" });
    expect(o.renewal_price?.methods).toEqual(expect.arrayContaining(["json_ld", "visible_text"]));
    expect(o.billing_interval).toMatchObject({ state: "stated", value: "monthly" });
    expect(o.renewal_language.state).toBe("stated");
    expect(o.taxes.value).toBe("included");
  });

  it("poorly structured page: malformed JSON-LD ignored, ambiguity flagged, missing terms stay unknown", () => {
    const o = load("poor.html");
    expect(o.prices.map((p) => p.amount)).toEqual(expect.arrayContaining(["19", "29", "49", "123456.00", "3000"]));
    expect(o.prices.some((p) => p.amount === "123" || p.amount?.startsWith("12.34"))).toBe(false);
    expect(o.ambiguous_prices).toBe(true);
    expect(o.confidence).toBe("low");
    expect(o.refund.state).toBe("unknown");
    expect(o.cancellation).toEqual({ state: "unknown", value: null, evidence: null });
    expect(o.mandatory_fees.state).toBe("stated");
    expect(o.methods_used).not.toContain("json_ld");
  });

  it("retains evidence: quotes are short, exact page text, and linked to ids", () => {
    for (const f of ["one-time.html", "subscription.html", "trial.html"]) {
      const o = load(f);
      const text = pageText();
      const refs = [
        ...o.prices.flatMap((p) => p.evidence),
        ...[o.trial.evidence, o.refund.evidence, o.taxes.evidence].filter(Boolean),
      ] as EvidenceRef[];
      expect(refs.length).toBeGreaterThan(0);
      for (const e of refs) {
        expect(e.quote.length).toBeLessThanOrEqual(200);
        if (e.source !== "meta_tags") expect(text).toContain(e.quote);
        if (e.source === "visible_text") expect(e.evidence_id).toMatch(/^ev_\d{3}$/);
      }
    }
  });

  it("never reads form values or payment-looking text", () => {
    expect(JSON.stringify(load("one-time.html"))).not.toMatch(/4111/);
  });
});

describe("dedupe", () => {
  it("merges identical candidates and keeps distinct plans", () => {
    const base = {
      currency: "USD", currency_symbol: "$", currency_ambiguous: false, cadence: "monthly" as const,
      cadence_detail: null, role: "regular" as const, original_text: "$5", methods: ["visible_text" as const],
    };
    const ev = (q: string) => [{ quote: q, source: "visible_text" as const, ref: null, evidence_id: null }];
    const out = dedupe([
      { ...base, amount: "5", evidence: ev("a") },
      { ...base, amount: "5", evidence: ev("b") },
      { ...base, amount: "9", evidence: ev("c") },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].evidence).toHaveLength(2);
  });
});
