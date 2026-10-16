import { ApiError, analyze } from "../services/api";
import type { CheckMessage, CheckReply, Extraction, ProgressMessage } from "../types";

const ALLOWED = /^https?:\/\//i;

const EXTRACT_TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 900;

const progress = (stage: ProgressMessage["stage"]) => {
  chrome.runtime.sendMessage({ type: "verity:progress", stage } satisfies ProgressMessage).catch(() => {
    /* popup closed */
  });
};

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });

/** activeTab grants access because the user just clicked the extension. */
async function extractOnce(tabId: number): Promise<Extraction | undefined> {
  const [loaded] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => typeof (globalThis as { __verityExtract?: unknown }).__verityExtract === "function",
  });
  if (!loaded?.result) await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => (globalThis as unknown as { __verityExtract: () => unknown }).__verityExtract(),
  });
  return res?.result as Extraction | undefined;
}

async function runCheck(tabId: number): Promise<CheckReply> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, error: "extraction_failed", message: "That tab is no longer available. Open the page and try again." };
  }
  if (!tab.url || !ALLOWED.test(tab.url)) {
    return { ok: false, error: "unsupported_page", message: "This page format isn’t supported yet." };
  }

  progress("reading");
  let extraction: Extraction | undefined;
  try {
    extraction = await withTimeout(extractOnce(tabId), EXTRACT_TIMEOUT_MS);
    if (!extraction || extraction.evidence.length === 0) {
      // Dynamic pages may still be rendering: wait briefly and try once more.
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      extraction = await withTimeout(extractOnce(tabId), EXTRACT_TIMEOUT_MS);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "timeout") {
      return { ok: false, error: "timeout", message: "The page took too long to read. Retry once it has finished loading." };
    }
    if (/cannot access|extensions gallery|chrome web store|not allowed|permission/i.test(msg)) {
      return { ok: false, error: "permission_denied", message: "Chrome doesn’t allow Verity to read this page. Try a regular product or pricing page." };
    }
    return { ok: false, error: "extraction_failed", message: "We couldn’t read this page. Retry, or try another page." };
  }
  if (!extraction || extraction.evidence.length === 0) {
    return { ok: false, error: "extraction_failed", message: "We couldn’t find offer details on this page." };
  }

  progress("analyzing");
  try {
    const result = await analyze({
      schema_version: "1.0",
      page: extraction.page,
      evidence: extraction.evidence,
      locale: (navigator.language || "en").slice(0, 16),
      currency_hint: null,
    });
    return {
      ok: true,
      report: {
        id: crypto.randomUUID(),
        analyzedAt: new Date().toISOString(),
        url: extraction.page.url,
        evidence: extraction.evidence,
        result,
      },
    };
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError("server", "Something went wrong. Please retry.");
    return { ok: false, error: err.code, message: err.message };
  }
}

chrome.runtime.onMessage.addListener((msg: CheckMessage, _sender, sendResponse) => {
  if (msg?.type !== "verity:check") return false;
  runCheck(msg.tabId).then(sendResponse);
  return true; // async response
});
