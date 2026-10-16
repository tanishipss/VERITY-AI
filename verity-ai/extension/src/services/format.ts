import type { Money, Report } from "../types";

/** Amount is a decimal string from the backend; format without converting to float math. */
export function formatMoney(m: Money): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: m.currency }).format(Number(m.amount));
  } catch {
    return `${m.amount} ${m.currency}`;
  }
}

const SEVERITY_TEXT = { important: "Important", caution: "Worth checking", info: "For your information" } as const;
export const severityText = (s: keyof typeof SEVERITY_TEXT) => SEVERITY_TEXT[s];

export function reportToText(r: Report): string {
  const { result: x } = r;
  const c = x.cost_summary;
  const lines = [
    `${r.demo ? "[DEMO DATA - not a live analysis] " : ""}Verity report: ${x.offer.name ?? x.offer.merchant ?? r.url}`,
    `URL: ${r.url}`,
    `Checked: ${new Date(r.analyzedAt).toLocaleString()}`,
    "",
  ];
  if (c.first_30_days) lines.push(`First 30 days: ${formatMoney(c.first_30_days)}`);
  if (c.recurring_monthly) lines.push(`Recurring: ${formatMoney(c.recurring_monthly)} per month`);
  if (c.annualized_estimate) lines.push(`Annualized estimate: ${formatMoney(c.annualized_estimate)}`);
  if (c.annual_billed) lines.push(`Annual plan: ${formatMoney(c.annual_billed)} per year`);
  for (const f of x.findings) {
    lines.push("", `[${severityText(f.severity)}] ${f.label}: ${f.explanation} (evidence: ${f.evidence_ids.join(", ") || "n/a"})`);
  }
  if (x.unknowns.length) lines.push("", "Not found:", ...x.unknowns.map((u) => `- ${u}`));
  lines.push("", "Assumptions:", ...c.assumptions.map((a) => `- ${a}`), "", ...x.limitations);
  const used = new Set(x.findings.flatMap((f) => f.evidence_ids));
  const ev = r.evidence.filter((e) => used.has(e.id));
  if (ev.length) lines.push("", "Evidence:", ...ev.map((e) => `${e.id}: "${e.text}"`));
  return lines.join("\n");
}
