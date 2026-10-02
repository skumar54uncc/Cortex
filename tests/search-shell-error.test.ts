// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("../src/content/overlay", () => ({
  mountOverlay: () => {
    throw new Error('<img src=x onerror="window.__pwned=1">boom');
  },
  openCortexOverlay: () => undefined,
}));

describe("search shell load error", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.replaceChildren();
  });

  it("shows the error as text, never as HTML", async () => {
    await import("../src/search/search-shell");
    const pre = document.body.querySelector("pre");
    expect(document.body.querySelector("img")).toBeNull();
    expect(pre?.textContent).toBe(
      'Cortex could not load.\n<img src=x onerror="window.__pwned=1">boom'
    );
  });

  it("uses themeable boot-error class instead of light-only inline color", async () => {
    await import("../src/search/search-shell");
    const pre = document.body.querySelector("pre");
    expect(pre?.className).toBe("cx-shell-boot-error");
    expect(pre?.getAttribute("style") ?? "").not.toMatch(/color:\s*#1c1917/i);
  });
});
