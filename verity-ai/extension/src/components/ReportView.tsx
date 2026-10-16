import { useState } from "react";
import { formatMoney, reportToText, severityText } from "../services/format";
import type { Finding, Money, Report } from "../types";

function Tile({ label, money, sub }: { label: string; money: Money; sub: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{formatMoney(money)}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function FindingCard({ f, report }: { f: Finding; report: Report }) {
  const [open, setOpen] = useState(false);
  const ev = report.evidence.filter((e) => f.evidence_ids.includes(e.id));
  const tag =
    f.kind === "potential_concern" ? "Potential concern — needs checking, not proof of a problem"
    : f.kind === "inference" ? "Inference" : null;
  return (
    <div className={`finding ${f.severity}`}>
      <div className="badge">{severityText(f.severity)}</div>
      <h3>{f.label}</h3>
      <p>{f.explanation}</p>
      {tag && <p className="muted">{tag}</p>}
      {ev.length > 0 && (
        <>
          <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide evidence" : `Show evidence (${ev.length})`}
          </button>
          {open && ev.map((e) => (
            <blockquote className="evidence" key={e.id} style={{ margin: "6px 0 0" }}>
              “{e.text}”
              <div className="muted">Source: text on this page ({e.id})</div>
            </blockquote>
          ))}
        </>
      )}
    </div>
  );
}

export function ReportView({ report, onSave, saved, onCompare }: { report: Report; onSave: () => void; saved: boolean; onCompare: () => void }) {
  const { result: x } = report;
  const c = x.cost_summary;
  const [copied, setCopied] = useState(false);
  const hasCost = c.first_30_days || c.recurring_monthly || c.annual_billed;

  const copy = async () => {
    await navigator.clipboard.writeText(reportToText(report));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="app" style={{ padding: 0 }}>
      <div className="row between">
        <div>
          <h2 style={{ margin: 0 }}>{x.offer.merchant ?? "This page"}</h2>
          <div className="muted">Checked {new Date(report.analyzedAt).toLocaleTimeString()}</div>
        </div>
      </div>

      {report.demo && (
        <div className="banner caution" role="note">
          <strong>Demo data.</strong> This is a built-in example, not a live analysis of any page.
        </div>
      )}
      {x.status === "partial" && !report.demo && (
        <div className="banner caution" role="status">Partial result: the AI explanation step was unavailable, so only basic checks ran.</div>
      )}
      {x.status === "unsupported" && (
        <div className="banner caution" role="status">
          We couldn’t confirm a price or terms from this page. Verity works best on product and subscription pages.
        </div>
      )}

      <section className="card" aria-labelledby="cost">
        <h2 id="cost">Cost snapshot</h2>
        {hasCost ? (
          <div className="tiles">
            {c.first_30_days && <Tile label="Upfront / first 30 days" money={c.first_30_days} sub="visible listed cost" />}
            {c.recurring_monthly && <Tile label="Recurring" money={c.recurring_monthly} sub="per month" />}
            {c.annualized_estimate && <Tile label="Annualized estimate" money={c.annualized_estimate} sub="per year, estimate" />}
            {c.annual_billed && <Tile label="Annual plan" money={c.annual_billed} sub="billed once per year" />}
            {c.annual_monthly_equivalent && <Tile label="Monthly equivalent" money={c.annual_monthly_equivalent} sub="annual ÷ 12" />}
          </div>
        ) : (
          <p>We couldn’t confirm a price from this page.</p>
        )}
        <ul className="muted" style={{ marginTop: 8 }}>
          {c.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </section>

      {x.findings.length > 0 && (
        <section aria-labelledby="important">
          <h2 id="important">Important to know</h2>
          {x.findings.slice(0, 3).map((f) => <FindingCard key={f.id} f={f} report={report} />)}
          {x.findings.length > 3 && (
            <details>
              <summary>{x.findings.length - 3} more</summary>
              {x.findings.slice(3).map((f) => <FindingCard key={f.id} f={f} report={report} />)}
            </details>
          )}
        </section>
      )}

      {x.unknowns.length > 0 && (
        <section className="card" aria-labelledby="unknown">
          <h2 id="unknown">Not found on this page</h2>
          <ul>{x.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>
        </section>
      )}

      {x.next_steps.length > 0 && (
        <section className="card" aria-labelledby="next">
          <h2 id="next">Suggested next steps</h2>
          <ul>{x.next_steps.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      )}

      <p className="muted">{x.limitations.join(" ")}</p>

      <div className="row wrap">
        <button className="secondary" onClick={onCompare}>Compare</button>
        <button className="secondary" onClick={copy}>{copied ? "Copied" : "Copy report"}</button>
        <button className="secondary" onClick={onSave} disabled={saved || report.demo}>{saved ? "Saved locally" : "Save locally"}</button>
      </div>
      <div aria-live="polite" className="sr-only">{copied ? "Report copied" : ""}</div>
    </div>
  );
}
