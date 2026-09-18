/**
 * YouTube transcript capture in the isolated world (Phase 5.6), part of
 * extract.js. Armed by the service worker only when transcripts are on and
 * the page passed the privacy gate. Indexes a video after 30 s of actual
 * playback: captions (json3) first, then the transcript panel, then
 * title / channel / description / chapters.
 */
import {
  captionJson3Url,
  createPlaybackTracker,
  json3ToWindows,
  metadataText,
  parsePlayerResponse,
  pickCaptionTrack,
  transcriptPanelWindows,
  videoIdFromUrl,
  PLAYBACK_THRESHOLD_SEC,
  type PlayerInfo,
  type TranscriptWindow,
} from "../lib/capture/youtube";
import { isExtensionRuntimeAlive, sendRuntimeMessage } from "../shared/extension-runtime";

let armed = false;
let info: PlayerInfo | null = null;
let currentVideo: string | null = null;
const sent = new Set<string>();

function pageUrl(): string {
  const u = new URL(location.href);
  u.hash = "";
  return u.href;
}

async function fetchWindows(p: PlayerInfo): Promise<TranscriptWindow[]> {
  const track = pickCaptionTrack(p.tracks, document.documentElement.lang);
  const url = track ? captionJson3Url(track.baseUrl) : null;
  if (url) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        const windows = json3ToWindows(await res.json());
        if (windows.length) return windows;
      }
    } catch {
      /* fall through */
    }
  }
  return transcriptPanelWindows(document);
}

async function capture(videoId: string): Promise<void> {
  if (!isExtensionRuntimeAlive() || sent.has(videoId)) return;
  if (videoIdFromUrl(location.href) !== videoId) return;
  const p = info && info.videoId === videoId ? info : null;
  const windows = p ? await fetchWindows(p) : transcriptPanelWindows(document);
  const metadata = p ? metadataText(p) : document.title;
  if (!windows.length && !metadata.trim()) return;
  sent.add(videoId);
  await sendRuntimeMessage({
    type: "CORTEX_INDEX_TRANSCRIPT",
    payload: {
      url: pageUrl(),
      videoId,
      title: p?.title || document.title,
      channel: p?.channel ?? "",
      lengthSeconds: p?.lengthSeconds ?? 0,
      windows,
      metadata,
    },
  }).catch(() => undefined);
}

const tracker = createPlaybackTracker(PLAYBACK_THRESHOLD_SEC, () => {
  if (currentVideo) void capture(currentVideo);
});

function onNavigate(): void {
  const id = videoIdFromUrl(location.href);
  if (id === currentVideo) return;
  currentVideo = id;
  info = null;
  tracker.reset();
  window.postMessage({ source: "cortex-yt-request" }, location.origin);
}

/** Idempotent. Starts listening for player info and playback on this tab. */
export function armYouTubeCapture(): void {
  onNavigate();
  if (armed) return;
  armed = true;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data as { source?: string; playerResponse?: unknown } | null;
    if (d?.source !== "cortex-yt-bridge") return;
    const parsed = parsePlayerResponse(d.playerResponse);
    // Untrusted page data: only accept it for the video in the address bar.
    if (parsed && parsed.videoId === videoIdFromUrl(location.href)) info = parsed;
  });
  // Media events do not bubble; capture phase on the document sees them.
  document.addEventListener("playing", () => tracker.playing(), true);
  for (const ev of ["pause", "ended", "waiting", "emptied"]) {
    document.addEventListener(ev, () => tracker.paused(), true);
  }
  document.addEventListener("yt-navigate-finish", onNavigate);
  setInterval(() => {
    if (videoIdFromUrl(location.href) !== currentVideo) onNavigate();
    tracker.tick();
  }, 1000);
}
