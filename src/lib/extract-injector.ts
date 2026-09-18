/**
 * Extraction on demand (release 1.2.0, Phase 5 task 0.2).
 *
 * content.js only watches the page and asks to be indexed. The service worker
 * runs the privacy gate first; only when indexing is allowed does it inject
 * extract.js (Readability, tables, images, LinkedIn, YouTube) into the tab and
 * ask it to extract. Blocked, paused, sensitive and incognito pages never run
 * the extractor at all.
 */
export const EXTRACT_BUNDLE_FILE = "extract.js";

export interface ExtractInjectorDeps {
  gate: () => Promise<{ skip: true; reason: string } | { skip: false }>;
  /** Sends CORTEX_EXTRACT_NOW; true when the extractor acknowledged. */
  deliver: (tabId: number) => Promise<boolean>;
  inject: (tabId: number, files: string[]) => Promise<void>;
}

export type ExtractionRequestResult =
  | { ok: true; injected: boolean }
  | { ok: false; reason: string };

export async function requestExtraction(
  tabId: number,
  deps: ExtractInjectorDeps
): Promise<ExtractionRequestResult> {
  const gate = await deps.gate();
  if (gate.skip) return { ok: false, reason: gate.reason };

  if (await deps.deliver(tabId)) return { ok: true, injected: false };

  try {
    await deps.inject(tabId, [EXTRACT_BUNDLE_FILE]);
  } catch {
    return { ok: false, reason: "inject_failed" };
  }
  if (await deps.deliver(tabId)) return { ok: true, injected: true };
  return { ok: false, reason: "no_extractor" };
}
