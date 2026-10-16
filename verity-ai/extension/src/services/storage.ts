import type { Report } from "../types";

const CONSENT_KEY = "verity.consent.v1";
const REPORTS_KEY = "verity.reports";

export async function hasConsent(): Promise<boolean> {
  const r = await chrome.storage.local.get(CONSENT_KEY);
  return r[CONSENT_KEY] === true;
}
export const giveConsent = () => chrome.storage.local.set({ [CONSENT_KEY]: true });
export const revokeConsent = () => chrome.storage.local.remove(CONSENT_KEY);

export async function listReports(): Promise<Report[]> {
  const r = await chrome.storage.local.get(REPORTS_KEY);
  return (r[REPORTS_KEY] as Report[] | undefined) ?? [];
}
export async function saveReport(report: Report): Promise<void> {
  const all = await listReports();
  await chrome.storage.local.set({ [REPORTS_KEY]: [report, ...all.filter((x) => x.id !== report.id)].slice(0, 50) });
}
export async function deleteReport(id: string): Promise<void> {
  const all = await listReports();
  await chrome.storage.local.set({ [REPORTS_KEY]: all.filter((x) => x.id !== id) });
}
export const clearReports = () => chrome.storage.local.remove(REPORTS_KEY);

// Recent checks: chrome.storage.session is in-memory only and is wiped when the browser closes.
// It exists so Compare can use an offer you just checked without saving it to disk.
const RECENT_KEY = "verity.recent";
const RECENT_MAX = 3;

export async function listRecent(): Promise<Report[]> {
  const r = await chrome.storage.session.get(RECENT_KEY);
  return (r[RECENT_KEY] as Report[] | undefined) ?? [];
}
export async function addRecent(report: Report): Promise<void> {
  const all = await listRecent();
  await chrome.storage.session.set({ [RECENT_KEY]: [report, ...all.filter((x) => x.id !== report.id)].slice(0, RECENT_MAX) });
}
export const clearRecent = () => chrome.storage.session.remove(RECENT_KEY);
