import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db/schema";
import { listPeople, upsertPerson } from "../src/lib/people";

/**
 * People captured before the detail existed have nothing to summarise from.
 * Cortex already indexed the profile page itself, so the summary falls back
 * to what it read there. Everything stays on the device.
 */
async function addProfileDoc(url: string, title: string, summary: string) {
  await db.documents.add({
    url,
    domain: "www.linkedin.com",
    title,
    summary,
    lastVisitedAt: Date.now(),
    visitCount: 3,
    importanceScore: 0.3,
  });
}

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
});

describe("people summary fallback", () => {
  it("uses the indexed profile page when the row carries no detail", async () => {
    await addProfileDoc(
      "https://www.linkedin.com/in/laxman-kumar/",
      "Laxman Kumar | LinkedIn",
      "Automation lead at Northwind, building test infrastructure for payments teams."
    );
    await upsertPerson({
      kind: "person",
      name: "Laxman Kumar",
      headline: "",
      company: "",
      profileUrl: "https://www.linkedin.com/in/laxman-kumar/",
    });

    const [row] = await listPeople({});
    expect(row!.summary).toContain("Automation lead at Northwind");
  });

  it("makes that fallback searchable", async () => {
    await addProfileDoc("https://www.linkedin.com/in/laxman-kumar/", "Laxman Kumar | LinkedIn", "Automation lead at Northwind");
    await upsertPerson({ kind: "person", name: "Laxman Kumar", headline: "", company: "", profileUrl: "https://www.linkedin.com/in/laxman-kumar/" });

    expect(await listPeople({ q: "northwind" })).toHaveLength(1);
    expect(await listPeople({ q: "automation" })).toHaveLength(1);
    expect(await listPeople({ q: "sailing" })).toHaveLength(0);
  });

  it("prefers detail captured from the profile over the page summary", async () => {
    await addProfileDoc("https://www.linkedin.com/in/mira/", "Mira | LinkedIn", "Page text that should not win");
    await upsertPerson({
      kind: "person",
      name: "Mira Okafor",
      headline: "Head of Field Programs",
      company: "Tidora",
      profileUrl: "https://www.linkedin.com/in/mira/",
    });

    const [row] = await listPeople({});
    expect(row!.summary).toContain("Head of Field Programs");
    expect(row!.summary).not.toContain("should not win");
  });

  it("shows the profile, not the page's skip links and buttons", async () => {
    await addProfileDoc(
      "https://www.linkedin.com/in/rajesh/",
      "Rajesh Ranjan | LinkedIn",
      "Skip to sidebar Skip to primary content Skip to aside Rajesh Ranjan Founder at DataVero.io Data Analyst More Message Connect"
    );
    await upsertPerson({
      kind: "person",
      name: "Rajesh Ranjan",
      headline: "",
      company: "",
      profileUrl: "https://www.linkedin.com/in/rajesh/",
    });

    const [row] = await listPeople({});
    expect(row!.summary).toBe("Founder at DataVero.io Data Analyst");
  });

  it("cleans a summary an earlier release already stored", async () => {
    await upsertPerson({
      kind: "person",
      name: "Linda Thurman",
      headline: "Director",
      company: "",
      profileUrl: "https://www.linkedin.com/in/linda/",
      summary: "Skip to primary content Linda Thurman Director for Student Prof. Dev. More Message Linda Thurman She/Her",
    });

    const [row] = await listPeople({});
    expect(row!.summary).toBe("Director for Student Prof. Dev.");
    expect(await listPeople({ q: "skip" })).toHaveLength(0);
  });

  it("leaves the row alone when there is no page either", async () => {
    await upsertPerson({ kind: "person", name: "Ada Field", headline: "", company: "", profileUrl: "https://www.linkedin.com/in/ada/" });
    const [row] = await listPeople({});
    expect(row!.summary ?? "").toBe("");
  });
});
