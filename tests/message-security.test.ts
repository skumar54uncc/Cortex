import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  indexPayloadUrlMatchesTab,
  isOptionsPageSender,
  isPrivilegedExtensionSender,
} from "../src/lib/message-security";
import { isHistoryFetchAllowedUrl } from "../src/lib/history-fetch-security";

describe("isPrivilegedExtensionSender", () => {
  const prev = globalThis.chrome;

  beforeEach(() => {
    globalThis.chrome = {
      runtime: { id: "ext-test-id" },
    } as typeof chrome;
  });

  afterEach(() => {
    globalThis.chrome = prev;
  });

  it("accepts service worker style senders", () => {
    expect(
      isPrivilegedExtensionSender({
        id: "ext-test-id",
        tab: undefined,
      } as chrome.runtime.MessageSender)
    ).toBe(true);
  });

  it("rejects content script senders", () => {
    expect(
      isPrivilegedExtensionSender({
        id: "ext-test-id",
        tab: { id: 1 } as chrome.tabs.Tab,
        url: "https://evil.example/",
      } as chrome.runtime.MessageSender)
    ).toBe(false);
  });
});

describe("indexPayloadUrlMatchesTab", () => {
  it("requires normalized href match", () => {
    const sender = {
      tab: { url: "https://example.com/page#section" },
    } as chrome.runtime.MessageSender;
    expect(
      indexPayloadUrlMatchesTab("https://example.com/page", sender)
    ).toBe(true);
    expect(
      indexPayloadUrlMatchesTab("https://other.com/page", sender)
    ).toBe(false);
  });
});

describe("isHistoryFetchAllowedUrl", () => {
  it("allows public https origins", () => {
    expect(isHistoryFetchAllowedUrl("https://example.com/article")).toBe(true);
  });

  it("blocks loopback and RFC1918", () => {
    expect(isHistoryFetchAllowedUrl("http://127.0.0.1/")).toBe(false);
    expect(isHistoryFetchAllowedUrl("http://192.168.0.1/")).toBe(false);
    expect(isHistoryFetchAllowedUrl("http://localhost/")).toBe(false);
    expect(isHistoryFetchAllowedUrl("http://10.0.0.5/")).toBe(false);
  });

  it("blocks extension-origin CORS targets", () => {
    expect(
      isHistoryFetchAllowedUrl(
        "https://chromewebstore.google.com/category/extensions"
      )
    ).toBe(false);
    expect(
      isHistoryFetchAllowedUrl("https://chrome.google.com/webstore/detail/foo")
    ).toBe(false);
  });
});

describe("isOptionsPageSender", () => {
  it("matches options.html URLs", () => {
    const base = "chrome-extension://deadbeef/";
    const prev = globalThis.chrome;
    globalThis.chrome = {
      runtime: { getURL: (p: string) => `${base}${p}` },
    } as typeof chrome;

    expect(
      isOptionsPageSender({
        url: `${base}options.html`,
      } as chrome.runtime.MessageSender)
    ).toBe(true);
    expect(
      isOptionsPageSender({
        url: "https://evil.example/",
      } as chrome.runtime.MessageSender)
    ).toBe(false);

    globalThis.chrome = prev;
  });
});
