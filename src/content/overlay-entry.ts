/**
 * Entry for overlay.js: injected by the service worker with
 * chrome.scripting.executeScript only when the user opens Cortex. Keeps the
 * always-on content.js to extraction and messaging.
 */
import { mountOverlay } from "./overlay";

declare global {
  interface Window {
    __cortexOverlayLoaded?: boolean;
  }
}

if (!window.__cortexOverlayLoaded) {
  window.__cortexOverlayLoaded = true;
  mountOverlay();
}
