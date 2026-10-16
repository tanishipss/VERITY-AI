import { describe, expect, it } from "vitest";
import { compareReports } from "../src/services/compare";
import type { Finding, Money, Report } from "../src/types";

function report(id: string, o: { first?: Money; rec?: Money; findings?: Partial<Finding>[] }): Report {
  return {
    id, analyzedAt: "2026-10-15T00:00:00Z", url: `https://${id}.example`,
    evidence: [{ id: "ev_001", kind: "visible_text", text: "Cancel anytime from settings." }],
    result: {
      schema_version: "1.0", status: "complete",
      offer: { name: id, merchant: `${id}.example`, price_items: [] },
      cost_summary: {
        first_30_days: o.first ?? null, recurring_monthly: o.rec ?? null,
        annualized_estimate: null, annual_billed: null, annual_monthly_equivalent: null, assumptions: [],
      },
      findings: (o.findings ?? []).map((f, i) => ({
        id: `f${i}`, category: "cancellation", severity: "caution", label: "Cancellation language found",
        explanation: "", evidence_ids: ["ev_001"], confidence: "high", kind: "supported_fact", ...f,
      })) as Finding[],
      unknowns: [], limitations: [], next_steps: [],
    },
  };
}
const usd = (a: string): Money => ({ amount: a, currency: "USD" });
const row = (rows: ReturnType<typeof compareReports>, key: string) => rows.find((r) => r.key === key)!;

describe("compareReports", () => {
  it("marks the lower amount per row, with no overall winner", () => {
    const rows = compareReports(report("a", { rec: usd("19.99") }), report("b", { rec: usd("9.99") }));
    expect(row(rows, "recurring").b.lower).toBe(true);
    expect(row(rows, "recurring").a.lower).toBeUndefined();
    expect(rows.every((r) => !("score" in r))).toBe(true);
  });

  it("does not compare different currencies", () => {
    const rows = compareReports(report("a", { rec: usd("10") }), report("b", { rec: { amount: "8", currency: "GBP" } }));
    const r = row(rows, "recurring");
    expect(r.a.lower).toBeUndefined();
    expect(r.b.lower).toBeUndefined();
    expect(r.note).toMatch(/not compared or converted/);
  });

  it("shows 'Not available' for missing amounts and 'Not found' for missing terms", () => {
    const rows = compareReports(report("a", { rec: usd("5") }), report("b", {}));
    expect(row(rows, "recurring").b.text).toBe("Not available");
    expect(row(rows, "refund").a.text).toBe("Not found on this page");
    expect(row(rows, "refund").a.available).toBe(false);
  });

  it("carries the supporting snippet for a found term", () => {
    const rows = compareReports(report("a", { findings: [{}] }), report("b", {}));
    expect(row(rows, "cancellation").a.evidence).toBe("Cancel anytime from settings.");
    expect(row(rows, "cancellation").b.available).toBe(false);
  });

  it("does not mark equal amounts as lower", () => {
    const rows = compareReports(report("a", { rec: usd("5") }), report("b", { rec: usd("5.00") }));
    expect(row(rows, "recurring").a.lower).toBeUndefined();
    expect(row(rows, "recurring").b.lower).toBeUndefined();
  });
});
