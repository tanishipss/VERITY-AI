import { Fragment, useState } from "react";
import { compareReports, offerLabel, type Cell } from "../services/compare";
import type { Report } from "../types";

function CellView({ c }: { c: Cell }) {
  return (
    <td style={{ verticalAlign: "top", padding: "8px 6px", borderTop: "1px solid var(--border)" }}>
      <div className={c.available ? "" : "muted"}>{c.text}</div>
      {c.lower && <div className="badge" style={{ color: "var(--primary)" }}>Lower amount</div>}
      {c.evidence && <div className="muted" style={{ fontStyle: "italic" }}>“{c.evidence.slice(0, 110)}”</div>}
    </td>
  );
}

export function CompareView({ base, saved, recent, onBack }: { base: Report; saved: Report[]; recent: Report[]; onBack: () => void }) {
  const savedIds = new Set(saved.map((r) => r.id));
  const savedOthers = saved.filter((r) => r.id !== base.id);
  const recentOthers = recent.filter((r) => r.id !== base.id && !savedIds.has(r.id));
  const candidates = [...recentOthers, ...savedOthers];
  const [otherId, setOtherId] = useState<string>(recentOthers[0]?.id ?? "");
  const other = candidates.find((r) => r.id === otherId);

  return (
    <div className="app" style={{ padding: 0 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>Compare offers</h2>
        <button className="link" onClick={onBack}>Back to report</button>
      </div>

      {candidates.length === 0 ? (
        <div className="banner caution">
          Nothing to compare with yet. Check another offer’s page, then open Compare from its report. Offers you
          just checked are available until you close the browser; use “Save locally” to keep one longer.
        </div>
      ) : (
        <label className="card" style={{ display: "block" }}>
          <span className="muted">Compare “{offerLabel(base)}” with…</span>
          <select value={otherId} onChange={(e) => setOtherId(e.target.value)} style={{ width: "100%", marginTop: 6, padding: 6 }}>
            <option value="">Choose an offer…</option>
            {recentOthers.length > 0 && (
              <optgroup label="Recently checked (not saved)">
                {recentOthers.map((r) => (
                  <option key={r.id} value={r.id}>{offerLabel(r)} · {new Date(r.analyzedAt).toLocaleTimeString()}</option>
                ))}
              </optgroup>
            )}
            {savedOthers.length > 0 && (
              <optgroup label="Saved reports">
                {savedOthers.map((r) => (
                  <option key={r.id} value={r.id}>{offerLabel(r)} · {new Date(r.analyzedAt).toLocaleDateString()}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}

      {other && (
        <section className="card" aria-label="Offer comparison">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "left" }}>{offerLabel(base)}</th>
                <th scope="col" style={{ textAlign: "left" }}>{offerLabel(other)}</th>
              </tr>
            </thead>
            <tbody>
              {compareReports(base, other).map((row) => (
                <Fragment key={row.key}>
                  <tr>
                    <th scope="rowgroup" colSpan={2} style={{ textAlign: "left", paddingTop: 10, fontSize: 12 }}>{row.label}</th>
                  </tr>
                  <tr>
                    <CellView c={row.a} />
                    <CellView c={row.b} />
                  </tr>
                  {row.note && <tr><td colSpan={2} className="muted">{row.note}</td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 10 }}>
            No overall winner is shown: “Not found” means the term wasn’t on that page, not that it doesn’t exist.
            Check each offer’s checkout and terms before deciding.
          </p>
        </section>
      )}
    </div>
  );
}
