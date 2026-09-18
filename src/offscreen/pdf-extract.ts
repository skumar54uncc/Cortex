/**
 * PDF text extraction with pdfjs-dist (Phase 5.9). Loaded lazily by the
 * offscreen document (its own webpack chunk) and imported directly by tests.
 * No eval (pdfjs-dist 6 has none; tests/pdf.test.ts checks the shipped
 * files), no font loading, no network: bytes in, page text out.
 */
import { getDocument, GlobalWorkerOptions, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_LIMITS, type PdfPage } from "../lib/capture/pdf";

export interface PdfText {
  title: string;
  pages: PdfPage[];
}

export async function extractPdfPages(
  bytes: Uint8Array,
  opts: { maxPages?: number; workerSrc?: string } = {}
): Promise<PdfText> {
  if (opts.workerSrc) GlobalWorkerOptions.workerSrc = opts.workerSrc;
  const task = getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  const doc = await task.promise;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: unknown };
    const title = typeof info.Title === "string" ? info.Title.trim().slice(0, 300) : "";
    const last = Math.min(doc.numPages, opts.maxPages ?? PDF_LIMITS.maxPages);
    const pages: PdfPage[] = [];
    for (let n = 1; n <= last; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str + (item.hasEOL ? "\n" : " ");
      }
      pages.push({ page: n, text: text.replace(/[ \t]+/g, " ").trim() });
      page.cleanup();
    }
    return { title, pages };
  } finally {
    await task.destroy();
  }
}
