// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractTables,
  isLayoutTable,
  TABLE_LIMITS,
} from "../src/lib/capture/tables";
import { extractPageText } from "../src/content/extract";

const html = readFileSync(join(__dirname, "fixtures", "tables", "synth-prices.html"), "utf8");
const load = () => new DOMParser().parseFromString(html, "text/html");

describe("isLayoutTable", () => {
  it("skips presentation, single column and nested layout tables; keeps data tables", () => {
    const doc = load();
    const all = [...doc.querySelectorAll("table")];
    const byId = (id: string) => all.find((t) => t.id === id)!;
    expect(isLayoutTable(all[0]!)).toBe(true); // role=presentation
    expect(isLayoutTable(byId("single"))).toBe(true);
    expect(isLayoutTable(byId("nested"))).toBe(true);
    expect(isLayoutTable(byId("prices"))).toBe(false);
    expect(isLayoutTable(byId("parts"))).toBe(false);
  });
});

describe("extractTables", () => {
  it("chunks data tables every 12 rows, repeating headers as 'Header: value'", () => {
    const res = extractTables(load());
    // prices: 40 rows -> 4 chunks (12, 12, 12, 4); parts: 2 rows -> 1 chunk
    expect(res.chunks).toHaveLength(5);
    const first = res.chunks[0]!;
    expect(first.kind).toBe("table");
    expect(first.locator).toEqual({ tableIndex: 0, rowStart: 1, rowEnd: 12, caption: "Voice card recap prices, 2026" });
    expect(first.text.split("\n")[0]).toBe("Table: Voice card recap prices, 2026");
    expect(first.text).toContain("Model: Synth 1; Price (credits): 101; Rating: 2");
    expect(res.chunks[3]!.locator).toEqual({ tableIndex: 0, rowStart: 37, rowEnd: 40, caption: "Voice card recap prices, 2026" });
    const parts = res.chunks[4]!;
    // No <caption>: the nearest preceding heading names the table.
    expect(parts.locator).toEqual({ tableIndex: 1, rowStart: 1, rowEnd: 2, caption: "Parts list" });
    expect(parts.text).toContain("Part: Capacitor 10uF; Count: 24");
  });

  it("reports the document-order indexes of captured tables so the article text can drop them", () => {
    const res = extractTables(load());
    expect(res.capturedTableIndexes).toEqual([1, 2]);
  });

  it("caps tables per page and rows per page", () => {
    const many = Array.from({ length: 14 }, (_, t) => {
      const rows = Array.from({ length: 60 }, (_, r) => `<tr><td>r${r}</td><td>${t}</td></tr>`).join("");
      return `<table><tr><th>Name</th><th>Table</th></tr>${rows}</table>`;
    }).join("");
    const doc = new DOMParser().parseFromString(`<main>${many}</main>`, "text/html");
    const res = extractTables(doc);
    expect(new Set(res.chunks.map((c) => (c.locator as { tableIndex: number }).tableIndex)).size).toBeLessThanOrEqual(TABLE_LIMITS.maxTables);
    const rows = res.chunks.reduce((n, c) => n + ((c.locator as { rowEnd: number; rowStart: number }).rowEnd - (c.locator as { rowStart: number }).rowStart + 1), 0);
    expect(rows).toBeLessThanOrEqual(TABLE_LIMITS.maxRows);
  });
});

describe("article text without captured tables", () => {
  it("extractPageText can drop captured tables so rows are not indexed twice", () => {
    const doc = load();
    const { capturedTableIndexes } = extractTables(doc);
    // The page itself contains the rows...
    expect(doc.body.textContent).toContain("Synth 17");
    // ...the article text sent for chunking does not, and keeps the prose.
    const without = extractPageText(doc, undefined, { dropTableIndexes: capturedTableIndexes }).text;
    expect(without).not.toContain("Synth 17");
    expect(without).not.toContain("Capacitor 10uF");
    expect(without).toContain("calibration trims");
    expect(without).toContain("voice card work");
  });
});
