import { describe, it, expect, beforeEach } from "vitest";
import {
  getActiveTabSnapshot,
  setActiveTabSnapshot,
} from "../src/lib/active-tab-cache";

describe("active-tab-cache", () => {
  beforeEach(() => {
    setActiveTabSnapshot({} as chrome.tabs.Tab);
  });

  it("stores tab id, window id, and url for sync command reads", () => {
    setActiveTabSnapshot({
      id: 42,
      windowId: 7,
      url: "chrome://extensions",
    } as chrome.tabs.Tab);
    expect(getActiveTabSnapshot()).toEqual({
      tabId: 42,
      windowId: 7,
      url: "chrome://extensions",
    });
  });
});
