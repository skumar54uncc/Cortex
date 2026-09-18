// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createForgetMenu } from "../src/content/forget-menu";

function setup(opts: { shell?: boolean; send?: (m: unknown) => Promise<unknown> } = {}) {
  const send = vi.fn(opts.send ?? (async () => ({ ok: true, counts: { documents: 3 } })));
  const onDone = vi.fn();
  const menu = createForgetMenu({ shell: Boolean(opts.shell), send, onDone });
  document.body.appendChild(menu.root);
  const btn = menu.root.querySelector<HTMLButtonElement>(".cortex-menu-btn")!;
  const list = menu.root.querySelector<HTMLElement>('[role="menu"]')!;
  const items = () => [...list.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  return { menu, btn, list, items, send, onDone };
}

describe("overlay forget menu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("is a menu button with aria-haspopup, closed by default", () => {
    const { btn, list } = setup();
    expect(btn.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-label")).toBe("Forget options");
    expect(list.hidden).toBe(true);
  });

  it("opens on click, lists the four actions, focuses the first item", () => {
    const { btn, list, items } = setup();
    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
    expect(items().map((i) => i.textContent)).toEqual([
      "Forget this site",
      "Forget last hour",
      "Forget last day",
      "Forget all",
    ]);
    expect(document.activeElement).toBe(items()[0]);
  });

  it("side panel shell has no 'Forget this site'", () => {
    const { btn, items } = setup({ shell: true });
    btn.click();
    expect(items().map((i) => i.textContent)).toEqual(["Forget last hour", "Forget last day", "Forget all"]);
  });

  it("arrow keys move between items and Escape closes and returns focus to the button", () => {
    const { btn, list, items } = setup();
    btn.click();
    items()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(items()[1]);
    items()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(items()[0]);
    items()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(items()[3]);
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    items()[3].dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(btn);
  });

  it("time scopes send CORTEX_FORGET immediately and report the result", async () => {
    const { btn, items, send, onDone } = setup();
    btn.click();
    items()[1].click();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith({ type: "CORTEX_FORGET", scope: "hour" });
    expect(onDone.mock.calls[0][0]).toMatch(/Forgot the last hour/);
  });

  it("'Forget this site' sends scope site without a hostname (the service worker uses the tab)", async () => {
    const { btn, items, send } = setup();
    btn.click();
    items()[0].click();
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith({ type: "CORTEX_FORGET", scope: "site" });
  });

  it("'Forget all' needs a second, confirming click", async () => {
    const { btn, items, send } = setup();
    btn.click();
    const all = items()[3];
    all.click();
    expect(send).not.toHaveBeenCalled();
    expect(all.textContent).toBe("Click again to forget everything");
    all.click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "CORTEX_FORGET", scope: "all" }));
  });

  it("reports a failure message when the service worker refuses", async () => {
    const { btn, items, onDone } = setup({ send: async () => ({ ok: false, error: "not_a_web_page" }) });
    btn.click();
    items()[0].click();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0][0]).toMatch(/Could not forget/);
  });
});
