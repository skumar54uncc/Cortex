/**
 * PDFs (Phase 5.9). Content scripts do not run in Chrome's PDF viewer, so the
 * service worker spots PDF tabs by URL, runs the privacy gate, and asks the
 * offscreen document to fetch the same URL and read its text with pdfjs-dist.
 * Page text becomes `pdf` chunks with a `{ page }` locator.
 */
import { chunkArticle } from "../chunking";
import type { NewChunk } from "../../db/schema";
import { safeHttpHttpsHref } from "../url-security";

export const PDF_LIMITS = {
  maxBytes: 30 * 1024 * 1024,
  maxPages: 300,
  maxChunks: 200,
  fetchTimeoutMs: 60_000,
} as const;

export function isPdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return /\.pdf$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** Unknown or unparsable length is allowed; readCapped enforces the cap while streaming. */
export function pdfSizeAllowed(contentLength: string | null): boolean {
  if (contentLength == null) return true;
  const n = Number(contentLength);
  if (!Number.isFinite(n)) return true;
  return n <= PDF_LIMITS.maxBytes;
}

/** Reads the body, giving up (null) as soon as it passes `cap` bytes. */
export async function readCapped(res: Response, cap: number = PDF_LIMITS.maxBytes): Promise<Uint8Array | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  return magic.every((b, i) => bytes[i] === b);
}

export interface PdfPage {
  page: number;
  text: string;
}

export function pagesToChunks(pages: PdfPage[]): NewChunk[] {
  const out: NewChunk[] = [];
  for (const p of pages) {
    if (!p.text.trim()) continue;
    for (const c of chunkArticle(p.text)) {
      if (out.length >= PDF_LIMITS.maxChunks) return out;
      out.push({ ord: p.page * 1000 + c.ord, text: c.text, kind: "pdf", locator: { page: p.page } });
    }
  }
  return out;
}

export function pdfCitationHref(url: string, page: number): string | null {
  const safe = safeHttpHttpsHref(url);
  if (!safe) return null;
  const u = new URL(safe);
  u.hash = `page=${Math.max(1, Math.floor(page))}`;
  return u.href;
}
