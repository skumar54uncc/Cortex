/**
 * resurface-chip.js: injected by the service worker only when a "Seen this
 * before" chip is due for this tab (setting on, page indexed, strong match,
 * not shown today). Renders one chip and nothing else.
 */
import { mountResurfaceChip } from "./resurface-chip-view";

declare global {
  interface Window {
    __cortexResurfaceLoaded?: boolean;
  }
}

if (!window.__cortexResurfaceLoaded) {
  window.__cortexResurfaceLoaded = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "CORTEX_RESURFACE_SHOW") return undefined;
    const r = mountResurfaceChip(document, {
      title: String(msg.title ?? ""),
      url: String(msg.url ?? ""),
    });
    sendResponse({ ok: r.mounted });
    return undefined;
  });
}
