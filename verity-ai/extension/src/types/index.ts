export type Period =
  | "one_time" | "first_month" | "monthly" | "monthly_after_intro" | "yearly" | "unspecified";
export type Severity = "important" | "caution" | "info";

export interface Evidence { id: string; kind: "visible_text"; text: string }

export interface PagePayload {
  url: string;
  title: string;
  merchant_domain: string;
  page_type_hint: "product" | "subscription" | "unknown";
}

export interface AnalyzeRequest {
  schema_version: "1.0";
  page: PagePayload;
  evidence: Evidence[];
  locale: string;
  currency_hint: string | null;
}

export interface Money { amount: string; currency: string }
export interface Finding {
  id: string;
  category: string;
  severity: Severity;
  label: string;
  explanation: string;
  evidence_ids: string[];
  confidence: "high" | "medium" | "low";
  kind: "supported_fact" | "inference" | "potential_concern" | "general_caution";
}

export interface AnalyzeResponse {
  schema_version: string;
  status: "complete" | "partial" | "unsupported";
  offer: {
    name: string | null;
    merchant: string | null;
    price_items: { amount: string; currency: string; period: Period; evidence_id: string | null }[];
  };
  cost_summary: {
    first_30_days: Money | null;
    recurring_monthly: Money | null;
    annualized_estimate: Money | null;
    annual_billed: Money | null;
    annual_monthly_equivalent: Money | null;
    assumptions: string[];
  };
  findings: Finding[];
  unknowns: string[];
  limitations: string[];
  next_steps: string[];
}

/** What the page-side extractor returns (before it is wrapped into an AnalyzeRequest). */
export interface Extraction {
  page: PagePayload;
  evidence: Evidence[];
}

export interface Report {
  id: string;
  analyzedAt: string;
  url: string;
  evidence: Evidence[];
  result: AnalyzeResponse;
}

export type ErrorCode = "unsupported_page" | "extraction_failed" | "timeout" | "rate_limited" | "network" | "server";

export type CheckMessage = { type: "verity:check"; tabId: number };
export type CheckReply =
  | { ok: true; report: Report }
  | { ok: false; error: ErrorCode; message: string };
