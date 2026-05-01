// #region agent log
/**
 * Disabled in shipped builds: localhost ingest must not run for end users
 * (telemetry / accidental data leak if a listener is running).
 * Set to true only in local dev when intentionally using the ingest server.
 */
const CORTEX_AGENT_DEBUG_INGEST_ENABLED = false;

/** Optional debug ingest for local Cursor DEBUG MODE — noop unless enabled above. */
export function agentDebugLog(p: {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  runId?: string;
}): void {
  if (!CORTEX_AGENT_DEBUG_INGEST_ENABLED) return;

  fetch("http://127.0.0.1:7424/ingest/20586d25-1e13-43d3-91c2-b7a736125a56", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "4b56d4",
    },
    body: JSON.stringify({
      sessionId: "4b56d4",
      timestamp: Date.now(),
      ...p,
      data: p.data ?? {},
    }),
  }).catch(() => {});
}
// #endregion agent log
