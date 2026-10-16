import type { AnalyzeRequest, AnalyzeResponse, ErrorCode } from "../types";

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
export const TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

export async function analyze(req: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch(`${API_BASE}/api/v1/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new ApiError("rate_limited", "Too many checks right now. Wait a minute and retry.");
    if (res.status === 413 || res.status === 422) {
      throw new ApiError("unsupported_page", "This page format isn’t supported yet.");
    }
    if (!res.ok) throw new ApiError("server", "The service had a problem. Please retry.");
    return (await res.json()) as AnalyzeResponse;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (ctrl.signal.aborted) {
      throw new ApiError("timeout", "This is taking longer than expected. Retry — nothing was marked complete.");
    }
    throw new ApiError("network", "Couldn’t reach the Verity service. Check your connection and retry.");
  } finally {
    clearTimeout(timer);
  }
}
