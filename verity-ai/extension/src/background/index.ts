import { extractPage } from "../content/extract";
import { ApiError, analyze } from "../services/api";
import type { CheckMessage, CheckReply, Extraction } from "../types";

const ALLOWED = /^https?:\/\//i;

async function runCheck(tabId: number): Promise<CheckReply> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !ALLOWED.test(tab.url)) {
    return { ok: false, error: "unsupported_page", message: "This page format isn’t supported yet." };
  }

  let extraction: Extraction | undefined;
  try {
    // activeTab grants access because the user just clicked the extension.
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: extractPage });
    extraction = res?.result as Extraction | undefined;
  } catch {
    return { ok: false, error: "extraction_failed", message: "We couldn’t read this page. Retry, or try another page." };
  }
  if (!extraction || extraction.evidence.length === 0) {
    return { ok: false, error: "extraction_failed", message: "We couldn’t find offer details on this page." };
  }

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
