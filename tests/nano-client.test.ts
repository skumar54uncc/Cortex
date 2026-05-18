import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isNanoAvailable,
  NANO_OUTPUT_LANGUAGE,
  resetNanoAvailabilityCacheForTests,
} from "../src/lib/chat/nano-client";

describe("nano-client", () => {
  afterEach(() => {
    resetNanoAvailabilityCacheForTests();
    // @ts-expect-error test cleanup
    delete globalThis.window;
  });

  it("defaults output language to English for Chrome Prompt API", () => {
    expect(NANO_OUTPUT_LANGUAGE).toBe("en");
  });

  it("passes outputLanguage to LanguageModel.availability", async () => {
    const availability = vi.fn().mockResolvedValue("available");
    globalThis.window = {
      LanguageModel: { availability },
    } as unknown as Window & typeof globalThis;

    await isNanoAvailable();

    expect(availability).toHaveBeenCalledWith({ outputLanguage: "en" });
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
