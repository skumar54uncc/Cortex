import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  openSearchSidePanelReliable: vi.fn().mockResolvedValue(undefined),
  enableSidePanelForRestrictedTab: vi.fn(),
}));

vi.mock("../src/lib/side-panel-launcher", () => ({
  openSearchSidePanelReliable: mocks.openSearchSidePanelReliable,
  enableSidePanelForRestrictedTab: mocks.enableSidePanelForRestrictedTab,
}));

import { openCortexSearchForTab } from "../src/lib/open-cortex-search";

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
});
