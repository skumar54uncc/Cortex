// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseLinkedInPage,
  canonicalLinkedInUrl,
  profilePhotoUrl,
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

describe("profilePhotoUrl", () => {
  it("keeps a LinkedIn CDN photo and drops ghosts and other hosts", () => {
    expect(
      profilePhotoUrl("https://media.licdn.com/dms/image/v2/D4E03AQH/profile-displayphoto-shrink_200_200/0/1")
    ).toContain("profile-displayphoto-shrink_200_200");
    expect(profilePhotoUrl("https://static.licdn.com/aero-v1/sc/h/ghost-person")).toBeUndefined();
    expect(profilePhotoUrl("https://evil.example/photo.jpg")).toBeUndefined();
    expect(profilePhotoUrl("http://media.licdn.com/x")).toBeUndefined();
  });

  it("reads the top-card photo onto the parsed profile", () => {
    const html = `<main><section class="pv-top-card"><h1>Mira Okafor-Lind</h1>
      <div class="text-body-medium">Head of Field Programs</div>
      <img src="https://media.licdn.com/dms/image/v2/D4E/profile-displayphoto-shrink_100_100/0/1"
        srcset="https://media.licdn.com/dms/image/v2/D4E/profile-displayphoto-shrink_100_100/0/1 100w, https://media.licdn.com/dms/image/v2/D4E/profile-displayphoto-shrink_400_400/0/1 400w" />
      </section></main>`;
    const d = new DOMParser().parseFromString(html, "text/html");
    d.title = "Mira Okafor-Lind | LinkedIn";
    const p = parseLinkedInPage(d, "https://www.linkedin.com/in/mira-okafor-lind/");
    expect(p?.photoUrl).toContain("profile-displayphoto-shrink_400_400");
  });
});

describe("parseLinkedInPage", () => {
  it("parses a profile: name, headline, current company, canonical URL", () => {
    const p = parseLinkedInPage(doc("profile.html"), "https://www.linkedin.com/in/mira-okafor-lind-12ab/?trk=x");
    expect(p).toMatchObject({
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
    expect(parseLinkedInPage(doc("company.html"), "https://www.linkedin.com/company/tidora/")).toMatchObject({
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

describe("parseLinkedInPage profile detail", () => {
  const p = parseLinkedInPage(doc("profile.html"), "https://www.linkedin.com/in/mira/")!;

  it("captures location, connection degree and connection count", () => {
    expect(p.location).toBe("Bergen, Norway");
    expect(p.connectionDegree).toBe("2nd");
    expect(p.connectionCount).toBe(842);
  });

  it("captures the about text, trimmed and capped at 600 characters", () => {
    expect(p.about).toContain("Co-founder turned operator.");
    expect(p.about).toContain("PolyWise");
    expect(p.about!.length).toBeLessThanOrEqual(600);
    expect(p.about).not.toContain("\n");
    expect(p.about).not.toMatch(/\s{2}/);
  });

  it("captures the current role title and up to five past roles", () => {
    expect(p.roleTitle).toBe("Head of Field Programs");
    expect(p.pastRoles!.length).toBeLessThanOrEqual(5);
    expect(p.pastRoles!.slice(0, 3)).toEqual([
      { title: "Grid Operations Lead", company: "Nordwind Energy" },
      { title: "Co-founder", company: "PolyWise" },
      { title: "Senior Field Engineer", company: "PolyWise" },
    ]);
    // The current role is not repeated in the past roles.
    expect(p.pastRoles!.some((r) => r.title === "Head of Field Programs")).toBe(false);
  });

  it("captures up to three education entries as school plus degree", () => {
    expect(p.education).toEqual([
      "NTNU, Master of Science, Electrical Engineering",
      "University of Bergen, Bachelor of Science, Physics",
      "Chalmers University of Technology, Exchange, Marine Engineering",
    ]);
  });

  it("summarises the profile in one or two plain sentences", () => {
    expect(p.summary).toBe(
      "Head of Field Programs at Tidora, based in Bergen, Norway. Co-founder turned operator."
    );
    expect(p.summary!.length).toBeLessThanOrEqual(200);
    expect(p.summary).not.toContain(String.fromCharCode(0x2014));
  });

  it("reads text only, never markup", () => {
    const d = doc("profile.html");
    d.querySelector("#about")!.closest("section")!.querySelector("span[aria-hidden='true']")!.textContent =
      "<script>alert(1)</script> plain";
    const q = parseLinkedInPage(d, "https://www.linkedin.com/in/mira/")!;
    expect(q.about).toBe("<script>alert(1)</script> plain");
    expect(d.querySelector("#about")!.closest("section")!.querySelector("script")).toBeNull();
  });

  it("leaves detail fields off when the page does not show them", () => {
    const d = doc("profile.html");
    for (const id of ["about", "experience", "education"]) {
      d.querySelector(`#${id}`)!.closest("section")!.remove();
    }
    d.querySelector(".text-body-small")!.remove();
    d.querySelector(".distance-badge")!.remove();
    d.querySelector(".pv-top-card--list")!.remove();
    const q = parseLinkedInPage(d, "https://www.linkedin.com/in/mira/")!;
    expect(q.about).toBeUndefined();
    expect(q.pastRoles).toBeUndefined();
    expect(q.education).toBeUndefined();
    expect(q.connectionCount).toBeUndefined();
    expect(q.name).toBe("Mira Okafor-Lind");
  });
});

describe("parseLinkedInPage company detail", () => {
  const c = parseLinkedInPage(doc("company.html"), "https://www.linkedin.com/company/tidora/")!;

  it("captures industry, size, tagline, location and the about text", () => {
    expect(c.industry).toBe("Renewable Energy Semiconductor Manufacturing");
    expect(c.companySize).toBe("51-200 employees");
    expect(c.tagline).toBe("Tidal energy microgrids for island communities");
    expect(c.location).toBe("Bergen, Vestland");
    expect(c.about).toContain("tidal microgrids for island communities");
  });

  it("summarises the company by tagline, industry, place and size", () => {
    expect(c.summary).toBe(
      "Tidal energy microgrids for island communities. Renewable Energy Semiconductor Manufacturing, Bergen, Vestland, 51-200 employees."
    );
  });

  it("reads a single bullet separated info line too", () => {
    const d = doc("company.html");
    const list = d.querySelector(".org-top-card-summary-info-list")!;
    list.replaceChildren(d.createTextNode("Maritime · Raleigh, North Carolina · 900 followers · 11-50 employees"));
    const q = parseLinkedInPage(d, "https://www.linkedin.com/company/tidora/")!;
    expect(q.industry).toBe("Maritime");
    expect(q.location).toBe("Raleigh, North Carolina");
    expect(q.companySize).toBe("11-50 employees");
  });
});
