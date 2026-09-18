// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/content/overlay", () => ({
  mountOverlay: () => {
    throw new Error('<img src=x onerror="window.__pwned=1">boom');
  },
  openCortexOverlay: () => undefined,
}));

describe("search shell load error", () => {
  it("shows the error as text, never as HTML", async () => {
    await import("../src/search/search-shell");
    const pre = document.body.querySelector("pre");
    expect(document.body.querySelector("img")).toBeNull();
    expect(pre?.textContent).toBe('Cortex could not load.\n<img src=x onerror="window.__pwned=1">boom');
  });
});
