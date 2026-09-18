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

export function metadataText(p: PlayerInfo): string {
  const chapters: string[] = [];
  for (const line of p.description.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{1,2}(?::\d{2}){1,2})\s+(.+)$/);
    if (m) chapters.push(`${m[2]!.trim()} (${m[1]})`);
  }
  return [
    p.title,
    p.channel ? `Channel: ${p.channel}` : "",
    chapters.length ? `Chapters: ${chapters.join("; ")}` : "",
    p.description,
  ]
    .filter(Boolean)
    .join("\n");
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
  tick: () => void;
  reset: () => void;
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
  const check = (): void => {
    const total = acc + (since != null ? now() - since : 0);
    if (!fired && total >= thresholdSec * 1000) {
      fired = true;
      onReady();
    }
  };
  return {
    playing: () => {
      if (since == null) since = now();
    },
    paused: () => {
      if (since != null) {
        acc += now() - since;
        since = null;
      }
      check();
    },
    tick: check,
    reset: () => {
      acc = 0;
      since = null;
      fired = false;
    },
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
  return {
    url,
    videoId: tabVideo,
    title: str(r.title, 300),
    channel: str(r.channel, 200),
    lengthSeconds: typeof r.lengthSeconds === "number" && Number.isFinite(r.lengthSeconds) ? r.lengthSeconds : 0,
    windows,
    metadata: str(r.metadata, 6000),
  };
}
