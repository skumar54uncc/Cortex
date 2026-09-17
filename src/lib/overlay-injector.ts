/**
 * Opens the in-page overlay on a tab. The overlay bundle (overlay.js) is not a
 * declared content script: it is injected on demand so that every http(s)
 * page only pays for content.js (extraction + messaging).
 */
export const OVERLAY_BUNDLE_FILE = "overlay.js";

export interface OverlayInjectorDeps {
  /** Send CORTEX_OPEN_SEARCH; resolves true when the overlay acknowledged. */
  deliverOpen: (tabId: number) => Promise<boolean>;
  /** chrome.scripting.executeScript for the given files. */
  inject: (tabId: number, files: string[]) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  isInjectableUrl: (url: string) => boolean;
  getTabUrl: (tabId: number) => Promise<string | null>;
}

export const OVERLAY_OPEN_RETRIES = 4;
export const OVERLAY_OPEN_RETRY_MS = 24;

export async function openOverlayOnTab(
  tabId: number,
  deps: OverlayInjectorDeps
): Promise<boolean> {
  const url = await deps.getTabUrl(tabId);
  if (url == null || !deps.isInjectableUrl(url)) return false;

  if (await deps.deliverOpen(tabId)) return true;

  try {
    await deps.inject(tabId, [OVERLAY_BUNDLE_FILE]);
  } catch {
    return false;
  }

  for (let i = 0; i < OVERLAY_OPEN_RETRIES; i++) {
    if (await deps.deliverOpen(tabId)) return true;
    if (i < OVERLAY_OPEN_RETRIES - 1) await deps.sleep(OVERLAY_OPEN_RETRY_MS);
  }
  return false;
}
