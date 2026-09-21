// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderPeopleView, type PersonRow } from "../src/content/people-view";

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

  it("shows the captured detail as text: where they are, what they do now, and how connected", async () => {
    const { container, deps } = setup([
      {
        id: 1,
        kind: "person",
        name: "Aiden Schlotterback",
        headline: "Co-founder of PolyWise",
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
    const detail = container.querySelector(".cortex-person-detail")!;
    expect(detail.textContent).toContain("Indian Trail, North Carolina");
    expect(detail.textContent).toContain("Co-founder at PolyWise");
    expect(detail.textContent).toContain("1st");
    expect(detail.textContent).toContain("317 connections");
    expect(detail.querySelector("img")).toBeNull();
  });

  it("shows the summary under the name, as text", async () => {
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
    const el = container.querySelector(".cortex-person-summary")!;
    expect(el.textContent).toContain(summary);
    expect(el.querySelector("img")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // Under the name, above the meta line.
    const main = container.querySelector(".cortex-person-main")!;
    const order = Array.from(main.children).map((c) => c.className.split(" ")[0]);
    expect(order.indexOf("cortex-person-summary")).toBeGreaterThan(order.indexOf("cortex-person-name"));
    expect(order.indexOf("cortex-person-summary")).toBeLessThan(order.indexOf("cortex-person-meta"));
  });

  it("leaves the summary out for a row that has none", async () => {
    const { container, deps } = setup();
    await renderPeopleView(container, deps);
    expect(container.querySelector(".cortex-person-summary")).toBeNull();
  });

  it("does not repeat the headline as a summary", async () => {
    const { container, deps } = setup([
      { ...rows[0], headline: "Head of Field Programs", summary: "Head of Field Programs." },
    ]);
    await renderPeopleView(container, deps);
    expect(container.querySelector(".cortex-person-summary")).toBeNull();
  });

  it("says the filter also searches what people do", async () => {
    const { container, deps } = setup();
    await renderPeopleView(container, deps);
    const input = container.querySelector<HTMLInputElement>("input[type=search]")!;
    expect(input.placeholder).toContain("what they do");
    expect(input.placeholder).not.toContain(String.fromCharCode(0x2014));
  });

  it("leaves the detail line out for a person captured before the detail existed", async () => {
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
    expect(container.querySelector(".cortex-person-detail")).toBeNull();
  });

  it("drops profile links that are not http(s)", async () => {
    const { container, deps } = setup([{ ...rows[0], profileUrl: "javascript:alert(1)" }]);
    await renderPeopleView(container, deps);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector(".cortex-person-name")?.textContent).toContain("Mira");
  });
});
