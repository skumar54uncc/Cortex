import { describe, it, expect } from "vitest";
import {
  chunkArticle,
  CHUNK_PROFILES,
  CHUNKING_VERSION,
  DEFAULT_CHUNK_PROFILE,
  reconstructTextFromChunks,
} from "../src/lib/chunking";

function wordsText(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i + 1}`).join(" ");
}

describe("chunk profiles", () => {
  it("exposes compact (180/40) and wide (420/75) profiles and a chunking version", () => {
    expect(CHUNK_PROFILES.compact).toEqual({ targetWords: 180, overlapWords: 40, maxChunks: 88 });
    expect(CHUNK_PROFILES.wide).toEqual({ targetWords: 420, overlapWords: 75, maxChunks: 36 });
    expect(DEFAULT_CHUNK_PROFILE).toBe("compact");
    expect(CHUNKING_VERSION).toBe(2);
    expect(typeof CHUNKING_VERSION).toBe("number");
    expect(CHUNK_PROFILES[DEFAULT_CHUNK_PROFILE]).toBeDefined();
  });

  it("compact profile makes 180-word windows stepping by 140", () => {
    const chunks = chunkArticle(wordsText(500), CHUNK_PROFILES.compact);
    expect(chunks.map((c) => c.text.split(" ").length)).toEqual([180, 180, 180, 80]);
    expect(chunks[1].text.split(" ")[0]).toBe("w141");
    expect(chunks.map((c) => c.ord)).toEqual([0, 1, 2, 3]);
  });

  it("wide profile makes 420-word windows stepping by 345", () => {
    const chunks = chunkArticle(wordsText(800), CHUNK_PROFILES.wide);
    expect(chunks.map((c) => c.text.split(" ").length)).toEqual([420, 420, 110]);
    expect(chunks[1].text.split(" ")[0]).toBe("w346");
  });

  it("both profiles cover about the same number of words before the cap", () => {
    const text = wordsText(20_000);
    const compact = chunkArticle(text, CHUNK_PROFILES.compact);
    const wide = chunkArticle(text, CHUNK_PROFILES.wide);
    const lastWord = (c: { text: string }[]) => Number(c[c.length - 1].text.split(" ").pop()!.slice(1));
    expect(compact.length).toBe(88);
    expect(wide.length).toBe(36);
    expect(Math.abs(lastWord(compact) - lastWord(wide))).toBeLessThan(500);
  });

  it("default call uses the default profile", () => {
    const a = chunkArticle(wordsText(800));
    const b = chunkArticle(wordsText(800), CHUNK_PROFILES[DEFAULT_CHUNK_PROFILE]);
    expect(a).toEqual(b);
  });
});

describe("reconstructTextFromChunks", () => {
  it("rebuilds the original words from overlapping windows (either profile)", () => {
    for (const profile of [CHUNK_PROFILES.compact, CHUNK_PROFILES.wide]) {
      const original = wordsText(1234);
      const chunks = chunkArticle(original, profile);
      const rebuilt = reconstructTextFromChunks(
        chunks.map((c) => ({ ord: c.ord, text: c.text })),
        profile
      );
      expect(rebuilt).toBe(original);
    }
  });

  it("handles a single chunk and out-of-order input", () => {
    const original = wordsText(50);
    expect(reconstructTextFromChunks([{ ord: 0, text: original }], CHUNK_PROFILES.wide)).toBe(original);
    const chunks = chunkArticle(wordsText(600), CHUNK_PROFILES.compact);
    const shuffled = [...chunks].reverse();
    expect(reconstructTextFromChunks(shuffled, CHUNK_PROFILES.compact)).toBe(wordsText(600));
  });

  it("falls back to overlap-free join when the boundary does not line up", () => {
    const chunks = [
      { ord: 0, text: "alpha beta gamma" },
      { ord: 1, text: "delta epsilon" },
    ];
    expect(reconstructTextFromChunks(chunks, CHUNK_PROFILES.compact)).toBe("alpha beta gamma delta epsilon");
  });
});
