/**
 * Optional local-dev ingest hook. Shipped builds keep this a pure noop:
 * no loopback ingest URL, no fetch, no session ids — avoids accidental telemetry
 * or data leak if a listener is running on the machine.
 *
 * To use during Cursor DEBUG MODE only, temporarily restore a fetch to your
 * local ingest server inside the enabled branch below (never commit enabled).
 */
const CORTEX_AGENT_DEBUG_INGEST_ENABLED = false;

/** Optional debug ingest for local Cursor DEBUG MODE — noop unless enabled above. */
export function agentDebugLog(_p: {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  runId?: string;
}): void {
  if (!CORTEX_AGENT_DEBUG_INGEST_ENABLED) return;
  // Intentionally empty when disabled. Do not add a hardcoded ingest URL here.
}
