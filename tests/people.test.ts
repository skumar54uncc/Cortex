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

describe("parsePeopleQuery", () => {
  it("detects 'who did I view / search / look at' with an optional company and time", () => {
    expect(parsePeopleQuery("who did I view from Tidora last week")).toMatchObject({ company: "Tidora" });
    expect(parsePeopleQuery("who did I view from Tidora last week")?.timeRange?.label).toBeTruthy();
    expect(parsePeopleQuery("Who did I search yesterday?")).toMatchObject({ company: undefined });
    expect(parsePeopleQuery("who did I look at at Brewlog")).toMatchObject({ company: "Brewlog" });
    expect(parsePeopleQuery("which profiles did I visit from Brewlog")).toMatchObject({ company: "Brewlog" });
    expect(parsePeopleQuery("people I viewed at Tidora")).toMatchObject({ company: "Tidora" });
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

  it("returns null when nobody matches, so Ask falls back to RAG", async () => {
    await upsertPerson(jonas, NOW);
    expect(await answerPeopleQuery({ company: "Tidora" }, NOW)).toBeNull();
  });
});
