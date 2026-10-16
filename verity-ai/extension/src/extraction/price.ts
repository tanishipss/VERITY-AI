export interface PriceMatch {
  raw: string;
  amount: string | null;
  currency: string | null;
  symbol: string | null;
  ambiguous: boolean;
  index: number;
  end: number;
}

const CODES = "USD|EUR|GBP|INR|JPY|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|BRL|MXN|SGD|HKD|CNY|KRW|ZAR|AED";
const LEAD_SYMBOLS = String.raw`US\$|CA\$|C\$|AU\$|A\$|NZ\$|R\$|S\$|HK\$|[$€£₹¥₩]|Rs\.?|CHF`;
const TRAIL_SYMBOLS = String.raw`[€£₹₩]|zł|Rs\.?`;

// Indian grouping, western/EU grouping (',', '.', apostrophe, space variants), then plain digits.
const NUM = String.raw`\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d{1,2})?|\d{1,3}(?:[,.'   ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;

const LEAD = new RegExp(String.raw`(${LEAD_SYMBOLS}|\b(?:${CODES})\b)\s?(${NUM})(?!\d|[.,]\d)`, "gi");
const TRAIL = new RegExp(String.raw`(?<![\d.,])(${NUM})\s?(${TRAIL_SYMBOLS}|\b(?:${CODES})\b)`, "gi");

const SYMBOL_CODE: Record<string, string> = {
  "us$": "USD", "ca$": "CAD", "c$": "CAD", "au$": "AUD", "a$": "AUD", "nz$": "NZD", "r$": "BRL", "s$": "SGD", "hk$": "HKD",
  "€": "EUR", "£": "GBP", "₹": "INR", "₩": "KRW", "rs": "INR", "rs.": "INR", "zł": "PLN", chf: "CHF",
};
// "$" and "¥" are shared by several currencies, so they stay unresolved.
const AMBIGUOUS = new Set(["$", "¥"]);

/** Locale-aware normalization of a numeric token to a "." decimal string; null if malformed. */
export function normalizeNumber(token: string): string | null {
  const t = token.replace(/[   ' ]/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  let intPart: string;
  let frac = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const decIdx = Math.max(lastDot, lastComma);
    const decSep = t[decIdx];
    const groupSep = decSep === "." ? "," : ".";
    intPart = t.slice(0, decIdx);
    frac = t.slice(decIdx + 1);
    if (intPart.includes(decSep) || frac.length === 0 || frac.length > 2) return null;
    const groups = intPart.split(groupSep);
    // every group after the first must be a 3-digit group (or 2-digit for Indian grouping, last group 3)
    if (!groups.slice(1).every((g) => g.length === 3 || g.length === 2)) return null;
    intPart = groups.join("");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = t.split(sep);
    if (parts.some((p) => p === "")) return null;
    const last = parts[parts.length - 1];
    if (parts.length > 2) {
      // repeated separator => grouping; groups after the first must be 3 digits, or 2 digits for Indian style
      const body = parts.slice(1, -1);
      if (last.length !== 3 || !body.every((p) => p.length === 3 || p.length === 2)) return null;
      if (body.some((p) => p.length === 2) && !body.every((p) => p.length === 2)) return null;
      intPart = parts.join("");
    } else if (last.length === 3) {
      intPart = parts.join(""); // "1,299" / "1.299" read as thousands grouping
    } else if (last.length <= 2) {
      intPart = parts[0];
      frac = last;
    } else {
      return null;
    }
  } else {
    intPart = t;
  }
  if (!/^\d+$/.test(intPart)) return null;
  intPart = intPart.replace(/^0+(?=\d)/, "");
  return frac ? `${intPart}.${frac.padEnd(2, "0")}` : intPart;
}

function resolveCurrency(sym: string): { currency: string | null; symbol: string; ambiguous: boolean } {
  const upper = sym.toUpperCase();
  if (new RegExp(`^(?:${CODES})$`).test(upper)) return { currency: upper, symbol: upper, ambiguous: false };
  if (AMBIGUOUS.has(sym)) return { currency: null, symbol: sym, ambiguous: true };
  const code = SYMBOL_CODE[sym.toLowerCase()];
  return { currency: code ?? null, symbol: sym, ambiguous: code === undefined };
}

/** Finds every currency amount in the text. Malformed numbers are skipped, never guessed. */
export function findPrices(text: string): PriceMatch[] {
  const out: PriceMatch[] = [];
  for (const m of text.matchAll(LEAD)) {
    const amount = normalizeNumber(m[2]);
    if (amount === null) continue;
    const c = resolveCurrency(m[1]);
    out.push({ raw: m[0], amount, currency: c.currency, symbol: c.symbol, ambiguous: c.ambiguous, index: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(TRAIL)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (out.some((p) => start < p.end && end > p.index)) continue; // already covered by a leading-symbol match
    const amount = normalizeNumber(m[1]);
    if (amount === null) continue;
    const c = resolveCurrency(m[2]);
    out.push({ raw: m[0], amount, currency: c.currency, symbol: c.symbol, ambiguous: c.ambiguous, index: start, end });
  }
  return out.sort((a, b) => a.index - b.index);
}
