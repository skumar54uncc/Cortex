// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  renderPeopleView,
  personCardTitle,
  personCardPlace,
  personHeadlineLine,
  personInitials,
  personSummaryLine,
  type PersonRow,
} from "../src/content/people-view";

const rows: PersonRow[] = [
  { id: 1, kind: "person", name: "Mira <b>Okafor</b>", headline: "Head of Field Programs", company: "Tidora", profileUrl: "https://www.linkedin.com/in/mira/", lastSeen: Date.now(), visitCount: 3 },
  { id: 2, kind: "company", name: "Tidora", headline: "Tidal microgrids", company: "Tidora", profileUrl: "https://www.linkedin.com/company/tidora/", lastSeen: Date.now(), visitCount: 1 },
];

function setup(list = rows) {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const deps = {
    list: vi.fn(async (_q: string) => list),
    remove: vi.fn(async (_id: number) => true),
    announce: vi.fn(),
  };
  return { container, deps };
}

describe("People view", () => {
  it("lists people with a filter input, rendering page text as text (never HTML)", async () => {
    const { container, deps } = setup();
    await renderPeopleView(container, deps);
    const input = container.querySelector<HTMLInputElement>("input[type=search]")!;
    expect(input.getAttribute("aria-label")).toBe("Filter people");
    const items = container.querySelectorAll(".cortex-person");
    expect(items).toHaveLength(2);
    expect(container.querySelector("b")).toBeNull();
    expect(items[0].querySelector(".cortex-person-name")?.textContent).toBe("Mira <b>Okafor</b>");
    const link = items[0].querySelector<HTMLAnchorElement>("a.cortex-person-name")!;
    expect(link.href).toBe("https://www.linkedin.com/in/mira/");
    expect(link.rel).toContain("noopener");
    expect(items[1].textContent).toContain("Company");
  });

  it("filters through the list function", async () => {
    const { container, deps } = setup();
    await renderPeopleView(container, deps);
    const input = container.querySelector<HTMLInputElement>("input[type=search]")!;
    input.value = "tidora";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(deps.list).toHaveBeenLastCalledWith("tidora"));
  });

  it("deletes one person with a labelled button and announces it", async () => {
    const { container, deps } = setup();
    await renderPeopleView(container, deps);
    const del = container.querySelector<HTMLButtonElement>('button[aria-label="Delete Mira <b>Okafor</b>"]')!;
    del.click();
    await vi.waitFor(() => expect(deps.remove).toHaveBeenCalledWith(1));
    await vi.waitFor(() => expect(container.querySelectorAll(".cortex-person")).toHaveLength(1));
    expect(deps.announce).toHaveBeenCalled();
  });

  it("shows an empty state that explains how people get here", async () => {
    const { container, deps } = setup([]);
    await renderPeopleView(container, deps);
    expect(container.textContent).toContain("LinkedIn");
  });

  it("shows the full headline, then last viewed and visits on one row", async () => {
    const { container, deps } = setup([
      {
        id: 1,
        kind: "person",
        name: "Aiden Schlotterback",
        headline: "Co-founder of PolyWise | Grid planning | Coastal utilities",
        company: "PolyWise",
        profileUrl: "https://www.linkedin.com/in/aiden/",
        lastSeen: Date.parse("2026-09-19T10:00:00Z"),
        visitCount: 18,
        location: "Indian Trail, North Carolina",
        roleTitle: "Co-founder",
        pastRoles: [{ title: "Analyst", company: "Walker Group" }],
        education: ["Appalachian State University"],
        connectionDegree: "1st",
        connectionCount: 317,
      },
    ]);
    await renderPeopleView(container, deps);
    const headline = container.querySelector(".cortex-person-headline")!;
    expect(headline.textContent).toContain("Co-founder of PolyWise");
    expect(headline.textContent).toContain("Grid planning");
    expect(headline.textContent).toContain("Coastal utilities");
    const meta = container.querySelector(".cortex-person-meta")!;
    expect(meta.querySelector(".cortex-person-viewed")?.textContent).toMatch(/Last viewed /);
    expect(meta.querySelector(".cortex-person-visits")?.textContent).toBe("18 visits");
    expect(headline.querySelector("img")).toBeNull();
  });

  it("shows a longer headline as text under the name, never as HTML", async () => {
    const summary = "Clinical Research Coordinator at Harbor Point Health, based in Raleigh, North Carolina.";
    const { container, deps } = setup([
      {
        id: 7,
        kind: "person",
        name: "Jenna Leigh Hornbeak",
        headline: "Clinical Research Coordinator",
        company: "Harbor Point Health",
        profileUrl: "https://www.linkedin.com/in/jenna-leigh-hornbeak/",
        lastSeen: Date.parse("2026-09-20T10:00:00Z"),
        visitCount: 29,
        summary: `<img src=x onerror=alert(1)> ${summary}`,
      },
    ]);
    await renderPeopleView(container, deps);
    const el = container.querySelector(".cortex-person-headline")!;
    expect(el.textContent).toContain("Clinical Research Coordinator");
    expect(el.textContent).toContain("Harbor Point Health");
    expect(el.querySelector("img")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    const card = container.querySelector(".cortex-person")!;
    const order = Array.from(card.querySelectorAll(".cortex-person-name, .cortex-person-headline, .cortex-person-meta")).map(
      (c) => c.className.split(" ")[0]
    );
    expect(order.indexOf("cortex-person-headline")).toBeGreaterThan(order.indexOf("cortex-person-name"));
    expect(order.indexOf("cortex-person-headline")).toBeLessThan(order.indexOf("cortex-person-meta"));
  });

  it("does not add a second copy of the headline", async () => {
    const { container, deps } = setup([
      { ...rows[0], headline: "Head of Field Programs", summary: "Head of Field Programs." },
    ]);
    await renderPeopleView(container, deps);
    expect(container.querySelectorAll(".cortex-person-headline")).toHaveLength(1);
    expect(container.querySelector(".cortex-person-headline")?.textContent).toBe("Head of Field Programs");
  });

  it("says the filter also searches what people do", async () => {
    const { container, deps } = setup();
    await renderPeopleView(container, deps);
    const input = container.querySelector<HTMLInputElement>("input[type=search]")!;
    expect(input.placeholder).toContain("what they do");
    expect(input.placeholder).not.toContain(String.fromCharCode(0x2014));
  });

  it("shows one visit when they were opened once", async () => {
    const { container, deps } = setup([
      {
        id: 2,
        kind: "person",
        name: "Ada Field",
        headline: "Glaciologist",
        company: "Polar Lab",
        profileUrl: "https://www.linkedin.com/in/ada/",
        lastSeen: 0,
        visitCount: 1,
      },
    ]);
    await renderPeopleView(container, deps);
    expect(container.querySelector(".cortex-person-visits")?.textContent).toBe("1 visit");
    expect(container.querySelector(".cortex-person-headline")?.textContent).toBe("Glaciologist");
  });

  it("flips to the headline on click and leaves the profile link alone", async () => {
    const { container, deps } = setup();
    await renderPeopleView(container, deps);
    const card = container.querySelector(".cortex-person")!;
    const link = card.querySelector<HTMLAnchorElement>("a.cortex-person-name")!;
    link.click();
    expect(card.classList.contains("is-flipped")).toBe(false);
    expect(link.href).toContain("linkedin.com/in/mira");
    card.querySelector<HTMLButtonElement>(".cortex-person-turn")!.click();
    expect(card.classList.contains("is-flipped")).toBe(true);
    expect(deps.announce).toHaveBeenCalled();
    const profile = card.querySelector<HTMLAnchorElement>("a.cortex-person-profile")!;
    expect(profile.textContent).toBe("Profile");
    expect(profile.href).toContain("linkedin.com/in/mira");
    card.querySelector<HTMLButtonElement>(".cortex-person-headline")!.click();
    expect(card.classList.contains("is-flipped")).toBe(false);
  });

  it("uses a profile photo when the url is on LinkedIn's image host", async () => {
    const { container, deps } = setup([
      {
        ...rows[0],
        photoUrl: "https://media.licdn.com/dms/image/v2/D4E/profile-displayphoto-shrink_200_200/0/1",
      },
    ]);
    await renderPeopleView(container, deps);
    const img = container.querySelector<HTMLImageElement>(".cortex-person-photo")!;
    expect(img.src).toContain("profile-displayphoto-shrink_800_800");
    expect(img.alt).toBe("");
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toContain("shrink_400_400");
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toContain("shrink_200_200");
    img.dispatchEvent(new Event("error"));
    expect(container.querySelector(".cortex-person-photo")).toBeNull();
    expect(container.querySelector(".has-photo")).toBeNull();
  });

  it("drops profile links that are not http(s)", async () => {
    const { container, deps } = setup([{ ...rows[0], profileUrl: "javascript:alert(1)" }]);
    await renderPeopleView(container, deps);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector(".cortex-person-name")?.textContent).toContain("Mira");
  });
});

