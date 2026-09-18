import { describe, it, expect, vi, beforeEach } from "vitest";
import { makePdf } from "./helpers/make-pdf";
import { PDF_LIMITS } from "../src/lib/capture/pdf";

vi.stubGlobal("chrome", { runtime: { getURL: (p: string) => `chrome-extension://test/${p}` } });
const extract = vi.fn(async () => ({ title: "T", pages: [{ page: 1, text: "Aurora" }] }));
vi.mock("../src/offscreen/pdf-extract", () => ({ extractPdfPages: extract }));

import { fetchAndExtractPdf } from "../src/offscreen/pdf-fetch";

const URL_PDF = "https://papers.test/aurora.pdf";

beforeEach(() => {
  extract.mockClear();
});

describe("fetchAndExtractPdf (offscreen)", () => {
  it("fetches only the tab's own URL, without cookies and without following redirects", async () => {
    const fetchMock = vi.fn(async () => new Response(makePdf([["Aurora"]])));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchAndExtractPdf(URL_PDF);
    expect(res).toEqual({ ok: true, title: "T", pages: [{ page: 1, text: "Aurora" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_PDF);
    expect(init).toMatchObject({ credentials: "omit", redirect: "error" });
    expect(extract).toHaveBeenCalledWith(expect.any(Uint8Array), { workerSrc: "chrome-extension://test/pdf.worker.min.mjs" });
  });

  it("refuses non-PDF URLs without any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAndExtractPdf("https://papers.test/aurora.html")).toEqual({ ok: false, reason: "not_pdf" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops at 30 MB (header or stream), on HTTP errors, and on bytes that are not a PDF", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { headers: { "content-length": String(PDF_LIMITS.maxBytes + 1) } })));
    expect(await fetchAndExtractPdf(URL_PDF)).toEqual({ ok: false, reason: "too_large" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(PDF_LIMITS.maxBytes + 10))));
    expect(await fetchAndExtractPdf(URL_PDF)).toEqual({ ok: false, reason: "too_large" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    expect(await fetchAndExtractPdf(URL_PDF)).toEqual({ ok: false, reason: "http_403" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login</html>")));
    expect(await fetchAndExtractPdf(URL_PDF)).toEqual({ ok: false, reason: "not_pdf_bytes" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("redirect"))));
    expect(await fetchAndExtractPdf(URL_PDF)).toEqual({ ok: false, reason: "fetch_failed" });
    expect(extract).not.toHaveBeenCalled();
  });
});
