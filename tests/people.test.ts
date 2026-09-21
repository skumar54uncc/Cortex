import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db/schema";
import {
  upsertPerson,
  listPeople,
  deletePerson,
  parsePeopleQuery,
  answerPeopleQuery,
} from "../src/lib/people";

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 18, 15, 0).getTime();

const mira = {
  kind: "person" as const,
  name: "Mira Okafor-Lind",
  headline: "Head of Field Programs at Tidora",
  company: "Tidora",
  profileUrl: "https://www.linkedin.com/in/mira/",
};
const jonas = {
  kind: "person" as const,
  name: "Jonas Veldt",
  headline: "Engineer at Brewlog",
  company: "Brewlog",
  profileUrl: "https://www.linkedin.com/in/jonas/",
};
const avery = {
  kind: "person" as const,
  name: "Avery Nakamura",
  headline: "Building grid tooling",
  company: "Brewlog",
  profileUrl: "https://www.linkedin.com/in/avery/",
  location: "Durham, North Carolina",
  about: "Co-founder at heart. I like slow hardware and fast feedback.",
  roleTitle: "Staff Engineer",
  pastRoles: [
    { title: "Co-founder", company: "PolyWise" },
    { title: "Field Engineer", company: "Havstrom AS" },
  ],
  education: ["Duke University, BSc Computer Science"],
  connectionDegree: "2nd",
  connectionCount: 611,
};

beforeEach(async () => {
  await db.people.clear();
});

describe("people store", () => {
  it("first view sets firstSeen; repeat views bump visitCount and lastSeen and refresh fields", async () => {
    await upsertPerson(mira, NOW - 3 * DAY);
    await upsertPerson({ ...mira, headline: "Director at Tidora" }, NOW);
    const rows = await db.people.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      firstSeen: NOW - 3 * DAY,
      lastSeen: NOW,
      visitCount: 2,
      headline: "Director at Tidora",
    });
  });

  it("lists by recency with company, time and text filters; deletes one person", async () => {
    await upsertPerson(mira, NOW - 1 * DAY);
    await upsertPerson(jonas, NOW - 10 * DAY);
    expect((await listPeople({})).map((p) => p.name)).toEqual(["Mira Okafor-Lind", "Jonas Veldt"]);
    expect((await listPeople({ company: "tidora" })).map((p) => p.name)).toEqual(["Mira Okafor-Lind"]);
    expect((await listPeople({ since: NOW - 2 * DAY })).map((p) => p.name)).toEqual(["Mira Okafor-Lind"]);
    expect((await listPeople({ q: "engineer" })).map((p) => p.name)).toEqual(["Jonas Veldt"]);
    const id = (await db.people.where("profileUrl").equals(jonas.profileUrl).first())!.id!;
    await deletePerson(id);
    expect(await db.people.count()).toBe(1);
  });
});

describe("people detail merge", () => {
  it("stores the detail a profile page carried", async () => {
    await upsertPerson(avery, NOW);
    const row = (await db.people.toArray())[0]!;
    expect(row).toMatchObject({
      location: "Durham, North Carolina",
      roleTitle: "Staff Engineer",
      connectionDegree: "2nd",
      connectionCount: 611,
      education: ["Duke University, BSc Computer Science"],
    });
    expect(row.pastRoles).toEqual(avery.pastRoles);
  });

  it("fills empty fields on a later visit without losing what an earlier visit saw", async () => {
    // First visit: a thin render (LinkedIn lazy loads the lower sections).
    await upsertPerson({ ...mira, location: "Bergen, Norway" }, NOW - 2 * DAY);
    // Second visit: the full page, minus the location the first visit caught.
    await upsertPerson(
      {
        ...mira,
        about: "Runs field crews for tidal microgrids.",
        roleTitle: "Head of Field Programs",
        pastRoles: [{ title: "Co-founder", company: "PolyWise" }],
        education: ["NTNU, MSc Electrical Engineering"],
        connectionDegree: "2nd",
        connectionCount: 842,
      },
      NOW
    );
    const row = (await db.people.toArray())[0]!;
    expect(row).toMatchObject({
      location: "Bergen, Norway",
      about: "Runs field crews for tidal microgrids.",
      roleTitle: "Head of Field Programs",
      connectionCount: 842,
      visitCount: 2,
      lastSeen: NOW,
      firstSeen: NOW - 2 * DAY,
    });
    expect(row.pastRoles).toEqual([{ title: "Co-founder", company: "PolyWise" }]);
  });

  it("updates a field the new page has a value for, and keeps the old value when it does not", async () => {
    await upsertPerson({ ...avery, roleTitle: "Senior Engineer" }, NOW - DAY);
    await upsertPerson({ ...mira, profileUrl: avery.profileUrl, name: avery.name, roleTitle: "Principal Engineer" }, NOW);
    const row = (await db.people.toArray())[0]!;
    expect(row.roleTitle).toBe("Principal Engineer");
    expect(row.location).toBe("Durham, North Carolina");
    expect(row.connectionCount).toBe(611);
    expect(row.education).toEqual(["Duke University, BSc Computer Science"]);
  });

  it("caps past roles at five and education at three", async () => {
    await upsertPerson(
      {
        ...mira,
        pastRoles: Array.from({ length: 9 }, (_, i) => ({ title: `Role ${i}`, company: `Co ${i}` })),
        education: ["A", "B", "C", "D", "E"],
      },
      NOW
    );
    const row = (await db.people.toArray())[0]!;
    expect(row.pastRoles).toHaveLength(5);
    expect(row.education).toEqual(["A", "B", "C"]);
  });
});

