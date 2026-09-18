/**
 * Offscreen side of PDF indexing (Phase 5.9). Fetches exactly the URL the
 * tab shows (already gated by the service worker): no cookies, no redirects
 * to other hosts, 30 MB cap, %PDF- magic check. pdfjs-dist is loaded lazily
 * as its own chunk only when a PDF is actually read.
 */
import { isPdfBytes, isPdfUrl, pdfSizeAllowed, readCapped, PDF_LIMITS } from "../lib/capture/pdf";
import type { PdfExtractResult } from "../lib/pdf-indexer";

export async function fetchAndExtractPdf(url: string): Promise<PdfExtractResult> {
  if (!isPdfUrl(url)) return { ok: false, reason: "not_pdf" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PDF_LIMITS.fetchTimeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, { credentials: "omit", redirect: "error", signal: ac.signal });
    } catch {
      return { ok: false, reason: ac.signal.aborted ? "timeout" : "fetch_failed" };
    }
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    if (!pdfSizeAllowed(res.headers.get("content-length"))) {
      ac.abort();
      return { ok: false, reason: "too_large" };
    }
    const bytes = await readCapped(res);
    if (!bytes) return { ok: false, reason: "too_large" };
    if (!isPdfBytes(bytes)) return { ok: false, reason: "not_pdf_bytes" };
    try {
      const { extractPdfPages } = await import(/* webpackChunkName: "pdf" */ "./pdf-extract");
      const out = await extractPdfPages(bytes, { workerSrc: chrome.runtime.getURL("pdf.worker.min.mjs") });
      return { ok: true, title: out.title, pages: out.pages };
    } catch {
      return { ok: false, reason: "parse_failed" };
    }
  } finally {
    clearTimeout(timer);
  }
}
