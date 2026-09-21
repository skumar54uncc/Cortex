import { describe, it, expect } from "vitest";
import { formatClock, snippetLabel, citationHref, citationDetail } from "../src/lib/kind-labels";

describe("formatClock", () => {
  it("formats seconds as m:ss or h:mm:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(760)).toBe("12:40");
    expect(formatClock(3725.9)).toBe("1:02:05");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("snippetLabel (context builder)", () => {
  it("labels each kind with its locator", () => {
    expect(snippetLabel({ kind: "transcript", locator: { videoId: "v", startSec: 760, endSec: 820 } })).toBe("video 12:40 to 13:40");
    expect(snippetLabel({ kind: "table", locator: { tableIndex: 0, rowStart: 13, rowEnd: 24, caption: "Prices" } })).toBe(
      "table: Prices, rows 13 to 24"
    );
    expect(snippetLabel({ kind: "table", locator: { tableIndex: 0, rowStart: 1, rowEnd: 12, caption: "" } })).toBe("table, rows 1 to 12");
    expect(snippetLabel({ kind: "pdf", locator: { page: 4 } })).toBe("PDF page 4");
    expect(snippetLabel({ kind: "image" })).toBe("image");
    expect(snippetLabel({ kind: "highlight", locator: { quote: "q" } })).toBe("highlight");
    expect(snippetLabel({})).toBe("");
    expect(snippetLabel({ kind: "text" })).toBe("");
    expect(snippetLabel({ kind: "pdf" })).toBe("PDF");
  });
});

describe("citationHref and citationDetail (citation cards)", () => {
  const page = "https://a.test/doc.pdf";
  it("links videos to the moment, PDFs to the page, everything else to the page URL", () => {
    expect(citationHref({ kind: "transcript", locator: { videoId: "abc", startSec: 61, endSec: 121 } }, "https://www.youtube.com/watch?v=abc")).toBe(
      "https://www.youtube.com/watch?v=abc&t=61s"
    );
    expect(citationHref({ kind: "pdf", locator: { page: 3 } }, page)).toBe(`${page}#page=3`);
    expect(citationHref({ kind: "table", locator: { tableIndex: 0, rowStart: 1, rowEnd: 12, caption: "" } }, "https://a.test/t")).toBe(
      "https://a.test/t"
    );
    expect(citationHref({}, "javascript:alert(1)")).toBeNull();
  });

  it("gives a short detail line per kind", () => {
    expect(citationDetail({ kind: "transcript", locator: { videoId: "abc", startSec: 61, endSec: 121 } })).toBe("Video at 1:01");
    expect(citationDetail({ kind: "pdf", locator: { page: 3 } })).toBe("PDF page 3");
    expect(citationDetail({ kind: "table", locator: { tableIndex: 0, rowStart: 13, rowEnd: 24, caption: "Prices" } })).toBe(
      "Table rows 13 to 24"
    );
    expect(citationDetail({ kind: "image" })).toBe("Image");
    expect(citationDetail({ kind: "highlight" })).toBe("Your highlight");
    expect(citationDetail({})).toBe("");
  });
});

describe("video identity chunks", () => {
  const meta = { kind: "transcript" as const, locator: { videoId: "abc", startSec: 0, endSec: 754, meta: true } };

  it("reads as details, not as a moment at 0:00", () => {
    expect(citationDetail(meta)).toBe("Video details");
    expect(snippetLabel(meta)).toBe("video details");
  });

  it("still links to the video", () => {
    expect(citationHref(meta, "https://www.youtube.com/watch?v=abc")).toBe("https://www.youtube.com/watch?v=abc&t=0s");
  });
});
