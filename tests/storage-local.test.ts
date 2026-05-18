import { describe, expect, it, vi } from "vitest";
import {
  storageLocalArea,
  storageLocalGet,
} from "../src/shared/storage-local";

describe("storage-local", () => {
  it("returns null when chrome.storage is missing", () => {
    const prev = globalThis.chrome;
    // @ts-expect-error test stub
    globalThis.chrome = { runtime: {} };
    expect(storageLocalArea()).toBeNull();
    globalThis.chrome = prev;
  });

  it("storageLocalGet resolves empty when storage missing", async () => {
    const prev = globalThis.chrome;
    // @ts-expect-error test stub
    globalThis.chrome = { runtime: {} };
    await expect(storageLocalGet(["key"])).resolves.toEqual({});
    globalThis.chrome = prev;
  });

  it("does not throw when chrome is undefined", async () => {
    const prev = globalThis.chrome;
    // @ts-expect-error test stub
    globalThis.chrome = undefined;
    expect(storageLocalArea()).toBeNull();
    await expect(storageLocalGet(["x"])).resolves.toEqual({});
    globalThis.chrome = prev;
  });
});
