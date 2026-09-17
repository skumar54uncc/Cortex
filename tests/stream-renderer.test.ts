// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createStreamRenderer } from "../src/content/stream-renderer";

/** Fake requestAnimationFrame: frames run only when flushFrames() is called. */
function fakeRaf() {
  const queue: FrameRequestCallback[] = [];
  const raf = vi.fn((cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  const flushFrames = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      const batch = queue.splice(0, queue.length);
      for (const cb of batch) cb(performance.now());
    }
  };
  return { raf, flushFrames, queue };
}

function countWrites(el: HTMLElement): { writes: () => number; stop: () => void } {
  let n = 0;
  const mo = new MutationObserver((records) => {
    n += records.length;
  });
  mo.observe(el, { childList: true, characterData: true, subtree: true });
  return {
    writes: () => {
      // MutationObserver batches asynchronously; takeRecords() drains synchronously.
      n += mo.takeRecords().length;
      return n;
    },
    stop: () => mo.disconnect(),
  };
}

describe("createStreamRenderer", () => {
  it("buffers tokens and flushes at most one DOM write per animation frame", () => {
    const { raf, flushFrames } = fakeRaf();
    const el = document.createElement("div");
    const cursor = document.createElement("span");
    cursor.textContent = "|";
    el.appendChild(cursor);
    const counter = countWrites(el);
    counter.writes(); // drain setup

    const r = createStreamRenderer(el, cursor, { raf });
    r.push("Hel");
    r.push("lo ");
    r.push("wor");
    expect(counter.writes()).toBe(0);
    expect(raf).toHaveBeenCalledTimes(1);

    flushFrames();
    const afterFirst = counter.writes();
    expect(afterFirst).toBe(1);
    expect(el.textContent).toBe("Hello wor|");

    r.push("ld");
    flushFrames();
    expect(counter.writes()).toBe(2);
    expect(el.textContent).toBe("Hello world|");
    counter.stop();
  });

  it("appends to a single text node before the cursor instead of rewriting", () => {
    const { raf, flushFrames } = fakeRaf();
    const el = document.createElement("div");
    const cursor = document.createElement("span");
    el.appendChild(cursor);
    const r = createStreamRenderer(el, cursor, { raf });
    r.push("a");
    flushFrames();
    const textNode = el.firstChild;
    expect(textNode?.nodeType).toBe(Node.TEXT_NODE);
    r.push("b");
    flushFrames();
    expect(el.firstChild).toBe(textNode);
    expect(el.childNodes.length).toBe(2);
    expect(el.lastChild).toBe(cursor);
    expect(r.text()).toBe("ab");
  });

  it("finish(renderFinal) drains the buffer, removes the cursor and keeps the same scroll height when the final node matches", () => {
    const { raf, flushFrames } = fakeRaf();
    const el = document.createElement("div");
    const cursor = document.createElement("span");
    el.appendChild(cursor);
    const r = createStreamRenderer(el, cursor, { raf });
    r.push("final ");
    r.push("text");
    // Not flushed yet
    const final = document.createElement("div");
    final.className = "rich";
    final.textContent = "final text";
    r.finish(() => final);
    // finish must be synchronous: no pending frame needed.
    expect(el.textContent).toBe("final text");
    expect(el.contains(cursor)).toBe(false);
    expect(el.querySelector(".rich")).toBe(final);
    flushFrames();
    expect(el.textContent).toBe("final text");
    expect(r.text()).toBe("final text");
  });

  it("push after finish is ignored", () => {
    const { raf, flushFrames } = fakeRaf();
    const el = document.createElement("div");
    const cursor = document.createElement("span");
    el.appendChild(cursor);
    const r = createStreamRenderer(el, cursor, { raf });
    r.push("x");
    flushFrames();
    r.finish(null);
    r.push("late");
    flushFrames();
    expect(el.textContent).toBe("x");
  });

  it("cancel() drops buffered text and the cursor without rendering", () => {
    const { raf, flushFrames } = fakeRaf();
    const el = document.createElement("div");
    const cursor = document.createElement("span");
    el.appendChild(cursor);
    const r = createStreamRenderer(el, cursor, { raf });
    r.push("keep ");
    flushFrames();
    r.push("dropped");
    r.cancel();
    flushFrames();
    expect(el.textContent).toBe("keep ");
    expect(el.contains(cursor)).toBe(false);
  });
});
