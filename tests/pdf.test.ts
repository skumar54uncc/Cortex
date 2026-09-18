import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makePdf } from "./helpers/make-pdf";
import {
  isPdfUrl,
  isPdfBytes,
  pdfSizeAllowed,
  readCapped,
  pagesToChunks,
  pdfCitationHref,
  PDF_LIMITS,
} from "../src/lib/capture/pdf";
import { extractPdfPages } from "../src/offscreen/pdf-extract";

const PAGES = [
  ["Aurora survey field notes", "Magnetometer drift was 4 nT per hour at the northern station."],
  ["Page two covers the calibration run.", "The fluxgate was recalibrated on day three."],
  ["Page three lists open questions about solar wind coupling."],
];

describe("PDF detection and limits", () => {
  it("detects http(s) PDF URLs only", () => {
    expect(isPdfUrl("https://a.test/papers/aurora.pdf")).toBe(true);
    expect(isPdfUrl("https://a.test/papers/AURORA.PDF?download=1#page=2")).toBe(true);
    expect(isPdfUrl("https://a.test/pdf")).toBe(false);
    expect(isPdfUrl("https://a.test/aurora.pdf.html")).toBe(false);
    expect(isPdfUrl("file:///C:/aurora.pdf")).toBe(false);
    expect(isPdfUrl("chrome-extension://abc/x.pdf")).toBe(false);
    expect(isPdfUrl("not a url")).toBe(false);
  });

  it("caps size at 30 MB from Content-Length and while streaming", async () => {
    expect(PDF_LIMITS.maxBytes).toBe(30 * 1024 * 1024);
    expect(pdfSizeAllowed(null)).toBe(true);
    expect(pdfSizeAllowed(String(PDF_LIMITS.maxBytes))).toBe(true);
    expect(pdfSizeAllowed(String(PDF_LIMITS.maxBytes + 1))).toBe(false);
    expect(pdfSizeAllowed("abc")).toBe(true);
    const ok = await readCapped(new Response(new Uint8Array(1000)), 1000);
    expect(ok?.byteLength).toBe(1000);
    expect(await readCapped(new Response(new Uint8Array(1001)), 1000)).toBeNull();
  });

  it("checks the %PDF- magic bytes", () => {
    expect(isPdfBytes(makePdf([["x"]]))).toBe(true);
    expect(isPdfBytes(new TextEncoder().encode("<html>"))).toBe(false);
  });
});

describe("PDF pages to chunks", () => {
  it("chunks each page with a page locator, skips empty pages and caps the total", () => {
    const chunks = pagesToChunks([
      { page: 1, text: "Aurora survey field notes. " + "Magnetometer readings. ".repeat(10) },
      { page: 2, text: "   " },
      { page: 3, text: "Solar wind coupling questions." },
    ]);
    expect(chunks.every((c) => c.kind === "pdf")).toBe(true);
    expect(chunks.map((c) => (c.locator as { page: number }).page)).toEqual([1, 3]);
    expect(chunks[0]!.ord).toBe(1000);
    expect(chunks[1]!.ord).toBe(3000);
    const long = Array.from({ length: 400 }, (_, i) => ({ page: i + 1, text: `Page ${i + 1} ${"word ".repeat(200)}` }));
    expect(pagesToChunks(long).length).toBe(PDF_LIMITS.maxChunks);
  });

  it("builds #page=N citation links", () => {
    expect(pdfCitationHref("https://a.test/x.pdf", 4)).toBe("https://a.test/x.pdf#page=4");
    expect(pdfCitationHref("https://a.test/x.pdf#page=9", 2)).toBe("https://a.test/x.pdf#page=2");
    expect(pdfCitationHref("javascript:alert(1)", 2)).toBeNull();
  });
});

describe("extractPdfPages (pdfjs-dist, no eval)", () => {
  it("reads the title and the text of every page of a generated three page PDF", async () => {
    const res = await extractPdfPages(makePdf(PAGES, "Aurora field notes 2026"));
    expect(res.title).toBe("Aurora field notes 2026");
    expect(res.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(res.pages[0]!.text).toContain("Magnetometer drift was 4 nT per hour");
    expect(res.pages[1]!.text).toContain("fluxgate was recalibrated");
    expect(res.pages[2]!.text).toContain("solar wind coupling");
  });

  it("stops at the page cap", async () => {
    const many = Array.from({ length: 5 }, (_, i) => [`Page ${i + 1}`]);
    const res = await extractPdfPages(makePdf(many), { maxPages: 3 });
    expect(res.pages.map((p) => p.page)).toEqual([1, 2, 3]);
  });
});

describe("pdfjs-dist ships no dynamic code evaluation", () => {
  it("has no eval( or new Function( in the files Cortex bundles or copies", () => {
    const dir = join(__dirname, "..", "node_modules", "pdfjs-dist", "legacy", "build");
    for (const f of ["pdf.mjs", "pdf.worker.min.mjs"]) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/\beval\s*\(|\bnew\s+Function\s*\(/);
    }
  });
});