/**
 * The card already shows the headline, so a summary that only repeats it in
 * different punctuation is noise: LinkedIn writes the headline as the first
 * line of the profile text, which is where the summary comes from.
 */
describe("personCardTitle", () => {
  const row = (over: Partial<PersonRow>): PersonRow => ({
    id: 1,
    kind: "person",
    name: "Rick Connolly",
    headline: "CEO and Co-Founder · 2nd CEO and Co-Founder Miami-Fort Lauderdale Area · Contact info",
    company: "",
    profileUrl: "https://www.linkedin.com/in/rick/",
    lastSeen: 0,
    visitCount: 1,
    ...over,
  });

  it("keeps the role, not the rest of a LinkedIn headline", () => {
    expect(personCardTitle(row({}))).toBe("CEO and Co-Founder");
  });

  it("prefers the captured role and company", () => {
    expect(personCardTitle(row({ roleTitle: "CEO", company: "Gravity IT" }))).toBe("CEO at Gravity IT");
  });

  it("drops a leading copy of the name", () => {
    expect(personCardTitle(row({ headline: "Rick Connolly | Glaciologist" }))).toBe("Glaciologist");
  });

  it("reads a role out of a scraped profile when the headline is page chrome", () => {
    expect(
      personCardTitle(
        row({
          headline: "",
          summary:
            "Eva A. Talent Acquisition Program Manager at Southwest Airlines Eva A. · 2nd Talent Acquisition Program Manager at Southwest Airlines Dallas-Fort Worth Metroplex · Contact info Southwest Airlines",
          name: "Eva A.",
        })
      )
    ).toBe("Talent Acquisition Program Manager at Southwest Airlines");
    expect(
      personCardPlace(
        row({
          headline: "",
          name: "Eva A.",
          summary:
            "Eva A. Talent Acquisition Program Manager at Southwest Airlines · 2nd Talent Acquisition Program Manager at Southwest Airlines Dallas-Fort Worth Metroplex · Contact info",
        })
      )
    ).toBe("Dallas-Fort Worth Metroplex");
  });

  it("keeps a short title and a place from a founder headline", () => {
    expect(personCardTitle(row({}))).toBe("CEO and Co-Founder");
    expect(personCardPlace(row({}))).toBe("Miami-Fort Lauderdale Area");
  });

  it("turns an at-sign headline into a role line and finds the metro", () => {
    const scraped = row({
      name: "Shailesh Kumar",
      headline: "",
      summary:
        "AI & Tech Specialist @ UNC Charlotte. From 0 to 1 and beyond. Resources Enhance profile Add section Open to Shailesh Kumar AI & Tech Specialist @ UNC Charlotte. Charlotte Metro",
    });
    expect(personCardTitle(scraped)).toBe("AI & Tech Specialist at UNC Charlotte");
    expect(personCardPlace(scraped)).toBe("Charlotte Metro");
    expect(personSummaryLine(scraped)).toBe("");
  });
});

