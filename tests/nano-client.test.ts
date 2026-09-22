import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNanoSession,
  isNanoAvailable,
  NANO_OUTPUT_LANGUAGE,
  resetNanoAvailabilityCacheForTests,
} from "../src/lib/chat/nano-client";

/**
 * Chrome takes the output language in `expectedOutputs`, not in an
 * `outputLanguage` field: that one is Summarizer's. Sending the wrong field
 * left every chat request unlabelled, and Chrome logged "No output language
 * was specified in a LanguageModel API request" against offscreen.html.
 */
function expectsEnglish(options: unknown): void {
  const o = options as {
    expectedInputs?: { type: string; languages?: string[] }[];
    expectedOutputs?: { type: string; languages?: string[] }[];
  };
  expect(o.expectedOutputs).toEqual([{ type: "text", languages: ["en"] }]);
  expect(o.expectedInputs).toEqual([{ type: "text", languages: ["en"] }]);
}

describe("nano-client", () => {
  afterEach(() => {
    resetNanoAvailabilityCacheForTests();
    // @ts-expect-error test cleanup
    delete globalThis.window;
  });

  it("defaults output language to English for Chrome Prompt API", () => {
    expect(NANO_OUTPUT_LANGUAGE).toBe("en");
  });

  it("names the output language on LanguageModel.availability", async () => {
    const availability = vi.fn().mockResolvedValue("available");
    globalThis.window = {
      LanguageModel: { availability },
    } as unknown as Window & typeof globalThis;

    await isNanoAvailable();

    expectsEnglish(availability.mock.calls[0]![0]);
  });

  it("names the output language on LanguageModel.create", async () => {
    const create = vi.fn().mockResolvedValue({
      promptStreaming: () => new ReadableStream(),
      destroy: vi.fn(),
      inputUsage: 0,
      inputQuota: 10,
    });
    globalThis.window = {
      LanguageModel: { availability: vi.fn().mockResolvedValue("available"), create },
    } as unknown as Window & typeof globalThis;

    await createNanoSession("system prompt");

    const options = create.mock.calls[0]![0] as { initialPrompts?: unknown[] };
    expectsEnglish(options);
    expect(options.initialPrompts).toEqual([{ role: "system", content: "system prompt" }]);
  });

  it("caches availability checks", async () => {
    const availability = vi.fn().mockResolvedValue("unavailable");
    globalThis.window = {
      LanguageModel: { availability },
    } as unknown as Window & typeof globalThis;

    await isNanoAvailable();
    await isNanoAvailable();

    expect(availability).toHaveBeenCalledTimes(1);
  });
});
