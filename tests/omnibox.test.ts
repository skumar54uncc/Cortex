import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  escapeOmniboxXml,
  formatSuggestion,
  toSuggestions,
  resolveEnteredUrl,
  OMNIBOX_MAX_SUGGESTIONS,
} from "../src/lib/omnibox";

describe("manifest", () => {
  it("registers the cx keyword", () => {
    const m = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
    expect(m.omnibox).toEqual({ keyword: "cx" });
  });
});

describe("escapeOmniboxXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeOmniboxXml(`a & b < c > d " e ' f`)).toBe("a &amp; b &lt; c &gt; d &quot; e &apos; f");
  });
});

describe("formatSuggestion", () => {
  it("marks query words in the title and shows the URL, escaping page text", () => {
    const s = formatSuggestion(
      { url: "https://example.com/a?x=1&y=2", title: "Tidal <b>turbines</b> & tides" },
      "tidal turbines"
    );
    expect(s.content).toBe("https://example.com/a?x=1&y=2");
    expect(s.description).toBe(
      "<match>Tidal</match> &lt;b&gt;<match>turbines</match>&lt;/b&gt; &amp; tides <dim>-</dim> <url>example.com/a?x=1&amp;y=2</url>"
    );
  });

  it("never emits raw markup from a hostile title", () => {
    const s = formatSuggestion({ url: "https://evil.test/", title: "</match><url>javascript:alert(1)</url>" }, "match");
    expect(s.description).not.toContain("<url>javascript");
    expect(s.description.match(/<url>/g)?.length).toBe(1);
  });

  it("falls back to the hostname when the title is empty", () => {
    expect(formatSuggestion({ url: "https://docs.example.com/x", title: "" }, "q").description).toContain(
      "docs.example.com"
    );
  });
});

describe("toSuggestions", () => {
  it("keeps at most 5 http(s) hits, unique by URL", () => {
    const hits = [
      ...Array.from({ length: 8 }, (_, i) => ({ url: `https://a.test/${i}`, title: `T${i}` })),
      { url: "https://a.test/0", title: "dup" },
      { url: "javascript:alert(1)", title: "bad" },
    ];
    const out = toSuggestions(hits, "t");
    expect(OMNIBOX_MAX_SUGGESTIONS).toBe(5);
    expect(out).toHaveLength(5);
    expect(new Set(out.map((s) => s.content)).size).toBe(5);
    expect(out.every((s) => s.content.startsWith("https://"))).toBe(true);
  });
});

describe("resolveEnteredUrl", () => {
  it("opens a chosen suggestion URL; free text opens the best hit; nothing unsafe", () => {
    expect(resolveEnteredUrl("https://a.test/2", "https://best.test/")).toBe("https://a.test/2");
    expect(resolveEnteredUrl("tidal turbines", "https://best.test/")).toBe("https://best.test/");
    expect(resolveEnteredUrl("tidal turbines", null)).toBeNull();
    expect(resolveEnteredUrl("javascript:alert(1)", null)).toBeNull();
    expect(resolveEnteredUrl("javascript:alert(1)", "https://best.test/")).toBe("https://best.test/");
  });
});
