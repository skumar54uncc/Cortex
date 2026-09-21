// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  installDoubleShift,
  doubleShiftSwitch,
  DOUBLE_SHIFT_WINDOW_MS,
  CORTEX_PANEL_ROOT_ID,
} from "../src/content/double-shift";

/**
 * Shift is held for selection and pressed for every capital letter, so the
 * cancel cases matter more than the happy path. The clock is injected: these
 * tests never sleep.
 */

let clock = 0;
const now = (): number => clock;
const uninstallers: Array<() => void> = [];

function tick(ms: number): void {
  clock += ms;
}

function press(
  type: "keydown" | "keyup",
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.body
): void {
  target.dispatchEvent(
    new KeyboardEvent(type, { key, bubbles: true, composed: true, cancelable: true, ...init })
  );
}

function keydown(key: string, init: KeyboardEventInit = {}, target?: EventTarget): void {
  press("keydown", key, init, target);
}

function keyup(key: string, init: KeyboardEventInit = {}, target?: EventTarget): void {
  press("keyup", key, init, target);
}

/** One full Shift press: down then up. */
function tapShift(): void {
  keydown("Shift");
  keyup("Shift");
}

function install(onTrigger: (panelOpen: boolean) => void): () => void {
  const stop = installDoubleShift({ onTrigger, now });
  uninstallers.push(stop);
  return stop;
}

function addPanel(): HTMLElement {
  const host = document.createElement("div");
  host.id = CORTEX_PANEL_ROOT_ID;
  document.body.appendChild(host);
  return host;
}

beforeEach(() => {
  clock = 1000;
  document.body.replaceChildren();
});

afterEach(() => {
  while (uninstallers.length) uninstallers.pop()?.();
});

