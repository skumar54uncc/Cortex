// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseLinkedInPage,
  isJunkProfileName,
  nameFromProfileUrl,
  resolveProfileName,
  buildProfileSummary,
  sanitizePersonDetail,
} from "../src/lib/capture/linkedin";

function doc(name: string): Document {
  const html = readFileSync(join(__dirname, "fixtures", "linkedin", name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

const JENNA = "https://www.linkedin.com/in/jenna-leigh-hornbeak/";

describe("isJunkProfileName", () => {
  it("rejects LinkedIn chrome, counters and punctuation", () => {
    for (const junk of [
      "Notifications",
      "notifications",
      "  Notifications  ",
      "(1) Notifications",
      "(12) Messaging",
      "Home",
      "My Network",
      "MyNetwork",
      "Jobs",
      "Messaging",
      "Feed",
      "LinkedIn",
      "LinkedIn Member",
      "Sign in",
      "Join now",
      "Search",
      "Premium",
      "Home My Network Jobs Messaging",
      "12345",
      "  ",
      "...",
      "- -",
      "(3)",
    ]) {
      expect(isJunkProfileName(junk), junk).toBe(true);
    }
  });

  it("rejects a name that is too long or carries a newline", () => {
    expect(isJunkProfileName("N".repeat(81))).toBe(true);
    expect(isJunkProfileName("Jenna\nLeigh Hornbeak")).toBe(true);
    expect(isJunkProfileName("N".repeat(80))).toBe(false);
  });

  it("keeps real names, including ones that mention a junk word", () => {
    for (const ok of [
      "Jenna Leigh Hornbeak",
      "Mira Okafor-Lind",
      "Laxman Kumar",
      "Jo",
      "Ana Gómez",
      "Ridgeline Freight",
      "Jobsworth Analytics",
      "Nate Homes",
    ]) {
      expect(isJunkProfileName(ok), ok).toBe(false);
    }
  });
});

describe("nameFromProfileUrl", () => {
  it("title cases the slug and drops trailing id segments", () => {
    expect(nameFromProfileUrl(JENNA)).toBe("Jenna Leigh Hornbeak");
    // A slug cannot tell a hyphenated surname from a separator, so it spaces.
    expect(nameFromProfileUrl("https://www.linkedin.com/in/mira-okafor-lind-12ab/")).toBe("Mira Okafor Lind");
    expect(nameFromProfileUrl("https://www.linkedin.com/in/jenna.leigh_hornbeak/")).toBe("Jenna Leigh Hornbeak");
    expect(nameFromProfileUrl("https://www.linkedin.com/in/marcus-t-albright-1a2b3c4/")).toBe("Marcus T Albright");
    expect(nameFromProfileUrl("https://www.linkedin.com/in/laxman-kumar-12345/")).toBe("Laxman Kumar");
    expect(nameFromProfileUrl("https://linkedin.com/in/AdaField/")).toBe("Adafield");
    expect(nameFromProfileUrl("https://www.linkedin.com/company/ridgeline-freight/")).toBe("Ridgeline Freight");
  });

  it("returns nothing when the slug cannot carry a name", () => {
    expect(nameFromProfileUrl("https://www.linkedin.com/in/12345/")).toBe("");
    expect(nameFromProfileUrl("https://www.linkedin.com/in/1a2b3c4d/")).toBe("");
    expect(nameFromProfileUrl("https://www.linkedin.com/in/a/")).toBe("");
    expect(nameFromProfileUrl("https://www.linkedin.com/feed/")).toBe("");
    expect(nameFromProfileUrl("not a url")).toBe("");
  });
});

describe("resolveProfileName", () => {
  it("takes the first clean candidate, else the slug, else nothing", () => {
    expect(resolveProfileName(["Notifications", "Jenna Leigh Hornbeak"], JENNA)).toBe("Jenna Leigh Hornbeak");
    expect(resolveProfileName(["Notifications", "(1) Home"], JENNA)).toBe("Jenna Leigh Hornbeak");
    expect(resolveProfileName([null, undefined, "  "], JENNA)).toBe("Jenna Leigh Hornbeak");
    expect(resolveProfileName(["Notifications"], "https://www.linkedin.com/in/12345/")).toBe("");
    expect(resolveProfileName([], "https://www.linkedin.com/in/12345/")).toBe("");
  });

  it("collapses whitespace and caps the length of a name it keeps", () => {
    expect(resolveProfileName(["  Mira   Okafor-Lind "], JENNA)).toBe("Mira Okafor-Lind");
  });
});

describe("buildProfileSummary", () => {
  it("says what a person does, where they are, and opens their about text", () => {
    const s = buildProfileSummary({
      kind: "person",
      name: "Jenna Leigh Hornbeak",
      headline: "Clinical Research Coordinator at Harbor Point Health",
      company: "Harbor Point Health",
      roleTitle: "Clinical Research Coordinator",
      location: "Raleigh, North Carolina",
      about: "I run oncology trial sites and keep enrollment honest. Ten years of coordinating protocols.",
    });
    expect(s).toBe(
      "Clinical Research Coordinator at Harbor Point Health, based in Raleigh, North Carolina. I run oncology trial sites and keep enrollment honest."
    );
    expect(s.length).toBeLessThanOrEqual(200);
  });

  it("falls back to the headline when there is no parsed role", () => {
    expect(
      buildProfileSummary({ kind: "person", name: "Ada Field", headline: "Glaciologist", company: "Polar Lab" })
    ).toBe("Glaciologist at Polar Lab.");
    expect(buildProfileSummary({ kind: "person", name: "Ada Field", headline: "", company: "Polar Lab" })).toBe(
      "Works at Polar Lab."
    );
  });

  it("describes a company by tagline, industry, place and size", () => {
    expect(
      buildProfileSummary({
        kind: "company",
        name: "Ridgeline Freight",
        headline: "Regional freight that shows up when it says it will",
        company: "Ridgeline Freight",
        industry: "Truck Transportation",
        location: "Charlotte, North Carolina",
        companySize: "201-500 employees",
        tagline: "Regional freight that shows up when it says it will",
      })
    ).toBe(
      "Regional freight that shows up when it says it will. Truck Transportation, Charlotte, North Carolina, 201-500 employees."
    );
  });

  it("stays inside 200 characters, cuts on a word boundary and uses no em dash", () => {
    const s = buildProfileSummary({
      kind: "person",
      name: "Long",
      headline: "Principal ".repeat(30),
      company: "",
    });
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s.endsWith("...")).toBe(true);
    expect(s).not.toContain(String.fromCharCode(0x2014));
    // Cut on a word boundary: the last word is whole.
    expect(s).toMatch(/Principal\.\.\.$/);
  });

  it("returns nothing when the page carried no signal", () => {
    expect(buildProfileSummary({ kind: "person", name: "Laxman Kumar", headline: "", company: "" })).toBe("");
    expect(buildProfileSummary({})).toBe("");
  });
});

describe("parseLinkedInPage with nav chrome in the way", () => {
  it("takes the profile heading, not the notifications panel the owner hit", () => {
    const p = parseLinkedInPage(doc("profile-notifications.html"), `${JENNA}?trk=nav`)!;
    expect(p.name).toBe("Jenna Leigh Hornbeak");
    expect(p.profileUrl).toBe(JENNA);
    expect(p.kind).toBe("person");
    expect(p.roleTitle).toBe("Clinical Research Coordinator");
    expect(p.company).toBe("Harbor Point Health");
    expect(p.location).toBe("Raleigh, North Carolina");
    expect(p.summary).toBe(
      "Clinical Research Coordinator at Harbor Point Health, based in Raleigh, North Carolina. I run oncology trial sites and keep enrollment honest."
    );
  });

  it("still finds the real name when the notifications panel is the only h1 left", () => {
    const d = doc("profile-notifications.html");
    d.querySelector(".pv-top-card h1")!.remove();
    const p = parseLinkedInPage(d, JENNA)!;
    expect(p.name).toBe("Jenna Leigh Hornbeak");
  });

  it("derives the name from the slug when the page shows none", () => {
    const p = parseLinkedInPage(doc("profile-no-name.html"), "https://www.linkedin.com/in/marcus-t-albright-1a2b3c4/")!;
    expect(p.name).toBe("Marcus T Albright");
    expect(p.roleTitle).toBe("Warehouse Operations Manager");
    expect(p.summary).toContain("Warehouse Operations Manager at Ridgeline Freight");
    expect(p.summary).toContain("Indian Trail, North Carolina");
  });

  it("records nothing when neither the page nor the slug gives a plausible name", () => {
    expect(parseLinkedInPage(doc("profile-no-name.html"), "https://www.linkedin.com/in/12345/")).toBeNull();
  });

  it("keeps a company page out of the chrome too", () => {
    const c = parseLinkedInPage(doc("company-chrome.html"), "https://www.linkedin.com/company/ridgeline-freight/")!;
    expect(c.kind).toBe("company");
    expect(c.name).toBe("Ridgeline Freight");
    expect(c.industry).toBe("Truck Transportation");
    expect(c.companySize).toBe("201-500 employees");
    expect(c.summary).toBe(
      "Regional freight that shows up when it says it will. Truck Transportation, Charlotte, North Carolina, 201-500 employees."
    );
  });
});

describe("sanitizePersonDetail guards the name and the summary", () => {
  it("replaces a junk name with the one the slug gives", () => {
    expect(sanitizePersonDetail({ name: "Notifications", profileUrl: JENNA }).name).toBe("Jenna Leigh Hornbeak");
    expect(sanitizePersonDetail({ name: "(1) Messaging", profileUrl: JENNA }).name).toBe("Jenna Leigh Hornbeak");
  });

  it("keeps a real name and leaves the field off when nothing is usable", () => {
    expect(sanitizePersonDetail({ name: "  Laxman  Kumar ", profileUrl: JENNA }).name).toBe("Laxman Kumar");
    expect(sanitizePersonDetail({ name: "Notifications", profileUrl: "https://www.linkedin.com/in/12345/" }).name).toBeUndefined();
    expect(sanitizePersonDetail({ name: "Notifications" }).name).toBeUndefined();
    expect(sanitizePersonDetail({}).name).toBeUndefined();
  });

  it("caps a page supplied summary and invents none of its own", () => {
    expect(sanitizePersonDetail({ summary: "  Runs field   crews.  " }).summary).toBe("Runs field crews.");
    expect(sanitizePersonDetail({ summary: "x".repeat(900) }).summary!.length).toBeLessThanOrEqual(240);
    expect(sanitizePersonDetail({ summary: 42 }).summary).toBeUndefined();
    // A payload with no summary keeps none, so a restored backup is unchanged.
    expect(
      sanitizePersonDetail({ roleTitle: "Staff Engineer", company: "Brewlog", location: "Durham" }).summary
    ).toBeUndefined();
  });

  it("still returns nothing at all for an empty payload", () => {
    expect(sanitizePersonDetail({})).toEqual({});
    expect(sanitizePersonDetail(null)).toEqual({});
  });
});
