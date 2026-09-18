/**
 * Service worker validation of page-built extra chunks (tables, images) that
 * arrive with CORTEX_INDEX (Phase 5.7, 5.8). Only kinds a page may produce
 * and whose feature is on are kept; locators are type-checked; counts and
 * sizes are capped.
 */
import type { ChunkLocator, NewChunk } from "../../db/schema";

export const EXTRA_CHUNK_LIMITS = {
  tableChunks: 60,
  imageChunks: 2,
  imagesPerChunk: 20,
  chars: 8000,
  /** Downscaled image for on-device description, as a data URL (about 450 KB). */
  imageInputChars: 600_000,
  imageInputs: 5,
} as const;

function httpUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
}

function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function tableLocator(l: unknown): ChunkLocator | null {
  const o = l as Record<string, unknown> | null;
  if (!o || !num(o.tableIndex) || !num(o.rowStart) || !num(o.rowEnd) || typeof o.caption !== "string") return null;
  return { tableIndex: o.tableIndex, rowStart: o.rowStart, rowEnd: o.rowEnd, caption: o.caption.slice(0, 200) };
}

function imageLocator(l: unknown): ChunkLocator | null {
  const imgs = (l as { images?: unknown } | null)?.images;
  if (!Array.isArray(imgs)) return null;
  const images: { src: string; alt: string }[] = [];
  for (const i of imgs.slice(0, EXTRA_CHUNK_LIMITS.imagesPerChunk)) {
    const src = httpUrl((i as { src?: unknown }).src);
    const alt = (i as { alt?: unknown }).alt;
    if (src && typeof alt === "string") images.push({ src, alt: alt.slice(0, 300) });
  }
  return images.length ? { images } : null;
}

export function sanitizeExtraChunks(
  raw: unknown,
  enabled: { tables: boolean; images: boolean }
): NewChunk[] {
  if (!Array.isArray(raw)) return [];
  const out: NewChunk[] = [];
  let tables = 0;
  let images = 0;
  for (const r of raw) {
    const c = r as Record<string, unknown>;
    if (typeof c.text !== "string" || !c.text.trim()) continue;
    const text = c.text.slice(0, EXTRA_CHUNK_LIMITS.chars);
    const ord = num(c.ord) ? c.ord : 5000 + out.length;
    if (c.kind === "table" && enabled.tables && tables < EXTRA_CHUNK_LIMITS.tableChunks) {
      const locator = tableLocator(c.locator);
      if (!locator) continue;
      out.push({ ord, text, kind: "table", locator });
      tables += 1;
    } else if (c.kind === "image" && enabled.images && images < EXTRA_CHUNK_LIMITS.imageChunks) {
      const locator = imageLocator(c.locator);
      if (!locator) continue;
      out.push({ ord, text, kind: "image", locator });
      images += 1;
    }
  }
  return out;
}

export interface ImageInput {
  src: string;
  dataUrl: string;
}

const IMAGE_DATA_URL = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

/**
 * Pixels for on-device descriptions (Phase 5.8). Only JPEG or PNG data URLs
 * of images the page's own image chunk lists are kept, one per image, capped
 * in count and size. They go to the offscreen Prompt API and are never stored.
 */
export function sanitizeImageInputs(raw: unknown, locatorSrcs: readonly string[]): ImageInput[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(locatorSrcs);
  const seen = new Set<string>();
  const out: ImageInput[] = [];
  for (const r of raw) {
    if (out.length >= EXTRA_CHUNK_LIMITS.imageInputs) break;
    const o = r as { src?: unknown; dataUrl?: unknown } | null;
    const src = httpUrl(o?.src);
    const dataUrl = o?.dataUrl;
    if (!src || !allowed.has(src) || seen.has(src)) continue;
    if (typeof dataUrl !== "string" || dataUrl.length > EXTRA_CHUNK_LIMITS.imageInputChars) continue;
    if (!IMAGE_DATA_URL.test(dataUrl)) continue;
    seen.add(src);
    out.push({ src, dataUrl });
  }
  return out;
}