describe("double Shift detector", () => {
  it("fires once when two full taps land inside the window", () => {
    const fired = vi.fn();
    install(fired);

    tapShift();
    tick(120);
    keydown("Shift");

    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith(false);
  });

  it("fires on the window's last millisecond but not one past it", () => {
    const fired = vi.fn();
    install(fired);

    tapShift();
    tick(DOUBLE_SHIFT_WINDOW_MS);
    tapShift();
    expect(fired).toHaveBeenCalledTimes(1);

    tapShift();
    tick(DOUBLE_SHIFT_WINDOW_MS + 1);
    tapShift();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the second tap is slow", () => {
    const fired = vi.fn();
    install(fired);

    tapShift();
    tick(900);
    tapShift();

    expect(fired).not.toHaveBeenCalled();
  });

  it("re-arms after a slow tap: the late tap becomes the new first one", () => {
    const fired = vi.fn();
    install(fired);

    tapShift();
    tick(900);
    tapShift(); // too late, starts over
    tick(80);
    tapShift();

    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("cancels when another key is pressed between the taps", () => {
    const fired = vi.fn();
    install(fired);

    tapShift();
    tick(50);
    keydown("a");
    keyup("a");
    tick(50);
    tapShift();

    expect(fired).not.toHaveBeenCalled();
  });

  it("ignores Shift held for a capital letter", () => {
    const fired = vi.fn();
    install(fired);

    keydown("Shift");
    keydown("A", { shiftKey: true });
    keyup("A", { shiftKey: true });
    keyup("Shift");
    tick(60);
    keydown("Shift");
    keydown("B", { shiftKey: true });

    expect(fired).not.toHaveBeenCalled();
  });

  it("ignores Shift held for an arrow-key selection", () => {
    const fired = vi.fn();
    install(fired);

    keydown("Shift");
    keydown("ArrowRight", { shiftKey: true });
    keydown("ArrowRight", { shiftKey: true, repeat: true });
    keyup("ArrowRight", { shiftKey: true });
    keyup("Shift");
    tick(40);
    tapShift();

    expect(fired).not.toHaveBeenCalled();
  });

  it("ignores auto-repeat from a held Shift", () => {
    const fired = vi.fn();
    install(fired);

    keydown("Shift");
    for (let i = 0; i < 6; i++) {
      tick(30);
      keydown("Shift", { repeat: true });
    }
    keyup("Shift");

    expect(fired).not.toHaveBeenCalled();
  });

  it("requires a release: two keydowns without a keyup do nothing", () => {
    const fired = vi.fn();
    install(fired);

    keydown("Shift");
    tick(60);
    keydown("Shift");

    expect(fired).not.toHaveBeenCalled();
  });

  it("cancels when a mouse press lands between the taps", () => {
    const fired = vi.fn();
    install(fired);

    tapShift();
    tick(50);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    tick(50);
    tapShift();

    expect(fired).not.toHaveBeenCalled();
  });

  it("does not count Shift pressed together with Ctrl, Alt or Meta", () => {
    const fired = vi.fn();
    install(fired);

    const held: KeyboardEventInit[] = [
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
    ];
    for (const mod of held) {
      tapShift();
      tick(40);
      keydown("Shift", mod);
      keyup("Shift", mod);
    }

    expect(fired).not.toHaveBeenCalled();
  });

  it("fires once for a burst of three quick taps, not twice", () => {
    const fired = vi.fn();
    install(fired);

    tapShift();
    tick(60);
    tapShift(); // trigger
    tick(60);
    tapShift(); // first tap of a fresh sequence

    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("fires again once the fresh sequence completes", () => {
    const fired = vi.fn();
    install(fired);

    tapShift();
    tick(60);
    tapShift(); // trigger 1
    tick(60);
    tapShift();
    tick(60);
    tapShift(); // trigger 2

    expect(fired).toHaveBeenCalledTimes(2);
  });

  it("closes the panel when the taps come from inside it", () => {
    const fired = vi.fn();
    install(fired);
    const host = addPanel();

    keydown("Shift", {}, host);
    keyup("Shift", {}, host);
    tick(60);
    keydown("Shift", {}, host);

    // The panel is open and the gesture came from inside it: close.
    expect(fired).toHaveBeenCalledWith(true);
  });

  it("also closes when the taps are retargeted from a shadow root inside the panel", () => {
    const fired = vi.fn();
    install(fired);
    const host = addPanel();
    const inner = document.createElement("input");
    host.attachShadow({ mode: "open" }).appendChild(inner);

    // composedPath() includes the host for anything inside its shadow tree.
    keydown("Shift", {}, inner);
    keyup("Shift", {}, inner);
    tick(60);
    keydown("Shift", {}, inner);

    expect(fired).toHaveBeenCalledWith(true);
  });

  it("reports the panel as open, so the caller can toggle it shut", () => {
    const fired = vi.fn();
    install(fired);
    addPanel();

    // Focus is on the page, not in the panel: this is the toggle case.
    tapShift();
    tick(60);
    keydown("Shift");

    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith(true);
  });

  it("stops listening once uninstalled", () => {
    const fired = vi.fn();
    const stop = install(fired);
    stop();

    tapShift();
    tick(60);
    tapShift();

    expect(fired).not.toHaveBeenCalled();
  });
});

describe("doubleShiftSwitch", () => {
  it("installs nothing while the setting is off", () => {
    const fired = vi.fn();
    const spy = vi.spyOn(window, "addEventListener");
    const apply = doubleShiftSwitch({ onTrigger: fired, now });

    apply(false);

    expect(spy).not.toHaveBeenCalled();
    tapShift();
    tick(60);
    tapShift();
    expect(fired).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("installs when the setting is on and removes it when turned back off", () => {
    const fired = vi.fn();
    const apply = doubleShiftSwitch({ onTrigger: fired, now });
    uninstallers.push(() => apply(false));

    apply(true);
    tapShift();
    tick(60);
    tapShift();
    expect(fired).toHaveBeenCalledTimes(1);

    apply(false);
    tick(1000);
    tapShift();
    tick(60);
    tapShift();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("does not install twice when the same value is applied again", () => {
    const fired = vi.fn();
    const apply = doubleShiftSwitch({ onTrigger: fired, now });
    uninstallers.push(() => apply(false));

    apply(true);
    apply(true);

    tapShift();
    tick(60);
    tapShift();

    expect(fired).toHaveBeenCalledTimes(1);
  });
});
