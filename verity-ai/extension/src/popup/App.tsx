import { useCallback, useEffect, useState } from "react";
import { CompareView } from "../components/CompareView";
import { ReportView } from "../components/ReportView";
import { API_BASE } from "../services/api";
import { formatMoney } from "../services/format";
import { addRecent, clearRecent, clearReports, deleteReport, giveConsent, hasConsent, listRecent, listReports, revokeConsent, saveReport } from "../services/storage";
import type { CheckReply, Report } from "../types";

type Tab = "check" | "saved" | "settings";
type State =
  | { s: "idle" }
  | { s: "loading" }
  | { s: "error"; message: string }
  | { s: "report"; report: Report };

function Consent({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="card">
      <h1>Understand the offer before you commit.</h1>
      <p>
        When you click <strong>Check this offer</strong>, Verity reads the visible price and terms text on the current
        page. That extracted text, plus the page URL and title, is sent to the Verity service and an AI provider to
        build your report.
      </p>
      <p>Verity never reads passwords, payment fields, other tabs or your browsing history, and never checks a page unless you ask.</p>
      <p className="muted">
        Nothing is saved unless you choose “Save locally”. The service does not store page content by default.
      </p>
      <button className="primary" onClick={onAccept}>I understand — continue</button>
    </div>
  );
}

function Check({ state, onCheck, tabInfo }: { state: State; onCheck: () => void; tabInfo: { title: string; host: string } | null; }) {
  return (
    <div className="app" style={{ padding: 0 }}>
      <div className="card">
        <div className="muted">Current page</div>
        <h3>{tabInfo?.title || "Untitled page"}</h3>
        <div className="muted">{tabInfo?.host}</div>
      </div>
      {state.s === "error" && <div className="banner error" role="alert">{state.message}</div>}
      <button className="primary" onClick={onCheck} disabled={state.s === "loading"}>
        {state.s === "loading" ? "Checking…" : state.s === "error" ? "Retry" : "Check this offer"}
      </button>
      {state.s === "loading" ? (
        <div className="row" role="status"><div className="spinner" aria-hidden /> <span>Reading and analyzing offer details…</span></div>
      ) : (
        <p className="muted">Verity checks information available on this page; it may not see every checkout fee or term.</p>
      )}
    </div>
  );
}

function Saved({ reports, onOpen, onDelete, onClear }: { reports: Report[]; onOpen: (r: Report) => void; onDelete: (id: string) => void; onClear: () => void; }) {
  if (!reports.length) return <p className="muted">No saved reports. Reports are only saved when you choose to.</p>;
  return (
    <div className="app" style={{ padding: 0 }}>
      {reports.map((r) => (
        <div className="card row between" key={r.id}>
          <div>
            <button className="link" onClick={() => onOpen(r)}>{r.result.offer.name || r.result.offer.merchant || r.url}</button>
            <div className="muted">
              {new Date(r.analyzedAt).toLocaleDateString()}
              {r.result.cost_summary.recurring_monthly ? ` · ${formatMoney(r.result.cost_summary.recurring_monthly)}/mo` : ""}
            </div>
          </div>
          <button className="secondary danger" onClick={() => onDelete(r.id)} aria-label={`Delete saved report for ${r.result.offer.merchant ?? r.url}`}>Delete</button>
        </div>
      ))}
      <button className="secondary danger" onClick={onClear}>Clear all saved reports</button>
    </div>
  );
}

function Settings({ onRevoke }: { onRevoke: () => void }) {
  return (
    <div className="app" style={{ padding: 0 }}>
      <div className="card">
        <h2>Privacy</h2>
        <ul>
          <li>Analysis starts only when you click. No background scanning.</li>
          <li>Extracted page text, URL and title are sent to <code>{API_BASE}</code> and the configured AI provider.</li>
          <li>The service does not retain page content by default and logs only metadata.</li>
          <li>Your last 3 checks are kept in memory so you can compare them; they are erased when you close the browser, withdraw consent or clear saved reports.</li>
          <li>Saved reports live only in this browser and can be deleted any time.</li>
        </ul>
      </div>
      <div className="card">
        <h2>Limitations</h2>
        <p>Verity reads one page at a time and may not see checkout fees or terms on other pages. It highlights evidence; it doesn’t guarantee a merchant is legitimate, and it isn’t legal or financial advice.</p>
        <p className="muted">Feedback: please don’t include payment details or passwords.</p>
      </div>
      <button className="secondary" onClick={onRevoke}>Withdraw consent</button>
    </div>
  );
}

export function App() {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("check");
  const [state, setState] = useState<State>({ s: "idle" });
  const [reports, setReports] = useState<Report[]>([]);
  const [comparing, setComparing] = useState(false);
  const [recent, setRecent] = useState<Report[]>([]);
  const [tabInfo, setTabInfo] = useState<{ title: string; host: string } | null>(null);

  const refresh = useCallback(async () => {
    setReports(await listReports());
    setRecent(await listRecent());
  }, []);

  useEffect(() => {
    hasConsent().then(setConsent);
    refresh();
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      if (!t) return;
      let host = "";
      try { host = new URL(t.url ?? "").hostname; } catch { /* non-web page */ }
      setTabInfo({ title: t.title ?? "", host });
    });
  }, [refresh]);

  const check = async () => {
    setState({ s: "loading" });
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t?.id) return setState({ s: "error", message: "No active tab found." });
    try {
      const reply: CheckReply = await chrome.runtime.sendMessage({ type: "verity:check", tabId: t.id });
      if (reply.ok) {
        await addRecent(reply.report);
        refresh();
      }
      setState(reply.ok ? { s: "report", report: reply.report } : { s: "error", message: reply.message });
    } catch {
      setState({ s: "error", message: "Something went wrong. Please retry." });
    }
  };

  const isSaved = state.s === "report" && reports.some((r) => r.id === state.report.id);

  if (consent === null) return null;
  if (!consent) {
    return <div className="app"><Consent onAccept={async () => { await giveConsent(); setConsent(true); }} /></div>;
  }

  return (
    <div className="app">
      <nav aria-label="Verity sections">
        {(["check", "saved", "settings"] as Tab[]).map((t) => (
          <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => { setTab(t); if (t === "saved") refresh(); }}>
            {t === "check" ? "Check" : t === "saved" ? "Saved" : "Privacy"}
          </button>
        ))}
      </nav>

      {tab === "check" && (state.s === "report" && comparing ? (
        <CompareView base={state.report} saved={reports} recent={recent} onBack={() => setComparing(false)} />
      ) : state.s === "report" ? (
        <>
          <ReportView report={state.report} saved={isSaved} onCompare={() => { refresh(); setComparing(true); }}
            onSave={async () => { await saveReport(state.report); refresh(); }} />
          <button className="link" onClick={() => setState({ s: "idle" })}>Check again</button>
        </>
      ) : <Check state={state} onCheck={check} tabInfo={tabInfo} />)}

      {tab === "saved" && (
        <Saved
          reports={reports}
          onOpen={(r) => { setState({ s: "report", report: r }); setTab("check"); }}
          onDelete={async (id) => { await deleteReport(id); refresh(); }}
          onClear={async () => { if (confirm("Delete all saved reports? This can’t be undone.")) { await clearReports(); await clearRecent(); refresh(); } }}
        />
      )}
      {tab === "settings" && <Settings onRevoke={async () => { await revokeConsent(); await clearRecent(); setConsent(false); }} />}
    </div>
  );
}
