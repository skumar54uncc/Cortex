import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Core value 7: no em dashes in user-facing copy. Scans every source file
 * that renders UI (overlay, side panel, popup, options, onboarding, shared
 * copy) and lists offending lines so the fix is one grep away.
 */
const UI_ROOTS = [
  "src/content",
  "src/options",
  "src/popup",
  "src/onboarding",
  "src/search",
  "src/lib/locales",
  "src/lib/chat",
  "src/lib/errors.ts",
];

function walk(p: string, out: string[]): void {
  const st = statSync(p);
  if (st.isFile()) {
    if (/\.(ts|html|css|json)$/.test(p) && !/\.test\.ts$/.test(p)) out.push(p);
    return;
  }
  for (const name of readdirSync(p)) walk(join(p, name), out);
}

describe("user-facing copy", () => {
  it("contains no em dash (U+2014) in UI source files", () => {
    const root = join(__dirname, "..");
    const files: string[] = [];
    for (const r of UI_ROOTS) walk(join(root, r), files);
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.includes("—")) offenders.push(`${f.replace(root, "")}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
