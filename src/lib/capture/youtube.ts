/**
 * YouTube transcripts (Phase 5.6). Pure helpers used by extract.js (isolated
 * world) and the service worker. The player response comes from the page's
 * main world through youtube-bridge.js and is untrusted: it is reduced to a
 * few fields, its video id must match the tab URL, and caption URLs are only
 * accepted on youtube.com/api/timedtext.
 */
import type { ChunkLocator, NewChunk } from "../../db/schema";

export const TRANSCRIPT_WINDOW_SEC = 60;
export const MAX_TRANSCRIPT_WINDOWS = 240; // 4 hours
export const MAX_WINDOW_CHARS = 4000;
export const PLAYBACK_THRESHOLD_SEC = 30;

/**
 * A transcript chunk shorter than this is a locator with a couple of words
 * attached: retrieval matches it, but no answer can be written from it. Short
 * caption windows are merged until they clear the floor.
 */
export const MIN_WINDOW_CHARS = 80;
/** Below this much transcript in total, the video is indexed from its metadata instead. */
export const MIN_TRANSCRIPT_CHARS = 120;
/** A document needs at least a real title to be worth storing. */
export const MIN_METADATA_CHARS = 12;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function isYouTubeHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "youtube.com" || h.endsWith(".youtube.com");
}

export function videoIdFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  let id: string | null = null;
  if (u.hostname.toLowerCase() === "youtu.be") {
    id = u.pathname.slice(1).split("/")[0] ?? null;
  } else if (isYouTubeHost(u.hostname)) {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      id = m?.[1] ?? null;
    }
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: "asr";
  name: string;
}

export interface PlayerInfo {
  videoId: string;
  title: string;
  channel: string;
  description: string;
  lengthSeconds: number;
  tracks: CaptionTrack[];
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function parsePlayerResponse(raw: unknown): PlayerInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const vd = r.videoDetails as Record<string, unknown> | undefined;
  const videoId = vd?.videoId;
  if (typeof videoId !== "string" || !VIDEO_ID_RE.test(videoId)) return null;
  const list = (
    (r.captions as { playerCaptionsTracklistRenderer?: { captionTracks?: unknown } } | undefined)
      ?.playerCaptionsTracklistRenderer?.captionTracks
  );
  const tracks: CaptionTrack[] = [];
  if (Array.isArray(list)) {
    for (const t of list.slice(0, 50)) {
      const o = t as Record<string, unknown>;
      const baseUrl = str(o.baseUrl, 2000);
      const languageCode = str(o.languageCode, 20);
      if (!baseUrl || !languageCode) continue;
      const nm = o.name as { simpleText?: unknown } | undefined;
      tracks.push({
        baseUrl,
        languageCode,
        ...(o.kind === "asr" ? { kind: "asr" as const } : {}),
        name: str(nm?.simpleText, 100),
      });
    }
  }
  return {
    videoId,
    title: str(vd?.title, 300),
    channel: str(vd?.author, 200),
    description: str(vd?.shortDescription, 5000),
    lengthSeconds: Number(vd?.lengthSeconds) || 0,
    tracks,
  };
}

export function pickCaptionTrack(tracks: CaptionTrack[], pageLang?: string): CaptionTrack | null {
  const lang = (pageLang ?? "").toLowerCase().split("-")[0];
  const is = (t: CaptionTrack, l: string) => t.languageCode.toLowerCase().split("-")[0] === l;
  const manual = tracks.filter((t) => t.kind !== "asr");
  const asr = tracks.filter((t) => t.kind === "asr");
  for (const pool of [manual, asr]) {
    const byPage = lang ? pool.find((t) => is(t, lang)) : undefined;
    if (byPage) return byPage;
    const en = pool.find((t) => is(t, "en"));
    if (en) return en;
    if (pool[0]) return pool[0];
  }
  return null;
}

export function captionJson3Url(baseUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !isYouTubeHost(u.hostname) || u.pathname !== "/api/timedtext") return null;
  u.searchParams.set("fmt", "json3");
  return u.href;
}

export interface TranscriptWindow {
  startSec: number;
  endSec: number;
  text: string;
}

