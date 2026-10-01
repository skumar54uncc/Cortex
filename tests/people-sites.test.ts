// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { canonicalProfileUrl, parseProfilePage } from "../src/lib/capture/people-sites";

function page(html: string, url: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return parseProfilePage(doc, url);
}

describe("canonicalProfileUrl", () => {
  it("accepts a profile address and rejects the rest of the site", () => {
    expect(canonicalProfileUrl("https://github.com/torvalds")).toBe("https://github.com/torvalds");
    expect(canonicalProfileUrl("https://github.com/torvalds/linux")).toBeNull();
    expect(canonicalProfileUrl("https://github.com/settings")).toBeNull();
    expect(canonicalProfileUrl("https://x.com/jack")).toBe("https://x.com/jack");
    expect(canonicalProfileUrl("https://twitter.com/jack/status/1")).toBeNull();
    expect(canonicalProfileUrl("https://scholar.google.com/citations?user=JicYPdAAAAAJ&hl=en")).toBe(
      "https://scholar.google.com/citations?user=JicYPdAAAAAJ"
    );
    expect(canonicalProfileUrl("https://scholar.google.com/scholar?q=tides")).toBeNull();
    expect(canonicalProfileUrl("https://orcid.org/0000-0002-1825-0097")).toBe("https://orcid.org/0000-0002-1825-0097");
    expect(canonicalProfileUrl("https://www.crunchbase.com/person/satya-nadella")).toBe(
      "https://www.crunchbase.com/person/satya-nadella"
    );
    expect(canonicalProfileUrl("https://www.crunchbase.com/organization/microsoft")).toBeNull();
    expect(canonicalProfileUrl("https://angel.co/u/naval")).toBe("https://wellfound.com/u/naval");
    expect(canonicalProfileUrl("https://theorg.com/org/microsoft/org-chart/satya-nadella")).toBe(
      "https://theorg.com/org/microsoft/org-chart/satya-nadella"
    );
    expect(canonicalProfileUrl("https://www.researchgate.net/profile/Jane-Doe")).toBe(
      "https://www.researchgate.net/profile/Jane-Doe"
    );
    expect(canonicalProfileUrl("https://www.linkedin.com/in/mira/")).toBeNull();
  });
});

describe("parseProfilePage", () => {
  it("reads a GitHub user and skips an organization", () => {
    const user = page(
      `<span class="p-name">Linus Torvalds</span><div class="p-note">Creator of Linux.</div><span class="p-org">Linux Foundation</span><span itemprop="homeLocation">Portland</span><img class="avatar avatar-user" src="https://avatars.githubusercontent.com/u/1024025?v=4" alt="">`,
      "https://github.com/torvalds"
    );
    expect(user).toMatchObject({
      kind: "person",
      name: "Linus Torvalds",
      company: "Linux Foundation",
      location: "Portland",
      profileUrl: "https://github.com/torvalds",
    });
    expect(user?.headline).toContain("Linux");
    expect(user?.photoUrl).toContain("avatars.githubusercontent.com");
    expect(user?.photoUrl).toContain("s=460");
    const org = page(`<h1 class="orgname">Microsoft</h1>`, "https://github.com/microsoft");
    expect(org).toBeNull();
  });

  it("reads an X profile and ignores a post", () => {
    const p = page(
      `<div data-testid="UserName">Jack Dorsey @jack</div><div data-testid="UserDescription">Engineer at Block</div>`,
      "https://x.com/jack"
    );
    expect(p).toMatchObject({ name: "Jack Dorsey", company: "Block", profileUrl: "https://x.com/jack" });
    expect(parseProfilePage(new DOMParser().parseFromString("<h1>Post</h1>", "text/html"), "https://x.com/jack/status/9")).toBeNull();
  });

  it("reads a Scholar author", () => {
    const p = page(
      `<div id="gsc_prf_in">Geoffrey Hinton</div><div class="gsc_prf_il">University of Toronto</div><a class="gsc_prf_inta">Machine learning</a>`,
      "https://scholar.google.com/citations?user=JicYPdAAAAAJ"
    );
    expect(p).toMatchObject({ name: "Geoffrey Hinton", company: "University of Toronto" });
    expect(p?.headline).toContain("Machine learning");
  });

  it("reads an ORCID record", () => {
    const p = page(
      `<h1 class="full-name">Josiah Carberry</h1><div id="cy-affiliation-title">Brown University</div><div class="employment-title">Professor</div>`,
      "https://orcid.org/0000-0002-1825-0097"
    );
    expect(p).toMatchObject({ name: "Josiah Carberry", company: "Brown University", roleTitle: "Professor" });
  });

  it("reads a Crunchbase person", () => {
    const p = page(
      `<h1>Satya Nadella</h1><div class="entity-description">CEO @ Microsoft</div>`,
      "https://www.crunchbase.com/person/Satya-Nadella"
    );
    expect(p).toMatchObject({
      name: "Satya Nadella",
      company: "Microsoft",
      roleTitle: "CEO",
      profileUrl: "https://www.crunchbase.com/person/satya-nadella",
    });
  });

  it("reads a Wellfound profile", () => {
    const p = page(`<h1>Naval Ravikant</h1><div class="headline">Founder at AngelList</div>`, "https://wellfound.com/u/naval");
    expect(p).toMatchObject({ name: "Naval Ravikant", company: "AngelList", roleTitle: "Founder" });
  });

  it("reads a person on The Org", () => {
    const p = page(
      `<h1>Satya Nadella</h1><p class="role">Chairman and CEO</p>`,
      "https://theorg.com/org/microsoft/org-chart/satya-nadella"
    );
    expect(p).toMatchObject({ name: "Satya Nadella", company: "Microsoft", roleTitle: "Chairman and CEO" });
    expect(p?.headline).toContain("Microsoft");
  });

  it("reads a ResearchGate profile", () => {
    const p = page(
      `<h1>Jane Doe</h1><div class="institution">UNC Charlotte</div><div itemprop="jobTitle">Professor</div>`,
      "https://www.researchgate.net/profile/Jane-Doe"
    );
    expect(p).toMatchObject({ name: "Jane Doe", company: "UNC Charlotte", roleTitle: "Professor" });
  });
});