describe("personHeadlineLine", () => {
  it("keeps every part of a pipe-separated headline", () => {
    const line = personHeadlineLine({
      id: 1,
      kind: "person",
      name: "Pavan Kumar Komanduri, MBA",
      headline:
        "Senior AI & Transformation Leader | Enterprise AI Strategy, Agentic AI, GenAI | Portfolio, Governance, Value Realization | Ex-Microsoft, Ex-Siemens | Entrepreneur",
      company: "",
      profileUrl: "https://www.linkedin.com/in/pavan/",
      lastSeen: 0,
      visitCount: 10,
    });
    expect(line).toContain("Senior AI & Transformation Leader");
    expect(line).toContain("Enterprise AI Strategy, Agentic AI, GenAI");
    expect(line).toContain("Ex-Microsoft, Ex-Siemens");
    expect(line).toContain("Entrepreneur");
    expect(line).not.toContain("|");
  });

  it("shows a repeated role once", () => {
    const chancellor = personHeadlineLine({
      id: 2,
      kind: "person",
      name: "Sharon L. Gaber",
      headline:
        "Chancellor at University of North Carolina at Charlotte More Pending Message · Chancellor at University of North Carolina at Charlotte Charlotte, North Carolina, United States",
      company: "University of North Carolina at Charlotte",
      profileUrl: "https://www.linkedin.com/in/sharon/",
      lastSeen: 0,
      visitCount: 5,
    });
    expect(chancellor.match(/Chancellor at University of North Carolina at Charlotte/g)).toHaveLength(1);
    expect(chancellor).not.toContain("Pending Message");

    const shailesh = personHeadlineLine({
      id: 3,
      kind: "person",
      name: "Shailesh Kumar",
      headline: "",
      summary:
        "AI & Tech Specialist @ UNC Charlotte. From 0 to 1 and beyond. Resources AI & Tech Specialist @ UNC Charlotte. From 0 to 1 and beyond. Charlotte Metro",
      company: "",
      profileUrl: "https://www.linkedin.com/in/shailesh/",
      lastSeen: 0,
      visitCount: 10,
    });
    expect(shailesh.match(/AI & Tech Specialist/g)).toHaveLength(1);
    expect(shailesh.match(/From 0 to 1 and beyond/g)).toHaveLength(1);
  });
});

