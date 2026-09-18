/**
 * Per-kind labels and links (release 1.2.0): snippet labels in the answer
 * prompt, citation card details and links, and Markdown export timestamps.
 */
import type { ChunkKind, ChunkLocator } from "../db/schema";
import { youtubeCitationHref } from "./capture/youtube";
import { pdfCitationHref } from "./capture/pdf";
import { safeHttpHttpsHref } from "./url-security";

export interface KindedChunk {
  kind?: ChunkKind;
  locator?: ChunkLocator;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

type Video = { videoId: string; startSec: number; endSec: number };
type Table = { rowStart: number; rowEnd: number; caption: string };

function has<K extends string>(l: ChunkLocator | undefined, key: K): l is ChunkLocator & Record<K, unknown> {
  return !!l && key in l;
}

/** "[N] (label)" in the prompt; empty for plain page text. */
export function snippetLabel(c: KindedChunk): string {
  const l = c.locator;
  switch (c.kind) {
    case "transcript":
      return has(l, "videoId") ? `video ${formatClock((l as Video).startSec)} to ${formatClock((l as Video).endSec)}` : "video";
    case "table": {
      if (!has(l, "rowStart")) return "table";
      const t = l as Table;
      return `table${t.caption ? `: ${t.caption}` : ""}, rows ${t.rowStart} to ${t.rowEnd}`;
    }
    case "pdf":
      return has(l, "page") ? `PDF page ${(l as { page: number }).page}` : "PDF";
    case "image":
      return "image";
    case "highlight":
      return "highlight";
    default:
      return "";
  }
}

/** Where a citation card links: the video moment, the PDF page, or the page. */
export function citationHref(c: KindedChunk, pageUrl: string): string | null {
  const l = c.locator;
  if (c.kind === "transcript" && has(l, "videoId")) return youtubeCitationHref(l as Video);
  if (c.kind === "pdf" && has(l, "page")) return pdfCitationHref(pageUrl, (l as { page: number }).page);
  return safeHttpHttpsHref(pageUrl);
}

/** Short second line on a citation card. */
export function citationDetail(c: KindedChunk): string {
  const l = c.locator;
  switch (c.kind) {
    case "transcript":
      return has(l, "videoId") ? `Video at ${formatClock((l as Video).startSec)}` : "Video";
    case "pdf":
      return has(l, "page") ? `PDF page ${(l as { page: number }).page}` : "PDF";
    case "table":
      return has(l, "rowStart") ? `Table rows ${(l as Table).rowStart} to ${(l as Table).rowEnd}` : "Table";
    case "image":
      return "Image";
    case "highlight":
      return "Your highlight";
    default:
      return "";
  }
}
