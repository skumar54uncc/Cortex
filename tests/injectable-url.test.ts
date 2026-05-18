import { describe, it, expect } from "vitest";
import { isInjectableWebUrl } from "../src/lib/injectable-url";

describe("isInjectableWebUrl", () => {
  it("allows http(s) pages", () => {
    expect(isInjectableWebUrl("https://example.com/path")).toBe(true);
    expect(isInjectableWebUrl("http://localhost:3000")).toBe(true);
  });

  it("blocks browser-internal and file URLs", () => {
    expect(isInjectableWebUrl("chrome://extensions")).toBe(false);
    expect(isInjectableWebUrl("chrome-extension://abc/popup.html")).toBe(
      false
    );
    expect(isInjectableWebUrl("file:///C:/page.pdf")).toBe(false);
    expect(isInjectableWebUrl("about:blank")).toBe(false);
  });
});
