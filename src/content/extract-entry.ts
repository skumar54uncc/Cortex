/**
 * extract.js: injected by the service worker only after the privacy gate
 * allowed indexing this tab (see src/lib/extract-injector.ts). Runs in the
 * extension's isolated world, next to content.js.
 *
 * On CORTEX_EXTRACT_NOW it extracts readable text (Readability on a sanitized
 * clone), redacts PII, summarizes on device when possible, and sends
 * CORTEX_INDEX. The service worker re-checks the gate on that message.
 */
import { extractPageText } from "./extract";
import { redactPII } from "../lib/pii-filter";
import { summarizeBestEffort } from "../lib/summarize";
import {
  isExtensionRuntimeAlive,
  isInvalidatedExtensionError,
  sendRuntimeMessage,
} from "../shared/extension-runtime";
import { devLog } from "../lib/extension-logger";
import { parseLinkedInPage } from "../lib/capture/linkedin";

declare global {
  interface Window {
    __cortexExtractLoaded?: boolean;
  }
}

function normalizedUrl(): string {
  const u = new URL(location.href);
  u.hash = "";
  return u.href;
}

let running = false;

async function extractAndIndex(): Promise<void> {
  if (running || !isExtensionRuntimeAlive()) return;
  running = true;
  try {
    const raw = extractPageText(document);
    const title = redactPII(raw.title).redacted;
    const text = redactPII(raw.text).redacted;

    const host = location.hostname;
    // LinkedIn profile / company pages also feed people memory (Phase 5.1).
    const person = /(^|\.)linkedin\.com$/i.test(host) ? parseLinkedInPage(document, location.href) : null;

    const localMin =
      host.includes("linkedin.com") ? 28 : host.includes("twitter.com") || host === "x.com" ? 38 : 72;
    const textOk = text.length >= localMin;
    if (!textOk && !person) return;

    const summary = textOk ? await summarizeBestEffort(text) : "";
    if (!isExtensionRuntimeAlive()) return;

    await sendRuntimeMessage({
      type: "CORTEX_INDEX",
      payload: {
        url: normalizedUrl(),
        title,
        text: textOk ? text : "",
        summary,
        visitedAt: Date.now(),
        ...(person ? { person } : {}),
      },
    });
  } catch (e) {
    if (isInvalidatedExtensionError(e) || !isExtensionRuntimeAlive()) return;
    devLog.warn("[Cortex] extract:", e);
  } finally {
    running = false;
  }
}

if (!window.__cortexExtractLoaded) {
  window.__cortexExtractLoaded = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "CORTEX_EXTRACT_NOW") return undefined;
    sendResponse({ ok: true as const });
    void extractAndIndex();
    return undefined;
  });
}