describe("people names", () => {
  it("never stores LinkedIn chrome as a name: the slug supplies the real one", async () => {
    const id = await upsertPerson(
      {
        kind: "person",
        name: "Notifications",
        headline: "",
        company: "",
        profileUrl: "https://www.linkedin.com/in/jenna-leigh-hornbeak/",
      },
      NOW
    );
    expect(id).not.toBeNull();
    const row = (await db.people.toArray())[0]!;
    expect(row.name).toBe("Jenna Leigh Hornbeak");
  });

  it("records nothing when neither the page nor the slug gives a plausible name", async () => {
    const id = await upsertPerson(
      { kind: "person", name: "(1) Messaging", headline: "", company: "", profileUrl: "https://www.linkedin.com/in/12345/" },
      NOW
    );
    expect(id).toBeNull();
    expect(await db.people.count()).toBe(0);
  });

  it("repairs the name on a later visit without duplicating the row", async () => {
    await upsertPerson({ ...mira, name: "Notifications", profileUrl: "https://www.linkedin.com/in/mira-okafor-lind/" }, NOW - DAY);
    await upsertPerson({ ...mira, profileUrl: "https://www.linkedin.com/in/mira-okafor-lind/" }, NOW);
    const rows = await db.people.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Mira Okafor-Lind");
    expect(rows[0]!.visitCount).toBe(2);
  });
});

describe("rows stored by an earlier release", () => {
  it("repairs a junk name from the profile slug when the row is listed", async () => {
    await db.people.add({
      kind: "person",
      name: "Notifications",
      headline: "",
      company: "",
      profileUrl: "https://www.linkedin.com/in/jenna-leigh-hornbeak/",
      firstSeen: NOW - DAY,
      lastSeen: NOW,
      visitCount: 29,
    });
    const [row] = await listPeople({});
    expect(row!.name).toBe("Jenna Leigh Hornbeak");
    // Searchable under the repaired name too.
    expect((await listPeople({ q: "hornbeak" })).map((p) => p.name)).toEqual(["Jenna Leigh Hornbeak"]);
  });

  it("labels a row by its profile path when no name can be had, so it stays deletable", async () => {
    const id = (await db.people.add({
      kind: "person",
      name: "(1) Notifications",
      headline: "",
      company: "",
      profileUrl: "https://www.linkedin.com/in/12345/",
      firstSeen: NOW,
      lastSeen: NOW,
      visitCount: 1,
    })) as number;
    const [row] = await listPeople({});
    expect(row!.name).toBe("linkedin.com/in/12345");
    expect(row!.id).toBe(id);
    await deletePerson(id);
    expect(await db.people.count()).toBe(0);
  });

  it("fills a missing summary from what the old row already holds", async () => {
    await db.people.add({
      kind: "person",
      name: "Laxman Kumar",
      headline: "Automation lead at Northwind",
      company: "Northwind",
      profileUrl: "https://www.linkedin.com/in/laxman-kumar-9f2/",
      firstSeen: NOW - DAY,
      lastSeen: NOW,
      visitCount: 29,
    });
    const [row] = await listPeople({});
    expect(row!.summary).toBe("Automation lead at Northwind.");
    expect((await listPeople({ q: "automation" })).map((p) => p.name)).toEqual(["Laxman Kumar"]);
  });
});

describe("people summary", () => {
  it("stores a short summary of what the profile carried", async () => {
    await upsertPerson(avery, NOW);
    const row = (await db.people.toArray())[0]!;
    expect(row.summary).toBe(
      "Staff Engineer at Brewlog, based in Durham, North Carolina. Co-founder at heart."
    );
    expect(row.summary!.length).toBeLessThanOrEqual(200);
    expect(row.summary).not.toContain(String.fromCharCode(0x2014));
  });

  it("keeps a summary the capture already built", async () => {
    await upsertPerson({ ...jonas, summary: "Brews beer and writes Rust." }, NOW);
    expect((await db.people.toArray())[0]!.summary).toBe("Brews beer and writes Rust.");
  });

  it("finds a person by what they do", async () => {
    await upsertPerson(avery, NOW);
    await upsertPerson(mira, NOW - DAY);
    // "based in" only ever exists in the summary.
    expect((await listPeople({ q: "based in durham" })).map((p) => p.name)).toEqual(["Avery Nakamura"]);
    expect(await listPeople({ q: "based in bergen" })).toEqual([]);
  });
});

