import type { Cadence, PriceRole, TrialClaim } from "./schema";

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, thirty: 30, sixty: 60, ninety: 90,
};
const UNIT = "(day|week|month|year)s?";
const NUMTOK = `(\\d{1,3}|${Object.keys(WORD_NUM).join("|")})`;

const toNum = (s: string): number => (/^\d+$/.test(s) ? parseInt(s, 10) : WORD_NUM[s.toLowerCase()]);

export function findTrial(text: string): Omit<TrialClaim, "evidence"> {
  const patterns = [
    new RegExp(`\\b${NUMTOK}[- ]${UNIT}[- ](?:free[- ])?trial`, "i"),
    new RegExp(`free[- ]trial\\s+(?:for|of)\\s+${NUMTOK}[- ]${UNIT}`, "i"),
    new RegExp(`\\b(?:try|start)\\b[^.]{0,30}?\\bfree\\s+for\\s+${NUMTOK}[- ]${UNIT}`, "i"),
    new RegExp(`\\b${NUMTOK}[- ]${UNIT}\\s+free`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      return { state: "stated", value: m[0], duration: toNum(m[1]), unit: m[2].toLowerCase() as TrialClaim["unit"] };
    }
  }
  const m = /\bfree trial\b/i.exec(text);
  if (m) return { state: "stated", value: m[0], duration: null, unit: null };
  return { state: "unknown", value: null, duration: null, unit: null };
}

const MONTHLY = /^[^.]{0,6}?(?:\/\s?(?:mo|month)\b|per\s+month|a\s+month|each\s+month|monthly|\bmo\b\.?|every\s+month)/i;
const ANNUAL = /^[^.]{0,6}?(?:\/\s?(?:yr|year)\b|per\s+year|a\s+year|each\s+year|annual(?:ly)?|yearly|every\s+year|billed\s+annually)/i;
const OTHER: [RegExp, string][] = [
  [/^[^.]{0,6}?(?:\/\s?(?:wk|week)\b|per\s+week|weekly|a\s+week)/i, "weekly"],
  [/^[^.]{0,6}?(?:\/\s?(?:qtr|quarter)\b|per\s+quarter|quarterly)/i, "quarterly"],
];
const ONE_TIME = /one[- ]time|single payment|pay once|lifetime/i;

/** Cadence from the words right after (or just before) a price; "unknown" when not stated. */
export function cadenceNear(text: string, start: number, end: number): { cadence: Cadence; detail: string | null } {
  const after = text.slice(end, end + 40);
  if (MONTHLY.test(after)) return { cadence: "monthly", detail: null };
  if (ANNUAL.test(after)) return { cadence: "annual", detail: null };
  for (const [re, d] of OTHER) if (re.test(after)) return { cadence: "other_recurring", detail: d };
  if (ONE_TIME.test(text.slice(Math.max(0, start - 20), end + 30))) return { cadence: "one_time", detail: null };
  const before = text.slice(Math.max(0, start - 18), start);
  if (/monthly\s*(?:price|plan|billing)?[:\s-]*$/i.test(before)) return { cadence: "monthly", detail: null };
  if (/(?:annual|yearly)\s*(?:price|plan|billing)?[:\s-]*$/i.test(before)) return { cadence: "annual", detail: null };
  const first = /^[^.,;]{0,4}?for\s+(?:the\s+)?first\s+((?:\d+\s+)?(?:day|week|month|year)s?)/i.exec(after);
  if (first) return { cadence: "unknown", detail: `first ${first[1]}` };
  return { cadence: "unknown", detail: null };
}

const THEN = /\b(?:then|thereafter|after that|after (?:the )?(?:trial|intro\w*|first \w+)|renews? (?:at|for)|regular(?:ly)?(?: price)?|standard price)\b/i;
const INTRO = /intro|first (?:month|year|week|\d+)|for the first|trial|new customers?|limited[- ]time|special offer|promo|launch/i;

/** Role of each price within a sentence, by position relative to "then / renews at / regular price". */
export function roleFor(sentence: string, priceStart: number, priceEnd: number): PriceRole {
  const around = sentence.slice(Math.max(0, priceStart - 40), priceEnd + 25);
  if (/ship|deliver/i.test(around)) return "shipping";
  if (/set-?up|activation|installation/i.test(around)) return "fee";
  if (/\b(?:service|processing|handling|booking|admin\w*)\s+fee|\bfee\b|surcharge/i.test(around)) return "fee";
  if (/\b(?:sales\s+)?tax(?:es)?\b|\bvat\b|\bgst\b/i.test(around)) return "tax";
  const m = THEN.exec(sentence);
  if (m) return priceStart >= m.index ? "renewal" : "introductory";
  if (INTRO.test(sentence)) return "introductory";
  return "regular";
}

export interface TermRule {
  key: "shipping" | "setup_fee" | "mandatory_fees" | "taxes" | "cancellation" | "refund" | "auto_renewal" | "minimum_commitment" | "renewal_language";
  test: RegExp;
  value: (s: string) => string;
}

export const TERM_RULES: TermRule[] = [
  { key: "auto_renewal", test: /auto[- ]?renew|automatically\s+renew|renews?\s+automatically|will\s+(?:auto-)?renew|recurring\s+(?:billing|charge)/i, value: () => "stated" },
  {
    key: "renewal_language",
    test: /renews?\s+(?:at|for|every|each|annually|monthly|automatically)|automatically\s+renew|auto[- ]?renew|until\s+(?:you\s+)?cancel/i,
    value: () => "stated",
  },
  {
    key: "cancellation",
    test: /\bcancel/i,
    value: (s) => (/cancel\w*\s+(?:at\s+)?any\s?time|any\s?time\b[^.]{0,20}cancel/i.test(s) ? "anytime" : "mentioned"),
  },
  {
    key: "refund",
    test: /refund|money[- ]back|return\s+policy|returns?\s+(?:within|accepted)/i,
    value: (s) => {
      if (/no\s+refunds?|non-?refundable/i.test(s)) return "none";
      const d = /(\d{1,3})[- ]day\s+(?:money[- ]back|refund|return|guarantee)/i.exec(s);
      return d ? `${d[1]} days` : "mentioned";
    },
  },
  { key: "minimum_commitment", test: /minimum\s+(?:term|commitment|contract|\d+)|\d+[- ]month\s+(?:contract|commitment|minimum|term)|annual\s+(?:contract|commitment)|commitment/i, value: () => "stated" },
  { key: "setup_fee", test: /set-?up\s+fee|activation\s+fee|installation\s+fee/i, value: () => "stated" },
  { key: "mandatory_fees", test: /(?:service|processing|handling|booking|admin\w*|resort|delivery)\s+fee|fees?\s+(?:may\s+)?apply|mandatory\s+fee/i, value: () => "stated" },
  {
    key: "taxes",
    test: /\b(?:sales\s+)?tax(?:es)?\b|\bvat\b|\bgst\b/i,
    value: (s) =>
      /(?:excl\w*|plus|before|\+)\s+(?:applicable\s+)?(?:sales\s+)?(?:tax|vat|gst)|taxes?\s+(?:not\s+included|extra|added|apply|calculated)/i.test(s)
        ? "excluded"
        : /(?:incl\w*)\s+(?:applicable\s+)?(?:tax|vat|gst)|taxes?\s+included/i.test(s) ? "included" : "mentioned",
  },
  {
    key: "shipping",
    test: /\bshipping\b|\bdelivery\b/i,
    value: (s) => (/free\s+(?:shipping|delivery)|shipping\s+(?:is\s+)?free/i.test(s) ? "free" : "mentioned"),
  },
];
