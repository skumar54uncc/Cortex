import { describe, it, expect } from "vitest";
import { pageLabel, pickSitePages, completeSentencesOnly } from "../src/lib/chat/digest-format";

/**
 * The digest listed the same video three times, printed Amazon titles that
 * ran for lines, showed LinkedIn feed chrome, and ended mid sentence.
 */
describe("pageLabel", () => {
  it("drops unread counters and site suffixes, and shortens long titles", () => {
    expect(pageLabel("(1) Feed | LinkedIn")).toBe("Feed");
    expect(pageLabel("(3) Instagram • Messages")).toBe("Instagram • Messages");
    expect(pageLabel("Echoes in Silence - YouTube")).toBe("Echoes in Silence");
    expect(pageLabel("Linda Thurman | LinkedIn")).toBe("Linda Thurman");
    expect(
      pageLabel(
        "YOGIMOONI Shiatsu Foot Massager Machine with Heat, Foot and Calf Massager, Delivers Relief for Tired Muscles and Plantar, Deep Tissue Massager, Pain Relief"
      ).length
    ).toBeLessThanOrEqual(61);
    expect(pageLabel("   ")).toBe("Untitled");
  });
});

describe("pickSitePages", () => {
  const p = (title: string, url: string) => ({ n: 1, title, url, domain: "d", visitedAt: 0 });

  it("shows each page once, even when the title repeats", () => {
    const picked = pickSitePages(
      [
        p("Echoes in Silence - YouTube", "https://y.test/1"),
        p("Echoes in Silence - YouTube", "https://y.test/2"),
        p("Echoes in Silence", "https://y.test/3"),
        p("Another video", "https://y.test/4"),
      ],
      3
    );
    expect(picked.map((x) => x.label)).toEqual(["Echoes in Silence", "Another video"]);
  });

  it("drops the site's own chrome pages when there is anything better", () => {
    const picked = pickSitePages(
      [p("Feed | LinkedIn", "https://l.test/feed"), p("(1) Feed | LinkedIn", "https://l.test/feed2"), p("Linda Thurman | LinkedIn", "https://l.test/in/linda")],
      3
    );
    expect(picked.map((x) => x.label)).toEqual(["Linda Thurman"]);
  });

  it("keeps chrome pages when that is all there is, rather than showing nothing", () => {
    const picked = pickSitePages([p("Feed | LinkedIn", "https://l.test/feed")], 3);
    expect(picked.map((x) => x.label)).toEqual(["Feed"]);
  });
});

describe("completeSentencesOnly", () => {
  it("drops a trailing fragment the model was cut off mid way through", () => {
    const out = completeSentencesOnly(
      "You read about agents. On gemini.google.com you looked at video generation. On github.com you explored open-source alternatives for AI image and"
    );
    expect(out).toBe("You read about agents. On gemini.google.com you looked at video generation.");
  });

  it("keeps text that already ends properly, and never returns nothing", () => {
    expect(completeSentencesOnly("One sentence.")).toBe("One sentence.");
    expect(completeSentencesOnly("no terminator at all")).toBe("no terminator at all");
    expect(completeSentencesOnly("")).toBe("");
  });
});
