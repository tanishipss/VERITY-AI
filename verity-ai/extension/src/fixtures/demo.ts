import type { AnalyzeResponse, Evidence, Report } from "../types";

/** Clearly labelled sample reports (Report.demo = true). They never come from a live page or the service. */
export interface DemoScenario {
  key: "one_time" | "trial_subscription" | "missing_terms";
  label: string;
  report: Report;
}

const ev = (id: string, text: string): Evidence => ({ id, kind: "visible_text", text });
const empty = { first_30_days: null, recurring_monthly: null, annualized_estimate: null, annual_billed: null, annual_monthly_equivalent: null };

function make(key: DemoScenario["key"], label: string, host: string, evidence: Evidence[], result: AnalyzeResponse): DemoScenario {
  return {
    key,
    label,
    report: { id: `demo-${key}`, demo: true, analyzedAt: "2026-01-01T12:00:00.000Z", url: `https://${host}/demo`, evidence, result },
  };
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  make(
    "one_time",
    "One-time purchase",
    "shop.example",
    [ev("ev_001", "Trail Pack 30L — US$89.00 one-time payment."), ev("ev_002", "Free shipping on orders over $50. Prices exclude sales tax.")],
    {
      schema_version: "1.0", status: "complete",
      offer: { name: "Trail Pack 30L", merchant: "shop.example", price_items: [{ amount: "89.00", currency: "USD", period: "one_time", evidence_id: "ev_001" }] },
      cost_summary: { ...empty, first_30_days: { amount: "89.00", currency: "USD" }, assumptions: ["Sales tax is excluded, as stated on the page."] },
      findings: [
        { id: "f1", category: "fees", severity: "info", label: "Taxes are not included", explanation: "The page says prices exclude sales tax, so the total at checkout may be higher.", evidence_ids: ["ev_002"], confidence: "high", kind: "supported_fact" },
      ],
      unknowns: ["Refund or return terms were not found on this page."],
      limitations: ["Demo data: example content only."],
      next_steps: ["Check the return policy before buying."],
    },
  ),
  make(
    "trial_subscription",
    "Monthly subscription with trial",
    "app.example",
    [ev("ev_001", "Start your 7-day free trial. Then $12/month. Cancel anytime."), ev("ev_002", "Subscription renews automatically until you cancel.")],
    {
      schema_version: "1.0", status: "complete",
      offer: { name: "Notely Pro", merchant: "app.example", price_items: [{ amount: "12.00", currency: "USD", period: "monthly", evidence_id: "ev_001" }] },
      cost_summary: { ...empty, first_30_days: { amount: "12.00", currency: "USD" }, recurring_monthly: { amount: "12.00", currency: "USD" }, annualized_estimate: { amount: "144.00", currency: "USD" }, assumptions: ["Annual estimate is 12 × the monthly price; it assumes no price change and no taxes."] },
      findings: [
        { id: "f1", category: "trial", severity: "important", label: "Free trial converts to a paid plan", explanation: "A 7-day trial is offered, followed by $12/month.", evidence_ids: ["ev_001"], confidence: "high", kind: "supported_fact" },
        { id: "f2", category: "renewal", severity: "important", label: "Renews automatically", explanation: "The page states the subscription renews until you cancel.", evidence_ids: ["ev_002"], confidence: "high", kind: "supported_fact" },
      ],
      unknowns: ["Refund terms were not found on this page.", "How to cancel was not described on this page."],
      limitations: ["Demo data: example content only."],
      next_steps: ["Note the trial end date and how to cancel before it."],
    },
  ),
  make(
    "missing_terms",
    "Page missing billing terms",
    "deals.example",
    [ev("ev_001", "Starting from $19. Fees may apply.")],
    {
      schema_version: "1.0", status: "partial",
      offer: { name: null, merchant: "deals.example", price_items: [{ amount: "19.00", currency: "USD", period: "unspecified", evidence_id: "ev_001" }] },
      cost_summary: { ...empty, assumptions: ["No billing period was stated, so no recurring or annual cost was calculated."] },
      findings: [
        { id: "f1", category: "fees", severity: "caution", label: "Fees are mentioned but not detailed", explanation: "The page says fees may apply without listing them.", evidence_ids: ["ev_001"], confidence: "medium", kind: "supported_fact" },
      ],
      unknowns: ["Billing period was not stated.", "Cancellation terms were not found.", "Refund terms were not found.", "Renewal terms were not found."],
      limitations: ["Demo data: example content only."],
      next_steps: ["Look for pricing details on the checkout or terms pages."],
    },
  ),
];
