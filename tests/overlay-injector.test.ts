import { describe, it, expect, vi } from "vitest";
import { openOverlayOnTab, OVERLAY_BUNDLE_FILE } from "../src/lib/overlay-injector";

function deps(overrides: Partial<Parameters<typeof openOverlayOnTab>[1]> = {}) {
  return {
    deliverOpen: vi.fn(async () => false),
    inject: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
    isInjectableUrl: vi.fn((u: string) => u.startsWith("http")),
    getTabUrl: vi.fn(async (): Promise<string | null> => "https://example.com/a"),
    ...overrides,
  };
}

describe("openOverlayOnTab", () => {
  it("delivers without injecting when the overlay is already mounted", async () => {
    const d = deps({ deliverOpen: vi.fn(async () => true) });
    expect(await openOverlayOnTab(1, d)).toBe(true);
    expect(d.inject).not.toHaveBeenCalled();
  });

  it("injects overlay.js (never content.js) and retries delivery", async () => {
    let calls = 0;
    const d = deps({
      deliverOpen: vi.fn(async () => {
        calls += 1;
        return calls >= 3;
      }),
    });
    expect(await openOverlayOnTab(7, d)).toBe(true);
    expect(d.inject).toHaveBeenCalledTimes(1);
    expect(d.inject).toHaveBeenCalledWith(7, [OVERLAY_BUNDLE_FILE]);
    expect(OVERLAY_BUNDLE_FILE).toBe("overlay.js");
    expect(d.sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget", async () => {
    const d = deps();
    expect(await openOverlayOnTab(1, d)).toBe(false);
    expect(d.deliverOpen).toHaveBeenCalledTimes(1 + 4);
  });

  it("returns false and does not inject on chrome:// or when the tab is gone", async () => {
    const a = deps({ getTabUrl: vi.fn(async () => "chrome://newtab") });
    expect(await openOverlayOnTab(1, a)).toBe(false);
    expect(a.inject).not.toHaveBeenCalled();
    const b = deps({ getTabUrl: vi.fn(async () => null) });
    expect(await openOverlayOnTab(1, b)).toBe(false);
  });

  it("returns false when injection throws (restricted page)", async () => {
    const d = deps({
      inject: vi.fn(async () => {
        throw new Error("Cannot access contents of the page");
      }),
    });
    expect(await openOverlayOnTab(1, d)).toBe(false);
    expect(d.deliverOpen).toHaveBeenCalledTimes(1);
  });
});
