import {
  isExtensionRuntimeAlive,
  isInvalidatedExtensionError,
  sendRuntimeMessage,
} from "../shared/extension-runtime";
import {
  getUserSettings,
  getUserSettingsFresh,
} from "../shared/extension-settings";
import { doubleShiftSwitch } from "./double-shift";
import { shouldReindexAfterMutation } from "./mutation-throttle";
import { devLog } from "../lib/extension-logger";

declare global {
  interface Window {
    __cortexMainLoaded?: boolean;
    __cortexInstallKickListener?: boolean;
  }
}

function bootstrap(): void {
  // The overlay UI lives in overlay.js and is injected on demand by the service worker.

function normalizedUrl(): string {
  const u = new URL(location.href);
  u.hash = "";
  return u.href;
}

let indexTimer: number | undefined;
let mutationTimer: number | undefined;
/** When a mutation last caused a re-index request on this page. */
let lastMutationIndexAt: number | null = null;
let currentUrl = normalizedUrl();

function scheduleIndex(delayMs: number): void {
  window.clearTimeout(indexTimer);
  indexTimer = window.setTimeout(() => guardedIndexPage(), delayMs);
}

/** LinkedIn / heavy SPAs paint profile chrome after first paint: retry captures */
function scheduleCaptureRetries(): void {
  const delays = [900, 2600, 5800, 12000];
  for (const d of delays) {
    window.setTimeout(() => guardedIndexPage(), d);
  }
}

/**
 * Asks the service worker to index this page. The worker runs the privacy
 * gate and, only if allowed, injects extract.js to do the actual extraction.
 */
async function indexPage(): Promise<void> {
  try {
    if (!isExtensionRuntimeAlive()) return;
    await sendRuntimeMessage({ type: "CORTEX_INDEX_REQUEST", url: normalizedUrl() });
  } catch (e) {
    if (isInvalidatedExtensionError(e)) return;
    if (!isExtensionRuntimeAlive()) return;
    devLog.warn("[Cortex] index request:", e);
  }
}

/** After extension reload, timers keep firing: bail before touching chrome.* */
function guardedIndexPage(): void {
  if (!isExtensionRuntimeAlive()) return;
  void indexPage().catch((e: unknown) => {
    if (isInvalidatedExtensionError(e)) return;
    if (!isExtensionRuntimeAlive()) return;
    devLog.warn("[Cortex] index:", e);
  });
}

function onLocationLikeChange(reason: "spa" | "mutation"): void {
  const next = normalizedUrl();
  if (next !== currentUrl) {
    currentUrl = next;
    scheduleIndex(reason === "spa" ? 900 : 1400);
    scheduleCaptureRetries();
    return;
  }

  if (reason === "mutation") {
    // Pages that never settle (YouTube, feeds) would otherwise ask for a
    // re-index every few seconds and exhaust the per tab extraction budget.
    if (!shouldReindexAfterMutation(lastMutationIndexAt, Date.now())) return;
    lastMutationIndexAt = Date.now();
    scheduleIndex(3200);
  }
}

const _push = history.pushState;
history.pushState = function (
  ...args: Parameters<typeof history.pushState>
): ReturnType<typeof history.pushState> {
  const out = _push.apply(history, args);
  onLocationLikeChange("spa");
  return out;
};

const _replace = history.replaceState;
history.replaceState = function (
  ...args: Parameters<typeof history.replaceState>
): ReturnType<typeof history.replaceState> {
  const out = _replace.apply(history, args);
  onLocationLikeChange("spa");
  return out;
};
window.addEventListener("popstate", () => onLocationLikeChange("spa"));

const mo = new MutationObserver(() => {
  window.clearTimeout(mutationTimer);
  mutationTimer = window.setTimeout(() => onLocationLikeChange("mutation"), 950);
});
mo.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === "complete") {
  scheduleIndex(1800);
  scheduleCaptureRetries();
} else {
  window.addEventListener(
    "load",
    () => {
      scheduleIndex(1800);
      scheduleCaptureRetries();
    },
    { once: true }
  );
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") scheduleIndex(600);
});

if (!window.__cortexInstallKickListener) {
  window.__cortexInstallKickListener = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "CORTEX_PING") {
      sendResponse({ ok: true as const });
      return true;
    }
    if (msg?.type === "CORTEX_FORCE_INDEX_NOW") {
      scheduleIndex(120);
      scheduleCaptureRetries();
    }
    return undefined;
  });
}

/**
 * Double tap of Shift. This is the only keyboard way to open the panel.
 * The gesture is recognised here and asks the worker to open it, the same
 * request the popup's "Open search" button sends.
 */
function toggleCortexPanel(panelOpen: boolean): void {
  if (!isExtensionRuntimeAlive()) return;
  // Open, or close again on a second double tap. The service worker relays
  // the close to this tab, because content scripts cannot message each other.
  const type = panelOpen ? "CORTEX_CLOSE_SEARCH" : "CORTEX_POPUP_OPEN_SEARCH";
  void sendRuntimeMessage({ type }).catch((e: unknown) => {
    if (isInvalidatedExtensionError(e)) return;
    devLog.warn("[Cortex] double Shift:", e);
  });
}

const setDoubleShift = doubleShiftSwitch({ onTrigger: toggleCortexPanel });
// Storage key of CortexUserSettings (see shared/extension-settings.ts).
const USER_SETTINGS_KEY = "cortex_user_settings";

void getUserSettings()
  .then((s) => setDoubleShift(s.doubleShiftShortcutEnabled))
  .catch(() => {
    /* storage unavailable: leave the detector off */
  });

// Turning the setting off applies to open tabs, not only to the next load.
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local" || !changes[USER_SETTINGS_KEY]) return;
  void getUserSettingsFresh()
    .then((s) => setDoubleShift(s.doubleShiftShortcutEnabled))
    .catch(() => {
      /* ignore */
    });
});

}

if (!window.__cortexMainLoaded) {
  window.__cortexMainLoaded = true;
  bootstrap();
}