describe("people search over the captured detail", () => {
  beforeEach(async () => {
    await upsertPerson(mira, NOW - DAY);
    await upsertPerson(avery, NOW);
  });

  it("matches on location, about, current role, past roles and education", async () => {
    expect((await listPeople({ q: "north carolina" })).map((p) => p.name)).toEqual(["Avery Nakamura"]);
    expect((await listPeople({ q: "co-founder" })).map((p) => p.name)).toEqual(["Avery Nakamura"]);
    expect((await listPeople({ q: "polywise" })).map((p) => p.name)).toEqual(["Avery Nakamura"]);
    expect((await listPeople({ q: "staff engineer" })).map((p) => p.name)).toEqual(["Avery Nakamura"]);
    expect((await listPeople({ q: "duke" })).map((p) => p.name)).toEqual(["Avery Nakamura"]);
    expect((await listPeople({ q: "NORTH carolina co-founder" })).map((p) => p.name)).toEqual(["Avery Nakamura"]);
    expect(await listPeople({ q: "reykjavik" })).toEqual([]);
  });

  it("treats a past employer as a company match too", async () => {
    expect((await listPeople({ company: "polywise" })).map((p) => p.name)).toEqual(["Avery Nakamura"]);
    expect((await listPeople({ company: "tidora" })).map((p) => p.name)).toEqual(["Mira Okafor-Lind"]);
  });
});

describe("parsePeopleQuery", () => {
  it("detects 'who did I view / search / look at' with an optional company and time", () => {
    expect(parsePeopleQuery("who did I view from Tidora last week")).toMatchObject({ company: "Tidora" });
    expect(parsePeopleQuery("who did I view from Tidora last week")?.timeRange?.label).toBeTruthy();
    expect(parsePeopleQuery("Who did I search yesterday?")).toMatchObject({ company: undefined });
    expect(parsePeopleQuery("who did I look at at Brewlog")).toMatchObject({ company: "Brewlog" });
    expect(parsePeopleQuery("which profiles did I visit from Brewlog")).toMatchObject({ company: "Brewlog" });
    expect(parsePeopleQuery("people I viewed at Tidora")).toMatchObject({ company: "Tidora" });
  });

  it("detects 'who works at X' and 'people in <place>'", () => {
    expect(parsePeopleQuery("who works at PolyWise")).toMatchObject({ company: "PolyWise" });
    expect(parsePeopleQuery("Who worked at PolyWise?")).toMatchObject({ company: "PolyWise" });
    expect(parsePeopleQuery("people in North Carolina")).toMatchObject({ q: "North Carolina" });
    expect(parsePeopleQuery("people based in Bergen last month")?.q).toBe("Bergen");
    expect(parsePeopleQuery("people based in Bergen last month")?.timeRange?.label).toBeTruthy();
  });

  it("ignores questions that are not about people", () => {
    expect(parsePeopleQuery("how do tidal turbines work")).toBeNull();
    expect(parsePeopleQuery("who invented the printing press")).toBeNull();
    expect(parsePeopleQuery("what did I read yesterday")).toBeNull();
  });
});

describe("answerPeopleQuery", () => {
  it("answers from the people store with links, filtered by company", async () => {
    await upsertPerson(mira, NOW - 1 * DAY);
    await upsertPerson(jonas, NOW - 1 * DAY);
    const a = await answerPeopleQuery({ company: "Tidora" }, NOW);
    expect(a?.people.map((p) => p.name)).toEqual(["Mira Okafor-Lind"]);
    expect(a?.text).toContain("Mira Okafor-Lind");
    expect(a?.text).toContain("https://www.linkedin.com/in/mira/");
    expect(a?.text).not.toContain("Jonas");
  });

  it("adds the captured detail to the answer in plain sentences, with no em dash", async () => {
    await upsertPerson(avery, NOW);
    const a = await answerPeopleQuery({ q: "north carolina" }, NOW);
    expect(a?.people.map((p) => p.name)).toEqual(["Avery Nakamura"]);
    expect(a!.text).toContain("Based in Durham, North Carolina.");
    expect(a!.text).toContain("Currently Staff Engineer at Brewlog.");
    expect(a!.text).toContain("Previously Co-founder at PolyWise, Field Engineer at Havstrom AS.");
    expect(a!.text).toContain("Studied at Duke University, BSc Computer Science.");
    expect(a!.text).toContain("2nd degree connection");
    expect(a!.text).toContain("611 connections");
    expect(a!.text).not.toContain(String.fromCharCode(0x2014));
  });

  it("keeps the old one line shape for a person with no extra detail", async () => {
    await upsertPerson(jonas, NOW);
    const a = await answerPeopleQuery({ company: "Brewlog" }, NOW);
    expect(a!.text.split("\n")).toHaveLength(2);
    expect(a!.text.split("\n")[1]).toMatch(/^- Jonas Veldt, Engineer at Brewlog \(last viewed .+\): https:/);
  });

  it("returns null when nobody matches, so Ask falls back to RAG", async () => {
    await upsertPerson(jonas, NOW);
    expect(await answerPeopleQuery({ company: "Tidora" }, NOW)).toBeNull();
  });
});
