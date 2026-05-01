import { describe, it, expect } from "vitest";
import { safeHttpHttpsHref } from "./url-security";

describe("safeHttpHttpsHref", () => {
  it("accepts valid http and https URLs", () => {
    expect(safeHttpHttpsHref("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1"
    );
    expect(safeHttpHttpsHref("http://localhost:8080/")).toBe(
      "http://localhost:8080/"
    );
  });

  it("accepts IPs and normalizes trailing whitespace", () => {
    expect(safeHttpHttpsHref("  https://192.168.1.1/x  ")).toBe(
      "https://192.168.1.1/x"
    );
  });

  it("accepts unicode hostnames (IDN) when URL parses", () => {
    const u = safeHttpHttpsHref("https://xn--n3h.net/");
    expect(u).toBeTruthy();
    expect(u!.startsWith("https://")).toBe(true);
  });

  it("rejects javascript:", () => {
    expect(safeHttpHttpsHref("javascript:alert(1)")).toBeNull();
    expect(safeHttpHttpsHref("JavaScript:alert(1)")).toBeNull();
  });

  it("rejects data:", () => {
    expect(safeHttpHttpsHref("data:text/html,<svg/onload=alert(1)>")).toBeNull();
  });

  it("rejects chrome-extension and file", () => {
    expect(safeHttpHttpsHref("chrome-extension://deadbeef/page.html")).toBeNull();
    expect(safeHttpHttpsHref("file:///etc/passwd")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(safeHttpHttpsHref("not a url")).toBeNull();
    expect(safeHttpHttpsHref("")).toBeNull();
  });

  it("rejects bare scheme without host", () => {
    expect(safeHttpHttpsHref("https://")).toBeNull();
  });
});
