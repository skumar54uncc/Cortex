import { describe, expect, it } from "vitest";
import {
  clearQueryEmbeddingCache,
  embedWithSessionCache,
  queryEmbeddingCacheSize,
} from "../src/lib/query-embed-cache";

describe("query embedding session cache", () => {
  it("embeds once and returns a copy", async () => {
    clearQueryEmbeddingCache();
    let calls = 0;
    const embed = async () => {
      calls += 1;
      return [1, 2, 3];
    };
    const first = await embedWithSessionCache("  people   who work ", embed);
    const second = await embedWithSessionCache("people who work", embed);
    expect(calls).toBe(1);
    expect(second).toEqual([1, 2, 3]);
    expect(second).not.toBe(first);
    first![0] = 9;
    const third = await embedWithSessionCache("people who work", embed);
    expect(third).toEqual([1, 2, 3]);
    expect(calls).toBe(1);
  });

  it("does not cache an empty query or a failed embed", async () => {
    clearQueryEmbeddingCache();
    let calls = 0;
    const embed = async () => {
      calls += 1;
      return null;
    };
    expect(await embedWithSessionCache("   ", embed)).toBeNull();
    expect(calls).toBe(0);
    expect(await embedWithSessionCache("nitrogen", embed)).toBeNull();
    expect(await embedWithSessionCache("nitrogen", embed)).toBeNull();
    expect(calls).toBe(2);
    expect(queryEmbeddingCacheSize()).toBe(0);
  });

  it("drops the oldest entry past 32", async () => {
    clearQueryEmbeddingCache();
    const embed = async (text: string) => [text.length];
    for (let i = 0; i < 33; i++) {
      await embedWithSessionCache(`q${i}`, embed);
    }
    expect(queryEmbeddingCacheSize()).toBe(32);
    let calls = 0;
    await embedWithSessionCache("q0", async () => {
      calls += 1;
      return [0];
    });
    expect(calls).toBe(1);
    await embedWithSessionCache("q32", async () => {
      calls += 1;
      return [0];
    });
    expect(calls).toBe(1);
  });
});
