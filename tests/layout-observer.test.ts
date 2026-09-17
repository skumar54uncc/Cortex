// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { applyLayoutForWidth, observePanelLayout } from "../src/content/layout-mode";

type Cb = (entries: { contentRect: { width: number } }[]) => void;

function fakeResizeObserver() {
  const instances: { cb: Cb; observed: Element[]; disconnected: boolean }[] = [];
  class RO {
    cb: Cb;
    observed: Element[] = [];
    disconnected = false;
    constructor(cb: Cb) {
      this.cb = cb;
      instances.push(this);
    }
    observe(el: Element) {
      this.observed.push(el);
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  return { RO, instances };
}

describe("applyLayoutForWidth", () => {
  it("writes data-layout on the panel", () => {
    const panel = document.createElement("div");
    expect(applyLayoutForWidth(panel, 1000)).toBe("wide");
    expect(panel.getAttribute("data-layout")).toBe("wide");
    applyLayoutForWidth(panel, 400);
    expect(panel.getAttribute("data-layout")).toBe("narrow");
  });
});

describe("observePanelLayout", () => {
  it("applies the initial width synchronously and observes the panel", () => {
    const { RO, instances } = fakeResizeObserver();
    const panel = document.createElement("div");
    const onChange = vi.fn();
    observePanelLayout(panel, 700, onChange, RO);
    expect(panel.getAttribute("data-layout")).toBe("medium");
    expect(onChange).toHaveBeenCalledWith("medium");
    expect(instances[0].observed).toEqual([panel]);
  });

  it("updates data-layout from resize entries and only reports changes", () => {
    const { RO, instances } = fakeResizeObserver();
    const panel = document.createElement("div");
    const onChange = vi.fn();
    observePanelLayout(panel, 1000, onChange, RO);
    onChange.mockClear();
    instances[0].cb([{ contentRect: { width: 900 } }]);
    expect(panel.getAttribute("data-layout")).toBe("wide");
    expect(onChange).not.toHaveBeenCalled();
    instances[0].cb([{ contentRect: { width: 500 } }]);
    expect(panel.getAttribute("data-layout")).toBe("narrow");
    expect(onChange).toHaveBeenCalledWith("narrow");
  });

  it("disconnects", () => {
    const { RO, instances } = fakeResizeObserver();
    const stop = observePanelLayout(document.createElement("div"), 1000, undefined, RO);
    stop();
    expect(instances[0].disconnected).toBe(true);
  });

  it("does not throw without ResizeObserver support", () => {
    const panel = document.createElement("div");
    const stop = observePanelLayout(panel, 300, undefined, undefined);
    expect(panel.getAttribute("data-layout")).toBe("narrow");
    stop();
  });
});
