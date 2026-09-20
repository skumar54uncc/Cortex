// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { installKeyShield } from "../src/content/key-shield";

/**
 * YouTube plays or pauses on Space and cancels the key, which used to stop
 * Space reaching the Cortex question box. A content script cannot prevent the
 * page's handlers from running (isolated world), so the panel puts the
 * cancelled character back. Real-browser coverage: e2e/keys.spec.ts.
 */
/** Page listeners live only for the test that added them. */
let pageScripts: AbortController;

function build(cancelWhere: "capture" | "bubble" | "none") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  const input = document.createElement("textarea");
  root.appendChild(input);
  if (cancelWhere !== "none") {
    document.addEventListener("keydown", (e) => e.preventDefault(), {
      capture: cancelWhere === "capture",
      signal: pageScripts.signal,
    });
  }
  return { host, input };
}

function press(el: Element, key: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...opts });
  el.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  document.body.innerHTML = "";
  pageScripts = new AbortController();
});

afterEach(() => pageScripts.abort());

describe("installKeyShield", () => {
  for (const where of ["capture", "bubble"] as const) {
    it(`types the character when the page cancels the key in the ${where} phase`, () => {
      const { host, input } = build(where);
      installKeyShield(host);
      input.value = "ab";
      input.setSelectionRange(2, 2);
      const seen: string[] = [];
      input.addEventListener("input", () => seen.push(input.value));

      press(input, " ");
      press(input, "c");

      expect(input.value).toBe("ab c");
      expect(seen).toEqual(["ab ", "ab c"]);
    });
  }

  it("replaces the selection, like typing does", () => {
    const { host, input } = build("bubble");
    installKeyShield(host);
    input.value = "aurora drift";
    input.setSelectionRange(0, 6);
    press(input, "x");
    expect(input.value).toBe("x drift");
  });

  it("does nothing when the page leaves the key alone, so the character is not typed twice", () => {
    const { host, input } = build("none");
    installKeyShield(host);
    input.value = "ab";
    input.setSelectionRange(2, 2);
    press(input, "c");
    expect(input.value).toBe("ab");
  });

  it("ignores shortcuts, control keys, keys outside the panel, and non-editable targets", () => {
    const { host, input } = build("bubble");
    installKeyShield(host);
    input.value = "";

    press(input, "v", { ctrlKey: true });
    press(input, "a", { metaKey: true });
    for (const key of ["Escape", "Enter", "Tab", "ArrowDown", "Backspace"]) press(input, key);
    expect(input.value).toBe("");

    const outside = document.createElement("input");
    document.body.appendChild(outside);
    press(outside, "z");
    expect(outside.value).toBe("");

    const div = document.createElement("div");
    host.shadowRoot!.appendChild(div);
    expect(() => press(div, "z")).not.toThrow();
  });

  it("uninstalls cleanly", () => {
    const { host, input } = build("bubble");
    const uninstall = installKeyShield(host);
    uninstall();
    input.value = "ab";
    input.setSelectionRange(2, 2);
    press(input, "c");
    expect(input.value).toBe("ab");
  });

  it("works with a closed shadow root, where the event is retargeted to the host", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const closed = host.attachShadow({ mode: "closed" });
    const input = document.createElement("input");
    closed.appendChild(input);
    installKeyShield(host);
    input.value = "ab";
    input.setSelectionRange(2, 2);
    // jsdom neither retargets nor propagates out of a closed root, so dispatch
    // the event the way a browser reports it to a window listener.
    const ev = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true, composed: true });
    ev.preventDefault();
    Object.defineProperty(ev, "composedPath", { value: () => [input, host, document.body, document, window] });
    window.dispatchEvent(ev);
    expect(input.value).toBe("ab ");
  });
});
