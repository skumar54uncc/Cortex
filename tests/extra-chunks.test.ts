import { describe, it, expect } from "vitest";
import { sanitizeExtraChunks, EXTRA_CHUNK_LIMITS } from "../src/lib/capture/extra-chunks";

const table = (i: number) => ({
  ord: 2000 + i,
  text: `Table: Prices\nModel: A${i}; Price: ${i}`,
  kind: "table",
  locator: { tableIndex: 0, rowStart: i * 12 + 1, rowEnd: i * 12 + 12, caption: "Prices" },
});
const image = {
  ord: 3000,
  text: "Images: Glacier drone over the ice (figure 1)",
  kind: "image",
  locator: { images: [{ src: "https://e.test/a.jpg", alt: "Glacier drone" }] },
};

describe("sanitizeExtraChunks", () => {
  it("keeps valid table and image chunks when both features are on", () => {
    const out = sanitizeExtraChunks([table(0), image], { tables: true, images: true });
    expect(out.map((c) => c.kind)).toEqual(["table", "image"]);
    expect(out[0]!.locator).toEqual(table(0).locator);
  });

  it("drops kinds whose feature is off, and any kind a page must not send", () => {
    expect(sanitizeExtraChunks([table(0), image], { tables: false, images: true }).map((c) => c.kind)).toEqual(["image"]);
    expect(sanitizeExtraChunks([table(0), image], { tables: true, images: false }).map((c) => c.kind)).toEqual(["table"]);
    const forged = [
      { ...table(0), kind: "highlight" },
      { ...table(0), kind: "transcript" },
      { ...table(0), kind: "pdf" },
      { ...table(0), kind: "text" },
    ];
    expect(sanitizeExtraChunks(forged, { tables: true, images: true })).toEqual([]);
  });

  it("rejects malformed locators and text, and caps counts and sizes", () => {
    const bad = [
      { ...table(0), locator: { tableIndex: "0", rowStart: 1, rowEnd: 2, caption: "c" } },
      { ...table(0), text: 42 },
      { ...image, locator: { images: [{ src: "javascript:alert(1)", alt: "x" }] } },
    ];
    const out = sanitizeExtraChunks(bad, { tables: true, images: true });
    // The javascript: image entry is dropped, leaving an image chunk with no images: dropped too.
    expect(out).toEqual([]);
    const many = Array.from({ length: 200 }, (_, i) => ({ ...table(i), text: "x".repeat(20_000) }));
    const capped = sanitizeExtraChunks(many, { tables: true, images: true });
    expect(capped.length).toBe(EXTRA_CHUNK_LIMITS.tableChunks);
    expect(capped[0]!.text.length).toBe(EXTRA_CHUNK_LIMITS.chars);
    expect(sanitizeExtraChunks("nope", { tables: true, images: true })).toEqual([]);
  });
});
