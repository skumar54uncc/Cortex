import { describe, it, expect, vi, beforeEach } from "vitest";
import { summarizeBestEffort } from "../src/lib/summarize";

/**
 * Chrome replaced the `ai.summarizer` namespace with a `Summarizer` global,
 * so the old call site never matched and every page summary fell back to the
 * first 240 characters of the page, skip links and all. The request must also
 * name its output language, the way the Prompt API requires.
 */
const LONG = `${"The northern survey team recorded unusual magnetometer readings through the long winter night. ".repeat(6)}`;

function installSummarizer(text: string, availability = "available") {
  const summarize = vi.fn(async () => text);
  const create = vi.fn(async (_options?: object) => ({ summarize, destroy: vi.fn() }));
  const avail = vi.fn(async () => availability);
  vi.stubGlobal("Summarizer", { availability: avail, create });
  return { summarize, create, avail };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("summarizeBestEffort", () => {
  it("uses the Summarizer global and names the output language", async () => {
    const s = installSummarizer("Unusual magnetometer readings over one winter.");
    expect(await summarizeBestEffort(LONG)).toBe("Unusual magnetometer readings over one winter.");
    const options = (s.create.mock.calls[0]?.[0] ?? {}) as { outputLanguage?: string; format?: string };
    expect(options.outputLanguage).toBe("en");
    expect(options.format).toBe("plain-text");
  });

  it("falls back to an excerpt when the model is not installed", async () => {
    installSummarizer("never used", "downloadable");
    const out = await summarizeBestEffort(LONG);
    expect(out.startsWith("The northern survey team")).toBe(true);
  });

  it("falls back to an excerpt when there is no API at all", async () => {
    const out = await summarizeBestEffort(LONG);
    expect(out.startsWith("The northern survey team")).toBe(true);
    expect(out.length).toBeLessThan(260);
  });

  it("leaves the page's own skip links out of the excerpt", async () => {
    const out = await summarizeBestEffort(`Skip to primary content Skip to aside ${LONG}`);
    expect(out.startsWith("The northern survey team")).toBe(true);
  });

  it("returns short text unchanged and never calls the model for it", async () => {
    const s = installSummarizer("unused");
    expect(await summarizeBestEffort("A short note about the ridge.")).toBe("A short note about the ridge.");
    expect(s.create).not.toHaveBeenCalled();
  });
});
