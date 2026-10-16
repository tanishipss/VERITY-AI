/** Versioned, normalized output of the page-side extractor. Unknown stays unknown (null / "unknown"). */
export const EXTRACTION_SCHEMA_VERSION = "verity.extraction/1";

export type ExtractionMethod = "json_ld" | "meta_tags" | "visible_text";
export type Cadence = "one_time" | "monthly" | "annual" | "other_recurring" | "unknown";
export type PriceRole = "introductory" | "renewal" | "regular" | "shipping" | "fee" | "tax" | "unknown";

export interface EvidenceRef {
  /** Short exact quote taken from the current page (length-limited). */
  quote: string;
  source: ExtractionMethod;
  /** CSS-ish selector (visible text) or source reference such as "script[type=application/ld+json]#1". */
  ref: string | null;
  /** Links to the Evidence item sent for analysis, when the quote came from visible text. */
  evidence_id: string | null;
}

export interface PriceClaim {
  /** Normalized decimal string using "." (e.g. "1299.50"), or null if unparseable. */
  amount: string | null;
  /** ISO code only when the page states it unambiguously; a bare "$" or "¥" stays null. */
  currency: string | null;
  currency_symbol: string | null;
  currency_ambiguous: boolean;
  cadence: Cadence;
  cadence_detail: string | null;
  role: PriceRole;
  original_text: string;
  methods: ExtractionMethod[];
  evidence: EvidenceRef[];
}

export interface TermClaim {
  state: "stated" | "unknown";
  value: string | null;
  evidence: EvidenceRef | null;
}

export interface TrialClaim extends TermClaim {
  duration: number | null;
  unit: "day" | "week" | "month" | "year" | null;
}

export type ExtractionConfidence = "high" | "medium" | "low";

export interface StructuredOffer {
  schema_version: typeof EXTRACTION_SCHEMA_VERSION;
  extracted_at: string;
  page: { url: string; hostname: string; title: string };
  name: TermClaim;
  /** Every distinct price candidate. Several may be different plans; none is picked for you. */
  prices: PriceClaim[];
  ambiguous_prices: boolean;
  trial: TrialClaim;
  introductory_price: PriceClaim | null;
  renewal_price: PriceClaim | null;
  billing_interval: TermClaim;
  renewal_language: TermClaim;
  shipping: TermClaim;
  setup_fee: TermClaim;
  mandatory_fees: TermClaim;
  taxes: TermClaim;
  cancellation: TermClaim;
  refund: TermClaim;
  auto_renewal: TermClaim;
  minimum_commitment: TermClaim;
  /** Quality of extraction only; says nothing about the merchant. */
  confidence: ExtractionConfidence;
  confidence_reason: string;
  methods_used: ExtractionMethod[];
  limitations: string[];
}

export interface TextBlock {
  id: string;
  text: string;
  selector: string | null;
}