function toWindows(items: { sec: number; text: string }[], windowSec: number): TranscriptWindow[] {
  const byIdx = new Map<number, string[]>();
  for (const it of items) {
    const text = it.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const idx = Math.floor(it.sec / windowSec);
    if (!byIdx.has(idx)) byIdx.set(idx, []);
    byIdx.get(idx)!.push(text);
  }
  return [...byIdx.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, parts]) => ({
      startSec: idx * windowSec,
      endSec: idx * windowSec + windowSec,
      text: parts.join(" ").slice(0, MAX_WINDOW_CHARS),
    }));
}

export function json3ToWindows(json: unknown, windowSec: number = TRANSCRIPT_WINDOW_SEC): TranscriptWindow[] {
  const events = (json as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  const items: { sec: number; text: string }[] = [];
  for (const e of events) {
    const ev = e as { tStartMs?: unknown; segs?: unknown };
    if (typeof ev.tStartMs !== "number" || !Array.isArray(ev.segs)) continue;
    const text = ev.segs.map((s) => (typeof (s as { utf8?: unknown }).utf8 === "string" ? (s as { utf8: string }).utf8 : "")).join("");
    items.push({ sec: ev.tStartMs / 1000, text });
  }
  return toWindows(items, windowSec);
}

/**
 * Merges consecutive caption windows until each one carries at least
 * `minChars` of text, so no chunk is stored as a timestamp with a few words.
 * A short tail is folded back into the window before it.
 */
export function mergeShortWindows(
  windows: TranscriptWindow[],
  minChars: number = MIN_WINDOW_CHARS
): TranscriptWindow[] {
  const out: TranscriptWindow[] = [];
  let cur: TranscriptWindow | null = null;
  const join = (a: TranscriptWindow, b: TranscriptWindow): TranscriptWindow => ({
    startSec: a.startSec,
    endSec: Math.max(a.endSec, b.endSec),
    text: `${a.text} ${b.text}`.slice(0, MAX_WINDOW_CHARS),
  });
  for (const w of windows) {
    const text = w.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const next: TranscriptWindow = { startSec: w.startSec, endSec: w.endSec, text };
    if (!cur) {
      cur = next;
    } else if (cur.text.length < minChars) {
      cur = join(cur, next);
    } else {
      out.push(cur);
      cur = next;
    }
  }
  if (cur) {
    if (out.length && cur.text.length < minChars) out[out.length - 1] = join(out[out.length - 1]!, cur);
    else out.push(cur);
  }
  return out;
}

/**
 * Caption windows that are actually worth storing: merged to the chunk floor,
 * and dropped wholesale when the video barely has any words in it (the caller
 * then indexes the video from its metadata instead).
 */
export function usableTranscriptWindows(windows: TranscriptWindow[]): TranscriptWindow[] {
  const merged = mergeShortWindows(windows);
  const total = merged.reduce((n, w) => n + w.text.length, 0);
  return total >= MIN_TRANSCRIPT_CHARS ? merged : [];
}

/** Flattened transcript text, used when there is too little of it to chunk. */
export function transcriptSnippet(windows: TranscriptWindow[], max = 1200): string {
  return windows
    .map((w) => w.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, max);
}

function parseClock(s: string): number | null {
  const parts = s.trim().split(":").map((x) => Number(x));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function transcriptPanelWindows(doc: Document, windowSec: number = TRANSCRIPT_WINDOW_SEC): TranscriptWindow[] {
  const items: { sec: number; text: string }[] = [];
  doc.querySelectorAll("ytd-transcript-segment-renderer").forEach((seg) => {
    const ts = seg.querySelector(".segment-timestamp")?.textContent ?? "";
    const text = seg.querySelector(".segment-text")?.textContent ?? "";
    const sec = parseClock(ts);
    if (sec != null) items.push({ sec, text });
  });
  return toWindows(items, windowSec);
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** Title / channel / description for a watch page, from any source. */
export interface VideoMetadata {
  title: string;
  channel: string;
  description: string;
}

function clean(s: string | null | undefined, max: number, keepLines = false): string {
  const t = keepLines
    ? (s ?? "")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
    : (s ?? "").replace(/\s+/g, " ");
  return t.trim().slice(0, max);
}

/** "Some title - YouTube" is the tab title, not the video title. */
export function stripYouTubeSuffix(title: string): string {
  return title.replace(/\s*[-\u2013\u2014]\s*YouTube\s*$/i, "").trim();
}

const TITLE_SELECTORS = [
  "ytd-watch-metadata h1 yt-formatted-string",
  "ytd-watch-metadata #title h1",
  "h1.ytd-watch-metadata",
  "#title h1",
  "h1.title",
  'meta[name="title"]',
  'meta[property="og:title"]',
];

const CHANNEL_SELECTORS = [
  "ytd-watch-metadata ytd-channel-name a",
  "#owner ytd-channel-name a",
  "#upload-info #channel-name a",
  "ytd-channel-name a",
  'span[itemprop="author"] link[itemprop="name"]',
  'link[itemprop="name"]',
  'meta[itemprop="channelName"]',
];

const DESCRIPTION_SELECTORS = [
  "#description-inline-expander yt-attributed-string",
  "ytd-text-inline-expander #attributed-snippet-text",
  "#description-inline-expander",
  "ytd-watch-metadata #description",
  "#description",
  'meta[name="description"]',
  'meta[property="og:description"]',
];

function firstText(doc: Document, selectors: string[], max: number, keepLines = false): string {
  for (const sel of selectors) {
    for (const el of Array.from(doc.querySelectorAll(sel)).slice(0, 4)) {
      const value =
        el.getAttribute("content") ?? el.getAttribute("title") ?? el.textContent ?? "";
      const text = clean(value, max, keepLines);
      if (text) return text;
    }
  }
  return "";
}

/**
 * Reads the video's identity out of the watch page itself. This is the only
 * source when the page world never hands over a player response (the common
 * case right after an SPA navigation), and it costs no network request: it is
 * the page the user is already looking at.
 */
export function readWatchPageMetadata(doc: Document): VideoMetadata {
  return {
    title: stripYouTubeSuffix(firstText(doc, TITLE_SELECTORS, 300) || clean(doc.title, 300)),
    channel: firstText(doc, CHANNEL_SELECTORS, 200),
    description: firstText(doc, DESCRIPTION_SELECTORS, 5000, true),
  };
}

/** Player response first, page DOM for whatever it left empty. */
export function mergeMetadata(primary: VideoMetadata | null, fallback: VideoMetadata): VideoMetadata {
  return {
    title: primary?.title || fallback.title,
    channel: primary?.channel || fallback.channel,
    description: primary?.description || fallback.description,
  };
}

export function playerMetadata(p: PlayerInfo): VideoMetadata {
  return { title: p.title, channel: p.channel, description: p.description };
}

/**
 * The indexed text for a video: title, channel, chapter list and description,
 * optionally followed by whatever few words of transcript there were.
 */
export function metadataText(source: PlayerInfo | VideoMetadata, extra = ""): string {
  const m: VideoMetadata = {
    title: source.title,
    channel: source.channel,
    description: source.description,
  };
  const chapters: string[] = [];
  for (const line of m.description.split(/\r?\n/)) {
    const mt = line.trim().match(/^(\d{1,2}(?::\d{2}){1,2})\s+(.+)$/);
    if (mt) chapters.push(`${mt[2]!.trim()} (${mt[1]})`);
  }
  return [
    m.title,
    m.channel ? `Channel: ${m.channel}` : "",
    chapters.length ? `Chapters: ${chapters.join("; ")}` : "",
    m.description,
    extra ? `Transcript: ${extra}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}

export function transcriptChunks(videoId: string, windows: TranscriptWindow[]): NewChunk[] {
  return windows.slice(0, MAX_TRANSCRIPT_WINDOWS).map((w, i) => {
    const locator: ChunkLocator = { videoId, startSec: w.startSec, endSec: w.endSec };
    return {
      ord: 1000 + i,
      text: `[${formatClock(w.startSec)}] ${w.text}`,
      kind: "transcript" as const,
      locator,
    };
  });
}

export function youtubeCitationHref(loc: { videoId: string; startSec: number; endSec?: number }): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(loc.videoId)}&t=${Math.max(0, Math.floor(loc.startSec))}s`;
}

export interface PlaybackTracker {
  playing: () => void;
  paused: () => void;
  /**
   * `playing` re-states whether media is playing right now. Passing it makes
   * the tracker poll-driven, so a missed media event (or a reset that lands
   * between two of them, as happens on every SPA navigation) cannot strand the
   * tracker in the "not playing" state forever.
   */
  tick: (playing?: boolean) => void;
  reset: () => void;
  watchedMs: () => number;
}

/** Calls onReady once after `thresholdSec` of accumulated playing time. */
export function createPlaybackTracker(
  thresholdSec: number,
  onReady: () => void,
  now: () => number = Date.now
): PlaybackTracker {
  let acc = 0;
  let since: number | null = null;
  let fired = false;
  const total = (): number => acc + (since != null ? now() - since : 0);
  const start = (): void => {
    if (since == null) since = now();
  };
  const stop = (): void => {
    if (since != null) {
      acc += now() - since;
      since = null;
    }
  };
  const check = (): void => {
    if (!fired && total() >= thresholdSec * 1000) {
      fired = true;
      onReady();
    }
  };
  return {
    playing: start,
    paused: () => {
      stop();
      check();
    },
    tick: (playing?: boolean) => {
      if (playing === true) start();
      else if (playing === false) stop();
      check();
    },
    reset: () => {
      acc = 0;
      since = null;
      fired = false;
    },
    watchedMs: total,
  };
}

export interface TranscriptPayload {
  url: string;
  videoId: string;
  title: string;
  channel: string;
  lengthSeconds: number;
  windows: TranscriptWindow[];
  metadata: string;
}

function stripHash(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}

/**
 * Service worker side validation of CORTEX_INDEX_TRANSCRIPT. The payload is
 * built from page data, so it must describe the sender tab's own video and
 * every field is type-checked and capped.
 */
export function sanitizeTranscriptPayload(raw: unknown, senderTabUrl: string): TranscriptPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  let url: string;
  let tabUrl: string;
  try {
    url = stripHash(String(r.url ?? ""));
    tabUrl = stripHash(senderTabUrl);
  } catch {
    return null;
  }
  const tabVideo = videoIdFromUrl(tabUrl);
  if (!tabVideo || url !== tabUrl || r.videoId !== tabVideo) return null;
  const windows: TranscriptWindow[] = [];
  if (Array.isArray(r.windows)) {
    for (const w of r.windows.slice(0, MAX_TRANSCRIPT_WINDOWS)) {
      const o = w as Record<string, unknown>;
      if (typeof o.startSec !== "number" || typeof o.endSec !== "number" || typeof o.text !== "string") continue;
      if (!Number.isFinite(o.startSec) || !Number.isFinite(o.endSec) || o.startSec < 0) continue;
      const text = o.text.replace(/\s+/g, " ").trim().slice(0, MAX_WINDOW_CHARS);
      if (text) windows.push({ startSec: o.startSec, endSec: o.endSec, text });
    }
  }
  // Last line of defence against thin chunks: merge short windows and, if the
  // whole transcript is still only a handful of words, fold it into the
  // metadata so the caller indexes the video from its identity instead.
  const usable = usableTranscriptWindows(windows);
  const leftover = usable.length ? "" : transcriptSnippet(windows);
  const title = str(r.title, 300);
  let metadata = str(r.metadata, 6000);
  if (leftover && !metadata.includes(leftover)) {
    metadata = `${metadata}\nTranscript: ${leftover}`.trim().slice(0, 6000);
  }
  if (!usable.length && metadata.replace(/\s+/g, " ").trim().length < MIN_METADATA_CHARS) return null;
  return {
    url,
    videoId: tabVideo,
    title,
    channel: str(r.channel, 200),
    lengthSeconds: typeof r.lengthSeconds === "number" && Number.isFinite(r.lengthSeconds) ? r.lengthSeconds : 0,
    windows: usable,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// In-page capture controller (Phase 5.6 fix): all of the timing and gating
// decisions for one tab, with the DOM and messaging injected so they can be
// tested. src/content/youtube-capture.ts wires it to the real page.
// ---------------------------------------------------------------------------

/** How long the user must be on a watch page before its identity is indexed. */
export const METADATA_DWELL_MS = 4000;
/**
 * YouTube repaints the title and description a moment after the URL changes,
 * so identity read from a page still showing the previous video is held back
 * until the player response arrives, or until this much time has passed.
 */
export const METADATA_MAX_WAIT_MS = 10_000;
/** Player-response requests after a navigation, in ms since the navigation. */
export const INFO_RETRY_MS = [0, 600, 1500, 3000, 6000, 12_000, 20_000];
/** Backoff after the service worker refuses a send (rate limit, gate, races). */
export const SEND_RETRY_MS = 15_000;

export interface YouTubeCaptureDeps {
  /** location.href of the tab, read fresh every tick. */
  currentUrl: () => string;
  /** The watch page document (identity is read straight out of it). */
  getDocument: () => Document;
  /** True while a media element on the page is actually playing. */
  isPlaying: () => boolean;
  /** Ask the page-world bridge for the player response. */
  requestPlayerInfo: () => void;
  /** Fetch caption windows (json3, then the transcript panel). */
  fetchWindows: (info: PlayerInfo | null) => Promise<TranscriptWindow[]>;
  /** Deliver to the service worker; resolves false when it did not take it. */
  send: (payload: TranscriptPayload) => Promise<boolean>;
  now?: () => number;
  thresholdSec?: number;
  metadataDwellMs?: number;
}

interface VideoState {
  videoId: string;
  navigatedAt: number;
  info: PlayerInfo | null;
  infoAttempts: number;
  nextInfoRequestAt: number;
  watchedMs: number;
  playingSince: number | null;
  metaSent: string | null;
  fullSent: boolean;
  nextSendAt: number;
  /** Best title seen for this video, used to spot a page that has not repainted. */
  lastTitle: string;
}

export interface YouTubeCaptureController {
  /** Poll: playback accounting, player-info retries and the two send phases. */
  tick: () => Promise<void>;
  /** Untrusted player response from the page world. */
  offerPlayerInfo: (raw: unknown) => void;
  /** The video the controller is currently following, if any. */
  videoId: () => string | null;
  /** Watched milliseconds for the current video (tests / diagnostics). */
  watchedMs: () => number;
}

export function createYouTubeCaptureController(deps: YouTubeCaptureDeps): YouTubeCaptureController {
  const now = deps.now ?? Date.now;
  const thresholdMs = (deps.thresholdSec ?? PLAYBACK_THRESHOLD_SEC) * 1000;
  const dwellMs = deps.metadataDwellMs ?? METADATA_DWELL_MS;
  let state: VideoState | null = null;
  let busy = false;
  /** Player response that arrived before the controller started this video. */
  let pendingInfo: PlayerInfo | null = null;
  /** Title of the video we were on before, to spot a page that has not repainted. */
  let previousTitle = "";

  const startVideo = (videoId: string | null, t: number): void => {
    const early = pendingInfo?.videoId === videoId ? pendingInfo : null;
    pendingInfo = null;
    if (state) previousTitle = state.info?.title || state.lastTitle;
    state = videoId
      ? {
          videoId,
          navigatedAt: t,
          info: early,
          infoAttempts: 0,
          nextInfoRequestAt: t,
          watchedMs: 0,
          // Media events do not fire again for a video that is already rolling
          // when an SPA navigation swaps the page underneath it.
          playingSince: deps.isPlaying() ? t : null,
          metaSent: null,
          fullSent: false,
          nextSendAt: 0,
          lastTitle: early?.title ?? "",
        }
      : null;
  };

  const metadataFor = (s: VideoState, extra = ""): VideoMetadata & { text: string } => {
    const merged = mergeMetadata(
      s.info ? playerMetadata(s.info) : null,
      readWatchPageMetadata(deps.getDocument())
    );
    if (merged.title) s.lastTitle = merged.title;
    return { ...merged, text: metadataText(merged, extra) };
  };

  /**
   * True while the only identity available is the one the previous video left
   * on screen. Indexing that would file this video under the last one's name.
   */
  const pageNotRepaintedYet = (s: VideoState, t: number): boolean => {
    if (s.info || !previousTitle) return false;
    if (t - s.navigatedAt >= METADATA_MAX_WAIT_MS) return false;
    return readWatchPageMetadata(deps.getDocument()).title === previousTitle;
  };

  const deliver = async (s: VideoState, windows: TranscriptWindow[], extra: string): Promise<boolean> => {
    const url = deps.currentUrl();
    // Never index a page that is no longer the video we collected.
    if (videoIdFromUrl(url) !== s.videoId) return false;
    const m = metadataFor(s, extra);
    if (!windows.length && m.text.replace(/\s+/g, " ").trim().length < MIN_METADATA_CHARS) return false;
    let clean: string;
    try {
      clean = stripHash(url);
    } catch {
      return false;
    }
    return deps.send({
      url: clean,
      videoId: s.videoId,
      title: m.title,
      channel: m.channel,
      lengthSeconds: s.info?.lengthSeconds ?? 0,
      windows,
      metadata: m.text,
    });
  };

  const sendMetadata = async (s: VideoState, t: number): Promise<void> => {
    // The identity is stored once; a later trip is only for a page that had
    // not finished painting, so stop re-reading the DOM after a minute.
    if (s.metaSent != null && t - s.navigatedAt > 60_000) return;
    const text = metadataFor(s).text;
    // Only worth a second trip when the player response filled real gaps.
    if (s.metaSent != null && text.length <= s.metaSent.length + 80) return;
    busy = true;
    try {
      if (await deliver(s, [], "")) s.metaSent = text;
      else s.nextSendAt = t + SEND_RETRY_MS;
    } finally {
      busy = false;
    }
  };

  const sendTranscript = async (s: VideoState, t: number): Promise<void> => {
    busy = true;
    try {
      const raw = await deps.fetchWindows(s.info).catch(() => [] as TranscriptWindow[]);
      const windows = usableTranscriptWindows(raw).slice(0, MAX_TRANSCRIPT_WINDOWS);
      const extra = windows.length ? "" : transcriptSnippet(raw);
      // Nothing new to say beyond the metadata already stored.
      if (!windows.length && !extra && s.metaSent != null) {
        s.fullSent = true;
        return;
      }
      if (await deliver(s, windows, extra)) {
        s.fullSent = true;
        s.metaSent = s.metaSent ?? metadataFor(s, extra).text;
      } else {
        s.nextSendAt = t + SEND_RETRY_MS;
      }
    } finally {
      busy = false;
    }
  };

  return {
    videoId: () => state?.videoId ?? null,
    watchedMs: () =>
      state ? state.watchedMs + (state.playingSince != null ? now() - state.playingSince : 0) : 0,
    offerPlayerInfo: (raw: unknown) => {
      const parsed = parsePlayerResponse(raw);
      // Untrusted page data: only for the video in the address bar, and only
      // for the video this controller is following.
      if (!parsed || parsed.videoId !== videoIdFromUrl(deps.currentUrl())) return;
      if (state && state.videoId === parsed.videoId) state.info = parsed;
      else pendingInfo = parsed;
    },
    tick: async () => {
      const t = now();
      const id = videoIdFromUrl(deps.currentUrl());
      if (id !== (state?.videoId ?? null)) startVideo(id, t);
      const s = state;
      if (!s) return;

      const playing = deps.isPlaying();
      if (playing) {
        if (s.playingSince == null) s.playingSince = t;
      } else if (s.playingSince != null) {
        s.watchedMs += Math.max(0, t - s.playingSince);
        s.playingSince = null;
      }
      const watched = s.watchedMs + (s.playingSince != null ? Math.max(0, t - s.playingSince) : 0);

      // The player response is swapped in some time after the URL changes, so
      // a single request loses the race on nearly every SPA navigation.
      if (!s.info && s.infoAttempts < INFO_RETRY_MS.length && t >= s.nextInfoRequestAt) {
        s.infoAttempts += 1;
        s.nextInfoRequestAt = s.navigatedAt + (INFO_RETRY_MS[s.infoAttempts] ?? Number.POSITIVE_INFINITY);
        deps.requestPlayerInfo();
      }

      if (busy || t < s.nextSendAt) return;
      if (!s.fullSent && watched >= thresholdMs) {
        await sendTranscript(s, t);
        return;
      }
      if (!s.fullSent && t - s.navigatedAt >= dwellMs && !pageNotRepaintedYet(s, t)) {
        await sendMetadata(s, t);
      }
    },
  };
}
