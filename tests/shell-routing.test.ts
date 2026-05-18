import { describe, expect, it } from "vitest";
import {
  CORTEX_SHELL_TAB_ID,
  isExtensionShellSender,
  resolveOverlayTabId,
} from "../src/shared/shell-routing";

describe("shell-routing", () => {
  it("detects search-shell senders", () => {
    expect(
      isExtensionShellSender({
        url: "chrome-extension://abc/search-shell.html",
      } as chrome.runtime.MessageSender)
    ).toBe(true);
    expect(
      isExtensionShellSender({
        url: "https://example.com/",
        tab: { id: 1 },
      } as chrome.runtime.MessageSender)
    ).toBe(false);
  });

  it("uses shell tab id when there is no content-script tab", () => {
    expect(
      resolveOverlayTabId({
        url: "chrome-extension://abc/search-shell.html",
      } as chrome.runtime.MessageSender)
    ).toBe(CORTEX_SHELL_TAB_ID);
    expect(
      resolveOverlayTabId({
        tab: { id: 42 },
      } as chrome.runtime.MessageSender)
    ).toBe(42);
  });
});
