import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVAL_PINNED_NOW_ISO, EVAL_PINNED_NOW_MS } from "../src/clock";

describe("eval clock pin", () => {
  it("matches the latest captured_at in the frozen corpus", () => {
    const path = join(fileURLToPath(new URL(".", import.meta.url)), "..", "corpus", "pages.jsonl");
    const dates = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { captured_at: string }).captured_at);
    const latest = dates.reduce((a, b) => (a > b ? a : b));
    expect(EVAL_PINNED_NOW_ISO).toBe(latest);
    expect(EVAL_PINNED_NOW_MS).toBe(Date.parse(latest));
  });
});
