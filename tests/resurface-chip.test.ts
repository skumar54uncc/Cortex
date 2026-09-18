// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountResurfaceChip, RESURFACE_CHIP_HOST_ID } from "../src/content/resurface-chip-view";

describe("resurface chip", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("renders the related page title as text with an http(s) link and a labelled dismiss button", () => {
    const { shadow } = mountResurfaceChip(document, { title: "Old <img src=x onerror=alert(1)> notes", url: "https://b.test/old" });
    expect(document.getElementById(RESURFACE_CHIP_HOST_ID)).not.toBeNull();
    expect(shadow.querySelector("img")).toBeNull();
    const link = shadow.querySelector<HTMLAnchorElement>("a")!;
    expect(link.textContent).toBe("Old <img src=x onerror=alert(1)> notes");
    expect(link.href).toBe("https://b.test/old");
    expect(link.rel).toContain("noopener");
    expect(shadow.querySelector('[role="status"]')?.textContent).toContain("You read something similar");
    expect(shadow.querySelector("button")?.getAttribute("aria-label")).toBe("Dismiss");
  });

  it("dismiss removes it; it also hides by itself after 12 seconds", () => {
    const { shadow } = mountResurfaceChip(document, { title: "T", url: "https://b.test/" });
    shadow.querySelector("button")!.click();
    expect(document.getElementById(RESURFACE_CHIP_HOST_ID)).toBeNull();

    mountResurfaceChip(document, { title: "T2", url: "https://b.test/" });
    vi.advanceTimersByTime(11_999);
    expect(document.getElementById(RESURFACE_CHIP_HOST_ID)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.getElementById(RESURFACE_CHIP_HOST_ID)).toBeNull();
  });

  it("the shadow root is closed: the page cannot read it", () => {
    mountResurfaceChip(document, { title: "Private title", url: "https://b.test/" });
    expect(document.getElementById(RESURFACE_CHIP_HOST_ID)!.shadowRoot).toBeNull();
  });

  it("refuses non-http links and never stacks two chips", () => {
    expect(mountResurfaceChip(document, { title: "T", url: "javascript:alert(1)" }).mounted).toBe(false);
    mountResurfaceChip(document, { title: "A", url: "https://a.test/" });
    mountResurfaceChip(document, { title: "B", url: "https://b.test/" });
    expect(document.querySelectorAll(`#${RESURFACE_CHIP_HOST_ID}`)).toHaveLength(1);
  });
});
