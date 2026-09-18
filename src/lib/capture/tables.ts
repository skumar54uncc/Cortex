/**
 * Tables (Phase 5.7). Data tables are captured before Readability runs, as
 * chunks of up to 12 rows where every row repeats its headers
 * ("Header: value; Header: value"), so each chunk stands on its own in search
 * and in answers. Layout tables are skipped. Caps: 10 tables and 500 rows per
 * page. Runs in extract.js on pages that passed the privacy gate.
 */
import type { ChunkLocator, NewChunk } from "../../db/schema";

export const TABLE_LIMITS = { maxTables: 10, maxRows: 500, rowsPerChunk: 12, maxCellChars: 300 } as const;

function cellText(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, TABLE_LIMITS.maxCellChars);
}

function directRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return [...table.rows].filter((r) => r.closest("table") === table);
}

export function isLayoutTable(table: HTMLTableElement): boolean {
  const role = (table.getAttribute("role") ?? "").toLowerCase();
  if (role === "presentation" || role === "none") return true;
  if (table.querySelector("table")) return true;
  if (table.parentElement?.closest("table")) return true;
  const rows = directRows(table);
  if (rows.length < 2) return true;
  const maxCols = Math.max(0, ...rows.map((r) => r.cells.length));
  if (maxCols < 2) return true;
  const hasHeader = Boolean(table.tHead) || rows[0]!.querySelector("th") != null;
  if (!hasHeader) {
    const cells = rows.flatMap((r) => [...r.cells]);
    const avg = cells.reduce((n, c) => n + (c.textContent ?? "").trim().length, 0) / Math.max(1, cells.length);
    if (avg > 200) return true;
  }
  return false;
}

function tableCaption(table: HTMLTableElement, doc: Document): string {
  const cap = table.caption ? cellText(table.caption) : "";
  if (cap) return cap;
  const aria = (table.getAttribute("aria-label") ?? "").trim();
  if (aria) return aria.slice(0, 200);
  let best = "";
  doc.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    if (h.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) best = cellText(h);
  });
  return best;
}

function headersAndRows(table: HTMLTableElement): { headers: string[]; rows: string[][] } {
  const rows = directRows(table);
  let headers: string[] = [];
  let bodyRows = rows;
  const headRow = table.tHead?.rows[0];
  if (headRow) {
    headers = [...headRow.cells].map(cellText);
    bodyRows = rows.filter((r) => r.parentElement !== table.tHead);
  } else if (rows[0] && [...rows[0].cells].every((c) => c.tagName === "TH")) {
    headers = [...rows[0].cells].map(cellText);
    bodyRows = rows.slice(1);
  }
  const width = Math.max(headers.length, ...bodyRows.map((r) => r.cells.length));
  for (let i = 0; i < width; i++) if (!headers[i]) headers[i] = `Column ${i + 1}`;
  return {
    headers,
    rows: bodyRows.map((r) => [...r.cells].map(cellText)).filter((cells) => cells.some(Boolean)),
  };
}

export interface ExtractedTables {
  chunks: NewChunk[];
  /** Document-order indexes (querySelectorAll("table")) of captured tables. */
  capturedTableIndexes: number[];
}

export function extractTables(doc: Document): ExtractedTables {
  const all = [...doc.querySelectorAll("table")] as HTMLTableElement[];
  const chunks: NewChunk[] = [];
  const captured: number[] = [];
  let rowsLeft: number = TABLE_LIMITS.maxRows;
  let tableIndex = 0;

  for (let docIndex = 0; docIndex < all.length; docIndex++) {
    if (tableIndex >= TABLE_LIMITS.maxTables || rowsLeft <= 0) break;
    const table = all[docIndex]!;
    if (isLayoutTable(table)) continue;
    const { headers, rows } = headersAndRows(table);
    if (!rows.length) continue;
    const caption = tableCaption(table, doc);
    const take = rows.slice(0, rowsLeft);
    rowsLeft -= take.length;
    for (let start = 0; start < take.length; start += TABLE_LIMITS.rowsPerChunk) {
      const slice = take.slice(start, start + TABLE_LIMITS.rowsPerChunk);
      const lines = slice.map((cells) =>
        cells
          .map((v, i) => (v ? `${headers[i] ?? `Column ${i + 1}`}: ${v}` : ""))
          .filter(Boolean)
          .join("; ")
      );
      const locator: ChunkLocator = {
        tableIndex,
        rowStart: start + 1,
        rowEnd: start + slice.length,
        caption,
      };
      chunks.push({
        ord: 2000 + chunks.length,
        text: `Table: ${caption || "untitled"}\n${lines.join("\n")}`,
        kind: "table",
        locator,
      });
    }
    captured.push(docIndex);
    tableIndex += 1;
  }
  return { chunks, capturedTableIndexes: captured };
}
