import { describe, it, expect, vi } from "vitest";
import { requestExtraction, EXTRACT_BUNDLE_FILE } from "../src/lib/extract-injector";

function deps(overrides: Partial<Parameters<typeof requestExtraction>[1]> = {}) {
  return {
    gate: vi.fn(async () => ({ skip: false as const })),
    deliver: vi.fn(async () => false),
    inject: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("requestExtraction", () => {
  it("skip from the gate: nothing is injected or messaged", async () => {
    const d = deps({ gate: vi.fn(async () => ({ skip: true as const, reason: "blocklist" })) });
    expect(await requestExtraction(4, d)).toEqual({ ok: false, reason: "blocklist" });
    expect(d.inject).not.toHaveBeenCalled();
    expect(d.deliver).not.toHaveBeenCalled();
  });

  it("extractor already present: messaged, not injected again", async () => {
    const d = deps({ deliver: vi.fn(async () => true) });
    expect(await requestExtraction(4, d)).toEqual({ ok: true, injected: false });
    expect(d.inject).not.toHaveBeenCalled();
  });

  it("first request on a page injects extract.js once, then messages it", async () => {
    let calls = 0;
    const d = deps({ deliver: vi.fn(async () => ++calls > 1) });
    expect(await requestExtraction(9, d)).toEqual({ ok: true, injected: true });
    expect(d.inject).toHaveBeenCalledTimes(1);
    expect(d.inject).toHaveBeenCalledWith(9, [EXTRACT_BUNDLE_FILE]);
    expect(EXTRACT_BUNDLE_FILE).toBe("extract.js");
  });

  it("injection failure (restricted page) is reported, not thrown", async () => {
    const d = deps({ inject: vi.fn(async () => { throw new Error("Cannot access"); }) });
    expect(await requestExtraction(1, d)).toEqual({ ok: false, reason: "inject_failed" });
  });

  it("extractor that never answers after injection is reported", async () => {
    const d = deps();
    expect(await requestExtraction(1, d)).toEqual({ ok: false, reason: "no_extractor" });
  });
});
