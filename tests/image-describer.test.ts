// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { promptApiImageDescriber } from "../src/offscreen/image-describer";

/**
 * Chrome logs "No output language was specified in a LanguageModel API
 * request" when availability() or create() is called without one. Every call
 * site must name the output language.
 */
function installFakeModel() {
  const availability = vi.fn(async () => "available");
  const prompt = vi.fn(async () => "A grey aircraft above white ice.");
  const create = vi.fn(async () => ({ prompt, destroy: vi.fn() }));
  vi.stubGlobal("LanguageModel", { availability, create });
  return { availability, create, prompt };
}

beforeEach(() => vi.unstubAllGlobals());

describe("promptApiImageDescriber", () => {
  it("names the output language on availability() and create()", async () => {
    const lm = installFakeModel();
    const d = promptApiImageDescriber();
    expect(await d.available()).toBe(true);
    await d.describe({ src: "https://e.test/a.jpg", dataUrl: "data:image/jpeg;base64,/9j/" });

    const calls = [lm.availability.mock.calls[0], lm.create.mock.calls[0]] as unknown as [unknown][];
    for (const call of calls) {
      const o = call[0] as { outputLanguage?: string; expectedInputs?: unknown; expectedOutputs?: { languages?: string[] }[] };
      expect(o.outputLanguage).toBe("en");
      expect(o.expectedOutputs?.[0]?.languages).toEqual(["en"]);
      expect(o.expectedInputs).toEqual([{ type: "text", languages: ["en"] }, { type: "image" }]);
    }
  });

  it("reports unavailable instead of throwing when the API is missing or says so", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    expect(await promptApiImageDescriber().available()).toBe(false);
    vi.stubGlobal("LanguageModel", { availability: async () => "downloadable", create: vi.fn() });
    expect(await promptApiImageDescriber().available()).toBe(false);
  });
});
