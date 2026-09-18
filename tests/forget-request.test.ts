import { describe, it, expect } from "vitest";
import { resolveForgetRequest } from "../src/lib/forget-request";

const EXT = "chrome-extension://abc/";
const options = { url: `${EXT}options.html`, id: "abc" } as chrome.runtime.MessageSender;
const shell = { url: `${EXT}search-shell.html`, id: "abc" } as chrome.runtime.MessageSender;
const tab = (url: string, incognito = false) =>
  ({ id: "abc", url, tab: { id: 3, url, incognito } }) as unknown as chrome.runtime.MessageSender;

describe("resolveForgetRequest", () => {
  it("overlay on a page: 'site' uses the sender tab's host and ignores any hostname in the payload", () => {
    const r = resolveForgetRequest(
      { scope: "site", hostname: "victim.example" },
      tab("https://news.example.org/story?x=1"),
      EXT
    );
    expect(r).toEqual({ ok: true, scope: "site", site: "news.example.org" });
  });

  it("options page: 'site' takes the hostname from the payload (normalized)", () => {
    const r = resolveForgetRequest({ scope: "site", hostname: "https://www.Example.com/path" }, options, EXT);
    expect(r).toEqual({ ok: true, scope: "site", site: "example.com" });
  });

  it("side panel: 'site' is rejected (no page), time scopes are allowed", () => {
    expect(resolveForgetRequest({ scope: "site", hostname: "a.com" }, shell, EXT).ok).toBe(false);
    expect(resolveForgetRequest({ scope: "hour" }, shell, EXT)).toEqual({ ok: true, scope: "hour" });
  });

  it("hour, day and all are allowed from the overlay, the side panel and options", () => {
    for (const s of [tab("https://a.test/"), shell, options]) {
      expect(resolveForgetRequest({ scope: "day" }, s, EXT).ok).toBe(true);
      expect(resolveForgetRequest({ scope: "all" }, s, EXT).ok).toBe(true);
    }
  });

  it("rejects unknown scopes, foreign extensions, invalid hostnames, and non-http tabs", () => {
    expect(resolveForgetRequest({ scope: "everything" }, options, EXT).ok).toBe(false);
    expect(
      resolveForgetRequest({ scope: "all" }, { url: "chrome-extension://other/x.html", id: "other" } as chrome.runtime.MessageSender, EXT).ok
    ).toBe(false);
    expect(resolveForgetRequest({ scope: "site", hostname: "not a host" }, options, EXT).ok).toBe(false);
    expect(resolveForgetRequest({ scope: "site" }, tab("chrome://newtab/"), EXT).ok).toBe(false);
  });
});
