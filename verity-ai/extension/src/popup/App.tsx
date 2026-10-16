import { useCallback, useEffect, useState } from "react";
import { CompareView } from "../components/CompareView";
import { ReportView } from "../components/ReportView";
import { DEMO_SCENARIOS } from "../fixtures/demo";
import { API_BASE } from "../services/api";
import { formatMoney } from "../services/format";
import { addRecent, clearRecent, clearReports, deleteReport, giveConsent, hasConsent, listRecent, listReports, revokeConsent, saveReport } from "../services/storage";
import type { CheckReply, ProgressMessage, Report } from "../types";

type Tab = "check" | "saved" | "settings";
type State =
  | { s: "idle" }
  | { s: "loading"; stage: ProgressMessage["stage"] | "starting" }
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

type TabInfo = { title: string; host: string; supported: boolean };

const STAGES: { key: ProgressMessage["stage"]; label: string }[] = [
  { key: "reading", label: "Reading visible price and terms text" },
  { key: "analyzing", label: "Analyzing the offer details" },
];

function Check({ state, onCheck, onDemo, tabInfo }: { state: State; onCheck: () => void; onDemo: (r: Report) => void; tabInfo: TabInfo | null }) {
  const unsupported = tabInfo !== null && !tabInfo.supported;
  const loading = state.s === "loading";
  const current = loading ? STAGES.findIndex((x) => x.key === state.stage) : -1;
  return (
    <div className="app" style={{ padding: 0 }}>
      <div className="card">
        <div className="muted">Current page</div>
        <h3>{tabInfo?.title || "Untitled page"}</h3>
        <div className="muted">{tabInfo?.host}</div>
      </div>
      {unsupported && (
        <div className="banner caution" role="status">
          <strong>This page can’t be checked.</strong> Verity only works on regular web pages (http or https). Browser pages,
          the Chrome Web Store and local files aren’t supported. No analysis was run.
        </div>
      )}
      {state.s === "error" && <div className="banner error" role="alert">{state.message}</div>}
      <button className="primary" onClick={onCheck} disabled={loading || unsupported}>
        {loading ? "Checking…" : state.s === "error" ? "Retry" : "Check this offer"}
      </button>
      {loading ? (
        <div role="status" aria-live="polite">
          <ol className="stages">
            {STAGES.map((st, i) => (
              <li key={st.key} aria-current={i === current ? "step" : undefined}>
                <span aria-hidden>{i < current ? "✓" : i === current ? "●" : "○"}</span> {st.label}
                <span className="sr-only">{i < current ? " (done)" : i === current ? " (in progress)" : " (waiting)"}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="muted">Verity checks information available on this page; it may not see every checkout fee or term.</p>
      )}
      <details>
        <summary>See an example report</summary>
        <p className="muted">These are built-in demos, not live analyses.</p>
        <div className="row wrap">
          {DEMO_SCENARIOS.map((d) => (
            <button key={d.key} className="secondary" onClick={() => onDemo(d.report)}>{d.label}</button>
          ))}
        </div>
      </details>
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
  const [tabInfo, setTabInfo] = useState<TabInfo | null>(null);

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
      setTabInfo({ title: t.title ?? "", host, supported: /^https?:\/\//i.test(t.url ?? "") });
    });
    const onProgress = (msg: ProgressMessage) => {
      if (msg?.type === "verity:progress") setState((cur) => (cur.s === "loading" ? { s: "loading", stage: msg.stage } : cur));
    };
    chrome.runtime.onMessage.addListener(onProgress);
    return () => chrome.runtime.onMessage.removeListener(onProgress);
  }, [refresh]);

  const check = async () => {
    setState({ s: "loading", stage: "starting" });
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
      ) : <Check state={state} onCheck={check} onDemo={(r) => setState({ s: "report", report: r })} tabInfo={tabInfo} />)}

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
