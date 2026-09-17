import { describe, it, expect } from "vitest";
import { ChatRunRegistry } from "../src/lib/chat/chat-run-registry";

describe("ChatRunRegistry", () => {
  it("starts a run and hands back an AbortSignal", () => {
    const reg = new ChatRunRegistry();
    const signal = reg.start(5, 1);
    expect(signal.aborted).toBe(false);
    expect(reg.size).toBe(1);
  });

  it("abort(tabId, requestId) aborts only that run", () => {
    const reg = new ChatRunRegistry();
    const a = reg.start(5, 1);
    const b = reg.start(5, 2);
    const c = reg.start(6, 1);
    expect(reg.abort(5, 1)).toBe(true);
    expect(a.aborted).toBe(true);
    expect(b.aborted).toBe(false);
    expect(c.aborted).toBe(false);
    expect(reg.abort(5, 99)).toBe(false);
  });

  it("finish removes the run; aborting a finished run is a no-op", () => {
    const reg = new ChatRunRegistry();
    reg.start(1, 1);
    reg.finish(1, 1);
    expect(reg.size).toBe(0);
    expect(reg.abort(1, 1)).toBe(false);
  });

  it("starting the same tab+request again aborts the stale one", () => {
    const reg = new ChatRunRegistry();
    const first = reg.start(1, 1);
    const second = reg.start(1, 1);
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(reg.size).toBe(1);
  });
});