describe("personInitials", () => {
  it("uses the first and last letter", () => {
    expect(personInitials("Shailesh Kumar")).toBe("SK");
    expect(personInitials("Eva A.")).toBe("EA");
    expect(personInitials("Tidora")).toBe("T");
  });
});

describe("personSummaryLine", () => {
  const row = (headline: string, summary: string): PersonRow => ({
    id: 1,
    kind: "person",
    name: "Laxman Kumar",
    headline,
    company: "T-Mobile",
    profileUrl: "https://www.linkedin.com/in/laxman/",
    lastSeen: Date.now(),
    visitCount: 1,
    summary,
  });

  it("drops a summary that is the headline with other separators", () => {
    expect(
      personSummaryLine(
        row("Senior FDE at T-Mobile | Agentic AI Development | Ex-Google", "Senior FDE at T-Mobile Agentic AI Development Ex-Google")
      )
    ).toBe("");
  });

  it("keeps a summary that says more than the headline", () => {
    expect(personSummaryLine(row("Senior FDE at T-Mobile", "Senior FDE at T-Mobile. Writes about agent evaluation."))).toBe(
      "Senior FDE at T-Mobile. Writes about agent evaluation."
    );
  });

  it("has nothing to show when there is no summary", () => {
    expect(personSummaryLine(row("Senior FDE", ""))).toBe("");
  });
});
