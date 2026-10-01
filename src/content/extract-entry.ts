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
import { armYouTubeCapture } from "./youtube-capture";
import { extractTables } from "../lib/capture/tables";
import { extractImages } from "../lib/capture/images";
import { collectImageInputs } from "./image-inputs";
import type { NewChunk } from "../db/schema";

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

/** Which optional captures the service worker enabled for this page. */
interface CaptureFlags {
  tables: boolean;
  images: boolean;
  /** On-device descriptions: user setting and policy both allow it. */
  imageDescriptions: boolean;
}

async function extractAndIndex(flags: CaptureFlags): Promise<void> {
  if (running || !isExtensionRuntimeAlive()) return;
  running = true;
  try {
    // Tables first (Phase 5.7): captured tables are left out of the article text.
    const tables = flags.tables ? extractTables(document) : { chunks: [], capturedTableIndexes: [] };
    const extraChunks: NewChunk[] = tables.chunks.map((c) => ({ ...c, text: redactPII(c.text).redacted }));
    // Images (Phase 5.8): alt, caption, title and heading text only.
    const images = flags.images ? extractImages(document, location.href) : null;
    if (images) extraChunks.push({ ...images, text: redactPII(images.text).redacted });
    const imageSrcs = (images?.locator as { images?: { src: string }[] } | undefined)?.images?.map((i) => i.src) ?? [];
    const imageInputs = images && flags.imageDescriptions ? collectImageInputs(document, imageSrcs) : [];
    const raw = extractPageText(document, undefined, { dropTableIndexes: tables.capturedTableIndexes });
    const title = redactPII(raw.title).redacted;
    const text = redactPII(raw.text).redacted;

    const host = location.hostname;
    // LinkedIn profile / company pages also feed people memory (Phase 5.1).
    const person = /(^|\.)linkedin\.com$/i.test(host)
      ? parseLinkedInPage(document, location.href)
      : null;

    const localMin =
      host.includes("linkedin.com") ? 28 : host.includes("twitter.com") || host === "x.com" ? 38 : 72;
    const textOk = text.length >= localMin;
    if (!textOk && !person && !extraChunks.length) return;

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
        ...(extraChunks.length ? { extraChunks } : {}),
        ...(imageInputs.length ? { imageInputs } : {}),
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
    // YouTube watch page with transcripts on (decided by the service worker).
    if (msg.youtube === true) armYouTubeCapture();
    void extractAndIndex({
      tables: msg.tables === true,
      images: msg.images === true,
      imageDescriptions: msg.imageDescriptions === true,
    });
    return undefined;
  });
}
