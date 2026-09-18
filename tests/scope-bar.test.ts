// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createScopeBar } from "../src/content/scope-bar";

const cols = [
  { id: 1, name: "Job <i>search</i>", count: 3 },
  { id: 2, name: "Reading", count: 0 },
];

describe("scope bar", () => {
  it("offers All pages plus each collection, rendered as text", async () => {
    const onChange = vi.fn();
    const bar = createScopeBar({ list: async () => cols, addPage: vi.fn(), onChange, showAddPage: true, announce: vi.fn() });
    await bar.refresh();
    const select = bar.root.querySelector("select")!;
    expect(select.getAttribute("aria-label")).toBe("Search in");
    expect([...select.options].map((o) => o.textContent)).toEqual(["All pages", "Job <i>search</i> (3)", "Reading (0)"]);
    expect(bar.root.querySelector("i")).toBeNull();
  });

  it("reports the chosen collection and back to All pages", async () => {
    const onChange = vi.fn();
    const bar = createScopeBar({ list: async () => cols, addPage: vi.fn(), onChange, showAddPage: true, announce: vi.fn() });
    await bar.refresh();
    const select = bar.root.querySelector("select")!;
    select.value = "2";
    select.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(bar.value()).toBe(2);
    select.value = "";
    select.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("adds the current page to the chosen collection and announces the result", async () => {
    const addPage = vi.fn(async () => ({ ok: true }));
    const announce = vi.fn();
    const bar = createScopeBar({ list: async () => cols, addPage, onChange: vi.fn(), showAddPage: true, announce });
    await bar.refresh();
    const select = bar.root.querySelector("select")!;
    select.value = "1";
    select.dispatchEvent(new Event("change"));
    bar.root.querySelector<HTMLButtonElement>(".cortex-scope-add")!.click();
    await vi.waitFor(() => expect(addPage).toHaveBeenCalledWith(1));
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith("Added this page to Job <i>search</i>."));
  });

  it("the add button is disabled for All pages and hidden in the side panel", async () => {
    const bar = createScopeBar({ list: async () => cols, addPage: vi.fn(), onChange: vi.fn(), showAddPage: true, announce: vi.fn() });
    await bar.refresh();
    expect(bar.root.querySelector<HTMLButtonElement>(".cortex-scope-add")!.disabled).toBe(true);
    const shell = createScopeBar({ list: async () => cols, addPage: vi.fn(), onChange: vi.fn(), showAddPage: false, announce: vi.fn() });
    await shell.refresh();
    expect(shell.root.querySelector(".cortex-scope-add")).toBeNull();
  });

  it("renders nothing when there are no collections", async () => {
    const bar = createScopeBar({ list: async () => [], addPage: vi.fn(), onChange: vi.fn(), showAddPage: true, announce: vi.fn() });
    await bar.refresh();
    expect(bar.root.hidden).toBe(true);
  });
});
