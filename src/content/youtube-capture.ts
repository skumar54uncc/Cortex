/**
 * YouTube capture in the isolated world (Phase 5.6), part of extract.js. Armed
 * by the service worker only when transcripts are on and the page passed the
 * privacy gate, so every privacy toggle still decides whether any of this runs.
 *
 * Two phases per video, both over the same gated CORTEX_INDEX_TRANSCRIPT
 * channel:
 *   1. identity (title, channel, description) a few seconds after landing on
 *      the watch page, so "what did I watch today" knows about every video,
 *      including ones with no captions and ones watched for ten seconds;
 *   2. the transcript after 30 s of real playback, which replaces phase 1.
 *
 * All timing lives in createYouTubeCaptureController; this file is the wiring.
 */
import {
  captionJson3Url,
  createYouTubeCaptureController,
  json3ToWindows,
  pickCaptionTrack,
  transcriptPanelWindows,
  videoIdFromUrl,
  type PlayerInfo,
  type TranscriptPayload,
  type TranscriptWindow,
  type YouTubeCaptureController,
} from "../lib/capture/youtube";
import { isExtensionRuntimeAlive, sendRuntimeMessage } from "../shared/extension-runtime";

let armed = false;
let controller: YouTubeCaptureController | null = null;

/**
 * Whether media is playing right now. The media events are the reliable
 * signal while they arrive; the element state covers the gaps (a video that
 * was already rolling when YouTube swapped the page under it never fires
 * `playing` again).
 */
let mediaPlaying = false;

function domPlaying(): boolean {
  for (const v of Array.from(document.querySelectorAll("video"))) {
    if (!v.paused && !v.ended) return true;
  }
  return false;
}

async function fetchWindows(p: PlayerInfo | null): Promise<TranscriptWindow[]> {
  const track = p ? pickCaptionTrack(p.tracks, document.documentElement.lang) : null;
  const url = track ? captionJson3Url(track.baseUrl) : null;
  if (url) {
    try {
      // captionJson3Url already restricts to https youtube.com /api/timedtext.
      // Omit cookies: public captions work without auth; private/age-gated
      // videos fall through to the on-page transcript panel instead of sending
      // the user's YouTube session cookies on a credentialed fetch.
      const res = await fetch(url, { credentials: "omit" });
      if (res.ok) {
        const windows = json3ToWindows(await res.json());
        if (windows.length) return windows;
      }
    } catch {
      /* fall through to the transcript panel */
    }
  }
  return transcriptPanelWindows(document);
}

async function send(payload: TranscriptPayload): Promise<boolean> {
  if (!isExtensionRuntimeAlive()) return false;
  const res = await sendRuntimeMessage<{ ok?: boolean }>({
    type: "CORTEX_INDEX_TRANSCRIPT",
    payload,
  }).catch(() => undefined);
  return res?.ok === true;
}

function getController(): YouTubeCaptureController {
  controller ??= createYouTubeCaptureController({
    currentUrl: () => location.href,
    getDocument: () => document,
    isPlaying: () => mediaPlaying || domPlaying(),
    requestPlayerInfo: () => {
      try {
        window.postMessage({ source: "cortex-yt-request" }, location.origin);
      } catch {
        /* origin mismatch: nothing to do */
      }
    },
    fetchWindows,
    send,
  });
  return controller;
}

let ticking = false;
function tick(): void {
  if (ticking || !isExtensionRuntimeAlive()) return;
  ticking = true;
  void getController()
    .tick()
    .catch(() => undefined)
    .finally(() => {
      ticking = false;
    });
}

/**
 * A navigation inside YouTube changes the URL long before the new player is
 * ready, so the next second is polled hard rather than sampled once.
 */
function kick(): void {
  tick();
  for (const d of [200, 700, 1500, 3000]) window.setTimeout(tick, d);
}

/** Idempotent. Starts following this tab's watch pages. */
export function armYouTubeCapture(): void {
  if (armed) {
    kick();
    return;
  }
  armed = true;

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data as { source?: string; playerResponse?: unknown } | null;
    if (d?.source !== "cortex-yt-bridge") return;
    getController().offerPlayerInfo(d.playerResponse);
    tick();
  });

  // Media events do not bubble; capture phase on the document sees them.
  for (const ev of ["playing", "play", "timeupdate"]) {
    document.addEventListener(ev, () => {
      mediaPlaying = true;
    }, true);
  }
  for (const ev of ["pause", "ended", "waiting", "emptied", "stalled", "abort"]) {
    document.addEventListener(ev, () => {
      mediaPlaying = false;
    }, true);
  }

  // SPA navigation: YouTube's own event, the History API, and a poll as the
  // backstop, because YouTube does not always fire what it used to.
  for (const ev of ["yt-navigate-finish", "yt-page-data-updated", "yt-navigate-start"]) {
    document.addEventListener(ev, kick);
  }
  window.addEventListener("popstate", kick);
  window.addEventListener("pageshow", kick);

  let lastVideo = videoIdFromUrl(location.href);
  window.setInterval(() => {
    const id = videoIdFromUrl(location.href);
    if (id !== lastVideo) {
      lastVideo = id;
      kick();
      return;
    }
    tick();
  }, 1000);

  kick();
}
