import { extractPageText } from "./extract";
import { redactPII } from "../lib/pii-filter";
import { summarizeBestEffort } from "../lib/summarize";
import { mountOverlay } from "./overlay";
import { getUserSettings } from "../shared/extension-settings";
import {
  isExtensionRuntimeAlive,
  isInvalidatedExtensionError,
  sendRuntimeMessage,
} from "../shared/extension-runtime";
import { devLog } from "../lib/extension-logger";

declare global {
  interface Window {
    __cortexMainLoaded?: boolean;
    __cortexInstallKickListener?: boolean;
  }
}

function bootstrap(): void {
  mountOverlay();

function normalizedUrl(): string {
  const u = new URL(location.href);
  u.hash = "";
  return u.href;
}

let indexTimer: number | undefined;
let mutationTimer: number | undefined;
let currentUrl = normalizedUrl();

function scheduleIndex(delayMs: number): void {
  window.clearTimeout(indexTimer);
  indexTimer = window.setTimeout(() => guardedIndexPage(), delayMs);
}

/** LinkedIn / heavy SPAs paint profile chrome after first paint — retry captures */
function scheduleCaptureRetries(): void {
  const delays = [900, 2600, 5800, 12000];
  for (const d of delays) {
    window.setTimeout(() => guardedIndexPage(), d);
  }
}

async function indexPage(): Promise<void> {
  try {
    if (!isExtensionRuntimeAlive()) return;

    const settings = await getUserSettings();
    if (!isExtensionRuntimeAlive()) return;
    if (settings.indexingPaused) return;

    const raw = extractPageText(document);
    const titleRed = redactPII(raw.title);
    const textRed = redactPII(raw.text);
    const title = titleRed.redacted;
    const text = textRed.redacted;
    const url = normalizedUrl();

    const host = location.hostname;
    const localMin =
      host.includes("linkedin.com") ? 28 : host.includes("twitter.com") || host === "x.com" ? 38 : 72;

    if (text.length < localMin) return;

    const summary = await summarizeBestEffort(text);
    if (!isExtensionRuntimeAlive()) return;

    await sendRuntimeMessage({
      type: "CORTEX_INDEX",
      payload: {
        url,
        title,
        text,
        summary,
        visitedAt: Date.now(),
      },
    });
  } catch (e) {
    if (isInvalidatedExtensionError(e)) return;
    if (!isExtensionRuntimeAlive()) return;
    devLog.warn("[Cortex] index:", e);
  }
}

/** After extension reload, timers keep firing — bail before touching chrome.* */
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
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "CORTEX_FORCE_INDEX_NOW") {
      scheduleIndex(120);
      scheduleCaptureRetries();
    }
    return undefined;
  });
}

// Ctrl+Shift+K / Alt+Shift+C are handled via chrome.commands only — do not also listen here
// or the same keypress toggles twice (open then close).

}

if (!window.__cortexMainLoaded) {
  window.__cortexMainLoaded = true;
  bootstrap();
}
