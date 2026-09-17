/**
 * In-flight chat runs in the offscreen document, keyed by tab and request so
 * CORTEX_CHAT_ABORT can cancel exactly one stream (Nano session or Gemini fetch).
 */
export class ChatRunRegistry {
  private runs = new Map<string, AbortController>();

  private key(tabId: number, requestId: number): string {
    return `${tabId}:${requestId}`;
  }

  get size(): number {
    return this.runs.size;
  }

  /** Registers a run; a stale run with the same key is aborted first. */
  start(tabId: number, requestId: number): AbortSignal {
    const k = this.key(tabId, requestId);
    this.runs.get(k)?.abort();
    const ac = new AbortController();
    this.runs.set(k, ac);
    return ac.signal;
  }

  abort(tabId: number, requestId: number): boolean {
    const k = this.key(tabId, requestId);
    const ac = this.runs.get(k);
    if (!ac) return false;
    ac.abort();
    this.runs.delete(k);
    return true;
  }

  finish(tabId: number, requestId: number): void {
    this.runs.delete(this.key(tabId, requestId));
  }
}
