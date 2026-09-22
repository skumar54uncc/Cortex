import { describe, it, expect } from "vitest";
import { siteInitial, siteBadgeColors } from "../src/lib/site-badge";

/**
 * Search hits and the digest used to show favicons fetched from Google, which
 * told a third party every domain the user had read. The badge is drawn on
 * the device instead: nothing about the page leaves the machine.
 */
describe("siteInitial", () => {
  it("uses the first letter of the site, not of the www prefix", () => {
    expect(siteInitial("github.com")).toBe("G");
    expect(siteInitial("www.linkedin.com")).toBe("L");
    expect(siteInitial("m.youtube.com")).toBe("Y");
    expect(siteInitial("news.ycombinator.com")).toBe("N");
  });

  it("copes with a host that has no letters at all", () => {
    expect(siteInitial("127.0.0.1")).toBe("1");
    expect(siteInitial("")).toBe("?");
    expect(siteInitial("   ")).toBe("?");
  });
});

describe("siteBadgeColors", () => {
  it("gives one site the same colour every time", () => {
    expect(siteBadgeColors("github.com")).toEqual(siteBadgeColors("github.com"));
    expect(siteBadgeColors("www.github.com")).toEqual(siteBadgeColors("github.com"));
  });

  it("separates sites that sit next to each other in a list", () => {
    const a = siteBadgeColors("github.com");
    const b = siteBadgeColors("linkedin.com");
    expect(a.background).not.toBe(b.background);
  });

  it("returns colours a stylesheet can use as they are", () => {
    const { background, text } = siteBadgeColors("example.com");
    expect(background).toMatch(/^hsl\(/);
    expect(text).toMatch(/^hsl\(/);
  });
});
