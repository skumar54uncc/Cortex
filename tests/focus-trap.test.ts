// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createFocusTrap,
  focusOnceAfterTransition,
  getTabbable,
} from "../src/content/focus-trap";

function key(target: Element, key: string, shift = false): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
}

function build(): { root: HTMLElement; a: HTMLButtonElement; b: HTMLInputElement; c: HTMLAnchorElement } {
  const root = document.createElement("div");
  root.innerHTML = `
    <button id="a">A</button>
    <button disabled id="dis">disabled</button>
    <input id="b" />
    <span tabindex="-1" id="neg">neg</span>
    <div hidden><button id="hid">hidden</button></div>
    <a id="c" href="#x">C</a>
    <a id="nohref">no href</a>
  `;
  document.body.appendChild(root);
  return {
    root,
    a: root.querySelector("#a")!,
    b: root.querySelector("#b")!,
    c: root.querySelector("#c")!,
  };
}

describe("getTabbable", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns enabled, visible, tabbable elements in DOM order", () => {
    const { root, a, b, c } = build();
    expect(getTabbable(root)).toEqual([a, b, c]);
  });
});

describe("createFocusTrap", () => {
  let restoreTo: HTMLButtonElement;
  beforeEach(() => {
    restoreTo = document.createElement("button");
    restoreTo.id = "outside";
    document.body.appendChild(restoreTo);
    restoreTo.focus();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("Tab on the last element wraps to the first; Shift+Tab on the first wraps to the last", () => {
    const { root, a, c } = build();
    const trap = createFocusTrap(root, { restoreTo, onEscape: () => undefined });
    trap.activate();
    c.focus();
    const ev1 = key(c, "Tab");
    expect(ev1.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    const ev2 = key(a, "Tab", true);
    expect(ev2.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(c);
    trap.deactivate();
  });

  it("Tab in the middle is left to the browser", () => {
    const { root, a } = build();
    const trap = createFocusTrap(root, { restoreTo, onEscape: () => undefined });
    trap.activate();
    a.focus();
    const ev = key(a, "Tab");
    expect(ev.defaultPrevented).toBe(false);
    trap.deactivate();
  });

  it("Escape calls onEscape once and is consumed", () => {
    const { root, b } = build();
    const onEscape = vi.fn();
    const trap = createFocusTrap(root, { restoreTo, onEscape });
    trap.activate();
    b.focus();
    const ev = key(b, "Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    trap.deactivate();
  });

  it("deactivate restores focus to the element that had it before", () => {
    const { root, a } = build();
    const trap = createFocusTrap(root, { restoreTo, onEscape: () => undefined });
    trap.activate();
    a.focus();
    expect(document.activeElement).toBe(a);
    trap.deactivate();
    expect(document.activeElement).toBe(restoreTo);
  });

  it("focus that escapes the root is pulled back to the first tabbable", () => {
    const { root, a } = build();
    const trap = createFocusTrap(root, { restoreTo, onEscape: () => undefined });
    trap.activate();
    a.focus();
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(a);
    trap.deactivate();
    outside.focus();
    expect(document.activeElement).toBe(outside);
  });

  it("listeners are removed on deactivate", () => {
    const { root, c } = build();
    const onEscape = vi.fn();
    const trap = createFocusTrap(root, { restoreTo, onEscape });
    trap.activate();
    trap.deactivate();
    c.focus();
    key(c, "Escape");
    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe("focusOnceAfterTransition", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("focuses exactly once on transitionend, and the fallback timer does not fire again", () => {
    const panel = document.createElement("div");
    const focus = vi.fn();
    focusOnceAfterTransition(panel, focus, { fallbackMs: 300 });
    expect(focus).not.toHaveBeenCalled();
    panel.dispatchEvent(new Event("transitionend"));
    expect(focus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timer when no transition fires (reduced motion), still once", () => {
    const panel = document.createElement("div");
    const focus = vi.fn();
    focusOnceAfterTransition(panel, focus, { fallbackMs: 300 });
    vi.advanceTimersByTime(299);
    expect(focus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(focus).toHaveBeenCalledTimes(1);
    panel.dispatchEvent(new Event("transitionend"));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("returns a cancel function", () => {
    const panel = document.createElement("div");
    const focus = vi.fn();
    const cancel = focusOnceAfterTransition(panel, focus, { fallbackMs: 300 });
    cancel();
    vi.advanceTimersByTime(1000);
    panel.dispatchEvent(new Event("transitionend"));
    expect(focus).not.toHaveBeenCalled();
  });
});

describe("createFocusTrap inside a closed shadow root (production overlay)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function buildShadow() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "closed" });
    const panel = document.createElement("div");
    panel.innerHTML = `<button id="a">A</button><input id="b" /><a id="c" href="#x">C</a>`;
    shadow.appendChild(panel);
    return {
      host,
      panel,
      a: panel.querySelector<HTMLButtonElement>("#a")!,
      b: panel.querySelector<HTMLInputElement>("#b")!,
      c: panel.querySelector<HTMLAnchorElement>("#c")!,
      active: () => shadow.activeElement,
    };
  }

  it("moving focus between elements inside the shadow root is not treated as an escape", () => {
    const { panel, a, b, active } = buildShadow();
    const trap = createFocusTrap(panel, { restoreTo: null, onEscape: () => undefined });
    trap.activate();
    a.focus();
    b.focus();
    expect(active()).toBe(b);
    trap.deactivate();
  });

  it("Tab wraps using the shadow root's active element, and outside focus is pulled back", () => {
    const { panel, a, b, c, active } = buildShadow();
    const trap = createFocusTrap(panel, { restoreTo: null, onEscape: () => undefined });
    trap.activate();
    b.focus();
    const mid = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    b.dispatchEvent(mid);
    expect(mid.defaultPrevented).toBe(false);
    c.focus();
    const last = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    c.dispatchEvent(last);
    expect(last.defaultPrevented).toBe(true);
    expect(active()).toBe(a);
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();
    expect(active()).toBe(a);
    trap.deactivate();
  });
});
