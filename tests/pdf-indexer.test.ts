import { describe, it, expect, vi } from "vitest";
import { indexPdfTab, type PdfIndexDeps } from "../src/lib/pdf-indexer";

const URL_PDF = "https://papers.test/aurora-notes.pdf#page=3";

function deps(over: Partial<PdfIndexDeps> = {}): PdfIndexDeps & { commit: ReturnType<typeof vi.fn>; extract: ReturnType<typeof vi.fn> } {
  return {
    pdfEnabled: async () => true,
    gate: async () => ({ skip: false }),
    alreadyIndexed: async () => false,
    extract: vi.fn(async () => ({
      ok: true as const,
      title: "",
      pages: [
        { page: 1, text: "Aurora notes. Contact 123-45-6789 for the raw magnetometer files." },
        { page: 2, text: "Fluxgate recalibration on day three." },
      ],
    })),
    commit: vi.fn(async () => undefined),
    ...over,
  } as never;
}

describe("indexPdfTab", () => {
  it("fetches, chunks with page locators, redacts PII and commits under the URL without its hash", async () => {
    const d = deps();
    const res = await indexPdfTab({ url: URL_PDF, incognito: false }, d);
    expect(res).toEqual({ indexed: true, chunks: 2 });
    expect(d.extract).toHaveBeenCalledWith("https://papers.test/aurora-notes.pdf");
    const [payload, chunks] = d.commit.mock.calls[0]!;
    expect(payload).toMatchObject({ url: "https://papers.test/aurora-notes.pdf", title: "aurora-notes.pdf", text: "" });
    expect(chunks.map((c: { locator: { page: number } }) => c.locator.page)).toEqual([1, 2]);
    expect(chunks[0].text).not.toContain("123-45-6789");
    expect(chunks.every((c: { kind: string }) => c.kind === "pdf")).toBe(true);
  });

  it("uses the PDF title when it has one", async () => {
    const d = deps({ extract: vi.fn(async () => ({ ok: true as const, title: "Aurora field notes", pages: [{ page: 1, text: "Some text on the aurora." }] })) });
    await indexPdfTab({ url: URL_PDF, incognito: false }, d);
    expect(d.commit.mock.calls[0]![0].title).toBe("Aurora field notes");
  });

  it("never fetches when PDFs are off, the URL is not a PDF, the gate says skip, or it is already indexed", async () => {
    const cases: [Partial<PdfIndexDeps>, string, string][] = [
      [{ pdfEnabled: async () => false }, URL_PDF, "disabled"],
      [{}, "https://papers.test/aurora-notes.html", "not_pdf"],
      [{ gate: async () => ({ skip: true, reason: "incognito" }) }, URL_PDF, "incognito"],
      [{ gate: async () => ({ skip: true, reason: "sensitive" }) }, URL_PDF, "sensitive"],
      [{ alreadyIndexed: async () => true }, URL_PDF, "already_indexed"],
    ];
    for (const [over, url, reason] of cases) {
      const d = deps(over);
      expect(await indexPdfTab({ url, incognito: false }, d)).toEqual({ indexed: false, reason });
      expect(d.extract).not.toHaveBeenCalled();
      expect(d.commit).not.toHaveBeenCalled();
    }
  });

  it("passes the tab's incognito flag to the gate", async () => {
    const gate = vi.fn(async () => ({ skip: true as const, reason: "incognito" }));
    await indexPdfTab({ url: URL_PDF, incognito: true }, deps({ gate }));
    expect(gate).toHaveBeenCalledWith("https://papers.test/aurora-notes.pdf", true);
  });

  it("reports fetch or parse failures without committing, and skips PDFs with no text", async () => {
    const failed = deps({ extract: vi.fn(async () => ({ ok: false as const, reason: "too_large" })) });
    expect(await indexPdfTab({ url: URL_PDF, incognito: false }, failed)).toEqual({ indexed: false, reason: "too_large" });
    const empty = deps({ extract: vi.fn(async () => ({ ok: true as const, title: "", pages: [{ page: 1, text: " " }] })) });
    expect(await indexPdfTab({ url: URL_PDF, incognito: false }, empty)).toEqual({ indexed: false, reason: "no_text" });
    expect(failed.commit).not.toHaveBeenCalled();
    expect(empty.commit).not.toHaveBeenCalled();
  });

  it("runs one extraction per URL at a time", async () => {
    let release!: () => void;
    const d = deps({
      extract: vi.fn(
        () =>
          new Promise((r) => {
            release = () => r({ ok: true as const, title: "", pages: [{ page: 1, text: "Aurora text here." }] });
          })
      ) as never,
    });
    const first = indexPdfTab({ url: URL_PDF, incognito: false }, d);
    await new Promise((r) => setTimeout(r, 0));
    expect(await indexPdfTab({ url: URL_PDF, incognito: false }, d)).toEqual({ indexed: false, reason: "in_flight" });
    release();
    await first;
    expect(d.extract).toHaveBeenCalledTimes(1);
  });
});
