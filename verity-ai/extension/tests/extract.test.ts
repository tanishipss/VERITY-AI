import { beforeEach, describe, expect, it } from "vitest";
import { extractPage } from "../src/content/extract";
import { reportToText } from "../src/services/format";
import type { Report } from "../src/types";

describe("extractPage", () => {
  beforeEach(() => {
    document.title = "Example subscription";
    document.body.innerHTML = `
      <h1>Example Plan</h1>
      <p>Introductory offer: $5 for the first month</p>
      <p>Then $19.99/month. Cancel anytime.</p>
      <p>Unrelated marketing copy about our team.</p>
      <input type="password" value="hunter2 $5 cancel">
      <div>Card number: 4111 1111 1111 1111 refund</div>
      <script>var x = "$99 cancel";</script>`;
  });

  it("collects price and terms text with stable ids", () => {
    const { evidence, page } = extractPage();
    expect(evidence.map((e) => e.text)).toEqual([
      "Introductory offer: $5 for the first month",
      "Then $19.99/month. Cancel anytime.",
    ]);
    expect(evidence[0].id).toBe("ev_001");
    expect(page.page_type_hint).toBe("subscription");
  });

  it("never includes form values, scripts, or payment-looking text", () => {
    const all = JSON.stringify(extractPage().evidence);
    expect(all).not.toMatch(/hunter2|4111|\$99/);
  });

  it("drops the query string from the URL", () => {
    expect(extractPage().page.url).not.toContain("?");
  });
});

describe("reportToText", () => {
  it("includes caveats and only cited evidence", () => {
    const report = {
      id: "1", analyzedAt: "2026-10-15T00:00:00Z", url: "https://shop.example/x",
      evidence: [{ id: "ev_001", kind: "visible_text", text: "Then $19.99/month" }, { id: "ev_002", kind: "visible_text", text: "unused" }],
      result: {
        schema_version: "1.0", status: "complete",
        offer: { name: "X", merchant: "shop.example", price_items: [] },
        cost_summary: { first_30_days: null, recurring_monthly: { amount: "19.99", currency: "USD" }, annualized_estimate: null, annual_billed: null, annual_monthly_equivalent: null, assumptions: ["Taxes excluded."] },
        findings: [{ id: "f1", category: "renewal", severity: "important", label: "Renews", explanation: "Price changes.", evidence_ids: ["ev_001"], confidence: "high", kind: "supported_fact" }],
        unknowns: ["Refund terms were not found."], limitations: ["Page content only."], next_steps: [],
      },
    } as Report;
    const t = reportToText(report);
    expect(t).toContain("https://shop.example/x");
    expect(t).toContain("Taxes excluded.");
    expect(t).toContain("ev_001");
    expect(t).not.toContain("unused");
  });
});
