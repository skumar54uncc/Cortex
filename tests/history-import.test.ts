import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeHistoryIndexText,
  MIN_HISTORY_IMPORT_TEXT_CHARS,
} from "../src/lib/history-import";

describe("composeHistoryIndexText", () => {
  it("includes title and URL when extract is empty", () => {
    const text = composeHistoryIndexText(
      {
        url: "https://www.google.com/search?q=support+operator",
        title: "support operator - Google Search",
      },
      ""
    );
    expect(text).toContain("support operator");
    expect(text).toContain("google.com");
    expect(text.length).toBeGreaterThanOrEqual(MIN_HISTORY_IMPORT_TEXT_CHARS);
  });

  it("merges extract with history metadata", () => {
    const text = composeHistoryIndexText(
      { url: "https://example.com/docs", title: "Docs" },
      "Installation guide for the API."
    );
    expect(text).toContain("Docs");
    expect(text).toContain("Installation guide");
    expect(text).toContain("example.com");
  });
});

describe("CORTEX_HISTORY_IMPORT message gates", () => {
  it("rejects non-options senders for start and cancel", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "background", "service-worker.ts"),
      "utf8"
    );
    const start = source.slice(
      source.indexOf('type === "CORTEX_HISTORY_IMPORT_START"'),
      source.indexOf('type === "CORTEX_INDEXING_CONSENT_GRANT"')
    );
    expect(start).toContain("isOptionsPageSender(sender)");
    expect(start).toContain("grantIndexingConsent");

    const cancel = source.slice(
      source.indexOf('type === "CORTEX_HISTORY_IMPORT_CANCEL"'),
      source.indexOf('type === "CORTEX_OPEN_TAB"')
    );
    expect(cancel).toContain("isOptionsPageSender(sender)");
  });
});
