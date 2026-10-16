import type { Money, Report } from "../types";

type Category = string;
import { formatMoney } from "./format";

export interface Cell {
  text: string;
  available: boolean;
  evidence?: string; // exact supporting snippet, when a finding backs the cell
  lower?: boolean; // this side is the lower amount on this row (same currency only)
}
export interface Row { key: string; label: string; a: Cell; b: Cell; note?: string }

const NA: Cell = { text: "Not available", available: false };
const NOT_FOUND: Cell = { text: "Not found on this page", available: false };

const MONEY_ROWS: { key: string; label: string; pick: (r: Report) => Money | null; suffix: string }[] = [
  { key: "upfront", label: "Upfront / first 30 days", pick: (r) => r.result.cost_summary.first_30_days, suffix: "" },
  { key: "recurring", label: "Recurring", pick: (r) => r.result.cost_summary.recurring_monthly, suffix: " / month" },
  { key: "annual", label: "Annualized estimate", pick: (r) => r.result.cost_summary.annualized_estimate ?? r.result.cost_summary.annual_billed, suffix: " / year (estimate)" },
];

const TERM_ROWS: { key: string; label: string; category: Category }[] = [
  { key: "commitment", label: "Commitment", category: "commitment" },
  { key: "cancellation", label: "Cancellation", category: "cancellation" },
  { key: "refund", label: "Refund / returns", category: "refund" },
  { key: "fees", label: "Extra fees / taxes", category: "fees" },
  { key: "trial", label: "Trial", category: "trial" },
];

function moneyCell(m: Money | null, suffix: string): Cell {
  return m ? { text: formatMoney(m) + suffix, available: true } : NA;
}

function termCell(r: Report, category: Category): Cell {
  const f = r.result.findings.find((x) => x.category === category);
  if (!f) return NOT_FOUND;
  const ev = r.evidence.find((e) => f.evidence_ids.includes(e.id));
  return { text: f.label, available: true, evidence: ev?.text };
}

/** Pure comparison. No overall score and no winner; only per-row, same-currency "lower" markers. */
export function compareReports(a: Report, b: Report): Row[] {
  const rows: Row[] = [];
  for (const spec of MONEY_ROWS) {
    const ma = spec.pick(a), mb = spec.pick(b);
    const ca = moneyCell(ma, spec.suffix), cb = moneyCell(mb, spec.suffix);
    let note: string | undefined;
    if (ma && mb) {
      if (ma.currency !== mb.currency) {
        note = `Different currencies (${ma.currency} vs ${mb.currency}); not compared or converted.`;
      } else {
        const x = Number(ma.amount), y = Number(mb.amount); // display ordering only
        if (x < y) ca.lower = true;
        else if (y < x) cb.lower = true;
      }
    }
    rows.push({ key: spec.key, label: spec.label, a: ca, b: cb, note });
  }
  for (const spec of TERM_ROWS) {
    rows.push({ key: spec.key, label: spec.label, a: termCell(a, spec.category), b: termCell(b, spec.category) });
  }
  return rows;
}

export const offerLabel = (r: Report) => r.result.offer.merchant ?? r.result.offer.name ?? r.url;
