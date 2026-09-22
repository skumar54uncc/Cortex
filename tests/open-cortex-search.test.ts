import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  openSearchSidePanelReliable: vi.fn().mockResolvedValue(undefined),
  enableSidePanelForRestrictedTab: vi.fn(),
}));

vi.mock("../src/lib/side-panel-launcher", () => ({
  openSearchSidePanelReliable: mocks.openSearchSidePanelReliable,
  enableSidePanelForRestrictedTab: mocks.enableSidePanelForRestrictedTab,
}));

import {
  openCortexSearchForTab,
  panelModeForTab,
} from "../src/lib/open-cortex-search";

describe("openCortexSearchForTab", () => {
  beforeEach(() => {
    mocks.openSearchSidePanelReliable.mockClear();
    mocks.enableSidePanelForRestrictedTab.mockClear();
  });

  it("uses side panel on chrome:// without content-script inject", async () => {
    const openSearchOnTab = vi.fn();

    await openCortexSearchForTab(
      {
        id: 3,
        windowId: 1,
        url: "chrome://extensions",
      } as chrome.tabs.Tab,
      openSearchOnTab
    );

    expect(openSearchOnTab).not.toHaveBeenCalled();
    expect(mocks.openSearchSidePanelReliable).toHaveBeenCalledWith(
      1,
      3,
      "chrome://extensions"
    );
  });

  it("uses in-page overlay only on https pages", async () => {
    const openSearchOnTab = vi.fn().mockResolvedValue(true);

    await openCortexSearchForTab(
      {
        id: 5,
        windowId: 2,
        url: "https://example.com",
      } as chrome.tabs.Tab,
      openSearchOnTab
    );

    expect(openSearchOnTab).toHaveBeenCalledWith(5);
    expect(mocks.openSearchSidePanelReliable).not.toHaveBeenCalled();
  });

  it("does not open side panel when https inject fails", async () => {
    const openSearchOnTab = vi.fn().mockResolvedValue(false);

    await openCortexSearchForTab(
      {
        id: 5,
        windowId: 2,
        url: "https://example.com",
      } as chrome.tabs.Tab,
      openSearchOnTab
    );

    expect(openSearchOnTab).toHaveBeenCalledWith(5);
    expect(mocks.openSearchSidePanelReliable).not.toHaveBeenCalled();
  });

  it("uses the side panel on a host that fights for the keyboard", async () => {
    const openSearchOnTab = vi.fn().mockResolvedValue(true);

    await openCortexSearchForTab(
      {
        id: 7,
        windowId: 4,
        url: "https://claude.ai/chat/abc",
      } as chrome.tabs.Tab,
      openSearchOnTab
    );

    expect(openSearchOnTab).not.toHaveBeenCalled();
    expect(mocks.openSearchSidePanelReliable).toHaveBeenCalledWith(
      4,
      7,
      "https://claude.ai/chat/abc"
    );
  });

  it("keeps the overlay on a host that only looks like claude.ai", async () => {
    const openSearchOnTab = vi.fn().mockResolvedValue(true);

    await openCortexSearchForTab(
      {
        id: 8,
        windowId: 4,
        url: "https://notclaude.ai.example/chat",
      } as chrome.tabs.Tab,
      openSearchOnTab
    );

    expect(openSearchOnTab).toHaveBeenCalledWith(8);
    expect(mocks.openSearchSidePanelReliable).not.toHaveBeenCalled();
  });

  it("honours the always-side-panel preference on an ordinary page", async () => {
    const openSearchOnTab = vi.fn().mockResolvedValue(true);

    await openCortexSearchForTab(
      {
        id: 9,
        windowId: 4,
        url: "https://example.com",
      } as chrome.tabs.Tab,
      openSearchOnTab,
      { userPreference: "always-side-panel" }
    );

    expect(openSearchOnTab).not.toHaveBeenCalled();
    expect(mocks.openSearchSidePanelReliable).toHaveBeenCalledWith(
      4,
      9,
      "https://example.com"
    );
  });

  it("honours the always-overlay preference on a listed host", async () => {
    const openSearchOnTab = vi.fn().mockResolvedValue(true);

    await openCortexSearchForTab(
      {
        id: 10,
        windowId: 4,
        url: "https://claude.ai/chat/abc",
      } as chrome.tabs.Tab,
      openSearchOnTab,
      { userPreference: "always-overlay" }
    );

    expect(openSearchOnTab).toHaveBeenCalledWith(10);
    expect(mocks.openSearchSidePanelReliable).not.toHaveBeenCalled();
  });

  it("ignores a missing windowId, as before", async () => {
    const openSearchOnTab = vi.fn();

    await openCortexSearchForTab(
      { id: 11, url: "https://claude.ai/" } as chrome.tabs.Tab,
      openSearchOnTab
    );

    expect(openSearchOnTab).not.toHaveBeenCalled();
    expect(mocks.openSearchSidePanelReliable).not.toHaveBeenCalled();
  });

  it("docks the overlay on YouTube when the caller has no user gesture", async () => {
    const openSearchOnTab = vi.fn().mockResolvedValue(true);

    await openCortexSearchForTab(
      {
        id: 12,
        windowId: 4,
        url: "https://www.youtube.com/watch?v=abc",
      } as chrome.tabs.Tab,
      openSearchOnTab,
      { userGesture: false }
    );

    expect(openSearchOnTab).toHaveBeenCalledWith(12, { docked: true });
    expect(mocks.openSearchSidePanelReliable).not.toHaveBeenCalled();
  });

  it("still opens the real side panel on YouTube when a gesture is present", async () => {
    const openSearchOnTab = vi.fn().mockResolvedValue(true);

    await openCortexSearchForTab(
      {
        id: 13,
        windowId: 4,
        url: "https://www.youtube.com/watch?v=abc",
      } as chrome.tabs.Tab,
      openSearchOnTab,
      { userGesture: true }
    );

    expect(openSearchOnTab).not.toHaveBeenCalled();
    expect(mocks.openSearchSidePanelReliable).toHaveBeenCalledWith(
      4,
      13,
      "https://www.youtube.com/watch?v=abc"
    );
  });

  it("docks when the user pinned the side panel, but there is no gesture", async () => {
    const openSearchOnTab = vi.fn().mockResolvedValue(true);

    await openCortexSearchForTab(
      {
        id: 14,
        windowId: 4,
        url: "https://example.com",
      } as chrome.tabs.Tab,
      openSearchOnTab,
      { userPreference: "always-side-panel", userGesture: false }
    );

    expect(openSearchOnTab).toHaveBeenCalledWith(14, { docked: true });
    expect(mocks.openSearchSidePanelReliable).not.toHaveBeenCalled();
  });

  it("keeps the centred overlay on YouTube when the owner pinned always-overlay", async () => {
    const openSearchOnTab = vi.fn().mockResolvedValue(true);

    await openCortexSearchForTab(
      {
        id: 15,
        windowId: 4,
        url: "https://www.youtube.com/watch?v=abc",
      } as chrome.tabs.Tab,
      openSearchOnTab,
      { userPreference: "always-overlay", userGesture: false }
    );

    expect(openSearchOnTab).toHaveBeenCalledWith(15);
    expect(mocks.openSearchSidePanelReliable).not.toHaveBeenCalled();
  });

  it("cannot dock on chrome:// even without a gesture", async () => {
    const openSearchOnTab = vi.fn();

    await openCortexSearchForTab(
      {
        id: 16,
        windowId: 1,
        url: "chrome://extensions",
      } as chrome.tabs.Tab,
      openSearchOnTab,
      { userGesture: false }
    );

    expect(openSearchOnTab).not.toHaveBeenCalled();
    expect(mocks.openSearchSidePanelReliable).toHaveBeenCalledWith(
      1,
      16,
      "chrome://extensions"
    );
  });

  it("falls back to the side panel when the tab has no id", async () => {
    const openSearchOnTab = vi.fn();

    await openCortexSearchForTab(
      { windowId: 6, url: "https://example.com" } as chrome.tabs.Tab,
      openSearchOnTab
    );

    expect(openSearchOnTab).not.toHaveBeenCalled();
    expect(mocks.openSearchSidePanelReliable).toHaveBeenCalledWith(
      6,
      undefined,
      "https://example.com"
    );
  });
});

describe("panelModeForTab", () => {
  it("reports the surface and the reason without opening anything", () => {
    mocks.openSearchSidePanelReliable.mockClear();
    expect(
      panelModeForTab({ id: 1, windowId: 1, url: "https://claude.ai/" } as chrome.tabs.Tab)
    ).toMatchObject({ mode: "side-panel", reason: "keyboard-capturing-host" });
    expect(
      panelModeForTab({ id: 1, windowId: 1, url: "https://example.com" } as chrome.tabs.Tab)
    ).toMatchObject({ mode: "overlay", reason: "default" });
    expect(
      panelModeForTab({ id: 1, windowId: 1 } as chrome.tabs.Tab)
    ).toMatchObject({ mode: "side-panel", reason: "not-injectable" });
    expect(mocks.openSearchSidePanelReliable).not.toHaveBeenCalled();
  });
});
