import { readFileSync } from "node:fs";
import type { CorpusPage, PageCategory, RetrievalQuery, QueryType } from "./types";

const PAGE_CATEGORIES = new Set<PageCategory>([
  "wikipedia",
  "docs",
  "blog",
  "news",
  "spa",
  "long-form",
]);

const QUERY_TYPES = new Set<QueryType>([
  "factual",
  "navigational",
  "exploratory",
  "negative",
]);

export class JsonlParseError extends Error {
  constructor(
    message: string,
    public readonly lineNumber: number
  ) {
    super(`${message} (line ${lineNumber})`);
    this.name = "JsonlParseError";
  }
}

function parseJsonlLines(content: string): { value: unknown; lineNumber: number }[] {
  const lines = content.split(/\r?\n/);
  const out: { value: unknown; lineNumber: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (!line) continue;
    try {
      out.push({ value: JSON.parse(line) as unknown, lineNumber: i + 1 });
    } catch {
      throw new JsonlParseError("Invalid JSON", i + 1);
    }
  }
  return out;
}

function assertString(v: unknown, field: string, line: number): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new JsonlParseError(`Missing or invalid field "${field}"`, line);
  }
  return v;
}

function assertStringArray(v: unknown, field: string, line: number): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new JsonlParseError(`Missing or invalid field "${field}"`, line);
  }
  return v as string[];
}

export function validateCorpusPage(raw: unknown, lineNumber: number): CorpusPage {
  if (typeof raw !== "object" || raw === null) {
    throw new JsonlParseError("Expected JSON object", lineNumber);
  }
  const o = raw as Record<string, unknown>;
  const category = assertString(o.category, "category", lineNumber);
  if (!PAGE_CATEGORIES.has(category as PageCategory)) {
    throw new JsonlParseError(`Invalid category "${category}"`, lineNumber);
  }
  return {
    id: assertString(o.id, "id", lineNumber),
    url: assertString(o.url, "url", lineNumber),
    title: assertString(o.title, "title", lineNumber),
    html: assertString(o.html, "html", lineNumber),
    extracted_text: assertString(o.extracted_text, "extracted_text", lineNumber),
    captured_at: assertString(o.captured_at, "captured_at", lineNumber),
    category: category as PageCategory,
  };
}

export function validateRetrievalQuery(
  raw: unknown,
  lineNumber: number
): RetrievalQuery {
  if (typeof raw !== "object" || raw === null) {
    throw new JsonlParseError("Expected JSON object", lineNumber);
  }
  const o = raw as Record<string, unknown>;
  const query_type = assertString(o.query_type, "query_type", lineNumber);
  if (!QUERY_TYPES.has(query_type as QueryType)) {
    throw new JsonlParseError(`Invalid query_type "${query_type}"`, lineNumber);
  }
  const notes = o.notes;
  return {
    id: assertString(o.id, "id", lineNumber),
    query: assertString(o.query, "query", lineNumber),
    relevant_doc_ids: assertStringArray(o.relevant_doc_ids, "relevant_doc_ids", lineNumber),
    relevant_chunk_ids: assertStringArray(
      o.relevant_chunk_ids,
      "relevant_chunk_ids",
      lineNumber
    ),
    query_type: query_type as QueryType,
    notes: typeof notes === "string" ? notes : undefined,
  };
}

export function loadCorpusFromFile(filePath: string): CorpusPage[] {
  const content = readFileSync(filePath, "utf8");
  const pages = parseJsonlLines(content).map(({ value, lineNumber }) =>
    validateCorpusPage(value, lineNumber)
  );
  pages.sort((a, b) => a.id.localeCompare(b.id));
  return pages;
}

export function loadQueriesFromFile(filePath: string): RetrievalQuery[] {
  const content = readFileSync(filePath, "utf8");
  const queries = parseJsonlLines(content).map(({ value, lineNumber }) =>
    validateRetrievalQuery(value, lineNumber)
  );
  queries.sort((a, b) => a.id.localeCompare(b.id));
  return queries;
}
