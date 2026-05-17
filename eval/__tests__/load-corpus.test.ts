import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JsonlParseError,
  loadCorpusFromFile,
  loadQueriesFromFile,
} from "../src/load-corpus";

describe("load-corpus", () => {
  it("rejects truncated JSON with line number", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-eval-"));
    const path = join(dir, "bad.jsonl");
    writeFileSync(path, '{"id":"x"\n', "utf8");
    expect(() => loadCorpusFromFile(path)).toThrow(JsonlParseError);
    try {
      loadCorpusFromFile(path);
    } catch (e) {
      expect((e as JsonlParseError).lineNumber).toBe(1);
    }
  });

  it("rejects missing required field", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-eval-"));
    const path = join(dir, "bad.jsonl");
    writeFileSync(
      path,
      JSON.stringify({
        id: "p1",
        url: "https://example.test/a",
        title: "T",
        html: "<p>x</p>",
        captured_at: "2026-05-17T00:00:00Z",
        category: "blog",
      }) + "\n",
      "utf8"
    );
    expect(() => loadCorpusFromFile(path)).toThrow(/extracted_text/);
  });

  it("rejects invalid category", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-eval-"));
    const path = join(dir, "queries.jsonl");
    writeFileSync(
      path,
      JSON.stringify({
        id: "q1",
        query: "test",
        relevant_doc_ids: [],
        relevant_chunk_ids: [],
        query_type: "unknown",
      }) + "\n",
      "utf8"
    );
    expect(() => loadQueriesFromFile(path)).toThrow(/query_type/);
  });
});
