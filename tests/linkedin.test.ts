// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseLinkedInPage,
  canonicalLinkedInUrl,
} from "../src/lib/capture/linkedin";

function doc(name: string): Document {
  const html = readFileSync(join(__dirname, "fixtures", "linkedin", name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

describe("canonicalLinkedInUrl", () => {
  it("normalizes profile and company URLs and rejects everything else", () => {
    expect(canonicalLinkedInUrl("https://www.linkedin.com/in/mira-okafor-lind-12ab/?miniProfileUrn=x#top")).toBe(
      "https://www.linkedin.com/in/mira-okafor-lind-12ab/"
    );
    expect(canonicalLinkedInUrl("https://linkedin.com/in/Mira/details/experience/")).toBe(
      "https://www.linkedin.com/in/mira/"
    );
    expect(canonicalLinkedInUrl("https://de.linkedin.com/company/tidora/about/")).toBe(
      "https://www.linkedin.com/company/tidora/"
    );
    expect(canonicalLinkedInUrl("https://www.linkedin.com/feed/")).toBeNull();
    expect(canonicalLinkedInUrl("https://evil.example/in/mira/")).toBeNull();
    expect(canonicalLinkedInUrl("https://linkedin.com.evil.example/in/mira/")).toBeNull();
  });
});

describe("parseLinkedInPage", () => {
  it("parses a profile: name, headline, current company, canonical URL", () => {
    const p = parseLinkedInPage(doc("profile.html"), "https://www.linkedin.com/in/mira-okafor-lind-12ab/?trk=x");
    expect(p).toEqual({
      kind: "person",
      name: "Mira Okafor-Lind",
      headline: "Head of Field Programs at Tidora · Tidal microgrids",
      company: "Tidora",
      profileUrl: "https://www.linkedin.com/in/mira-okafor-lind-12ab/",
    });
  });

  it("falls back to the headline 'at X' and then the page title when the company button is missing", () => {
    const d = doc("profile.html");
    d.querySelector('button[aria-label^="Current company"]')?.remove();
    expect(parseLinkedInPage(d, "https://www.linkedin.com/in/mira/")?.company).toBe("Tidora");
    d.querySelector("h1")?.remove();
    d.querySelector(".text-body-medium")?.remove();
    const p = parseLinkedInPage(d, "https://www.linkedin.com/in/mira/");
    expect(p?.name).toBe("Mira Okafor-Lind");
    expect(p?.headline).toBe("Head of Field Programs at Tidora");
    expect(p?.company).toBe("Tidora");
  });

  it("parses a company page", () => {
    expect(parseLinkedInPage(doc("company.html"), "https://www.linkedin.com/company/tidora/")).toEqual({
      kind: "company",
      name: "Tidora",
      headline: "Tidal energy microgrids for island communities",
      company: "Tidora",
      profileUrl: "https://www.linkedin.com/company/tidora/",
    });
  });

  it("returns null for the feed, for other hosts, and when no name can be found", () => {
    expect(parseLinkedInPage(doc("feed.html"), "https://www.linkedin.com/feed/")).toBeNull();
    expect(parseLinkedInPage(doc("profile.html"), "https://evil.example/in/mira/")).toBeNull();
    const empty = new DOMParser().parseFromString("<html><head><title>LinkedIn</title></head><body></body></html>", "text/html");
    expect(parseLinkedInPage(empty, "https://www.linkedin.com/in/x/")).toBeNull();
  });

  it("caps field lengths (page-controlled text)", () => {
    const d = doc("profile.html");
    d.querySelector("h1")!.textContent = "N".repeat(500);
    const p = parseLinkedInPage(d, "https://www.linkedin.com/in/x/");
    expect(p!.name.length).toBeLessThanOrEqual(120);
  });
});
