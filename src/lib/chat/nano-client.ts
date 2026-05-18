/** Chrome Prompt API — required on availability() and create() (en | es | ja). */
export type NanoOutputLanguage = "en" | "es" | "ja";

export const NANO_OUTPUT_LANGUAGE: NanoOutputLanguage = "en";

const NANO_AVAILABILITY_CACHE_MS = 60_000;

let nanoAvailabilityCache: {
  at: number;
  result: Awaited<ReturnType<typeof isNanoAvailableUncached>>;
} | null = null;

type LanguageModelRequestOptions = {
  outputLanguage?: NanoOutputLanguage;
  language?: NanoOutputLanguage;
  initialPrompts?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  topK?: number;
  monitor?: (m: unknown) => void;
};

declare global {
  interface Window {
    LanguageModel?: {
      availability(
        options?: Pick<LanguageModelRequestOptions, "outputLanguage">
      ): Promise<
        "unavailable" | "downloadable" | "downloading" | "available"
      >;
      params(): Promise<{
        defaultTopK: number;
        maxTopK: number;
        defaultTemperature: number;
        maxTemperature: number;
      }>;
      create(
        options?: LanguageModelRequestOptions
      ): Promise<LanguageModelSession>;
    };
  }

  interface LanguageModelSession {
    prompt(input: string): Promise<string>;
    promptStreaming(input: string): ReadableStream<string>;
    destroy(): void;
    inputUsage: number;
    inputQuota: number;
  }
}

async function isNanoAvailableUncached(): Promise<{
  available: boolean;
  status: "unavailable" | "downloadable" | "downloading" | "available";
  reason?: string;
}> {
  if (typeof window === "undefined" || !window.LanguageModel) {
    return {
      available: false,
      status: "unavailable",
      reason:
        "Chrome built-in AI is not available in this browser (enable Prompt API / Gemini Nano in Chrome settings).",
    };
  }

  const lmOptions = { outputLanguage: NANO_OUTPUT_LANGUAGE } as const;
  const diskHint =
    "Free disk space or use Cloud mode with a Gemini API key in Settings.";

  try {
    const status = await window.LanguageModel.availability(lmOptions);
    return {
      available: status === "available",
      status,
      reason:
        status === "downloadable"
          ? `On-device model is not installed yet. ${diskHint}`
          : status === "downloading"
            ? "Model is currently downloading."
            : status === "unavailable"
              ? `Built-in AI is not available on this device. ${diskHint}`
              : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const disk =
      /not enough space|insufficient storage|disk full/i.test(msg);
    return {
      available: false,
      status: "unavailable",
      reason: disk
        ? `Not enough disk space for the on-device model. ${diskHint}`
        : msg,
    };
  }
}

export async function isNanoAvailable(): Promise<{
  available: boolean;
  status: "unavailable" | "downloadable" | "downloading" | "available";
  reason?: string;
}> {
  const now = Date.now();
  if (
    nanoAvailabilityCache &&
    now - nanoAvailabilityCache.at < NANO_AVAILABILITY_CACHE_MS
  ) {
    return nanoAvailabilityCache.result;
  }
  const result = await isNanoAvailableUncached();
  nanoAvailabilityCache = { at: now, result };
  return result;
}

/** Vitest — reset availability cache between cases. */
export function resetNanoAvailabilityCacheForTests(): void {
  nanoAvailabilityCache = null;
}

export interface NanoSession {
  prompt: (input: string) => AsyncIterable<string>;
  destroy: () => void;
  tokensUsed: () => number;
  tokensRemaining: () => number;
}

export async function createNanoSession(
  systemPrompt?: string
): Promise<NanoSession> {
  if (!window.LanguageModel) {
    throw new Error("Chrome built-in AI not available");
  }

  const session = await window.LanguageModel.create({
    outputLanguage: NANO_OUTPUT_LANGUAGE,
    language: NANO_OUTPUT_LANGUAGE,
    initialPrompts: systemPrompt
      ? [{ role: "system", content: systemPrompt }]
      : undefined,
    temperature: 0.3,
  });

  return {
    prompt: async function* (input: string): AsyncIterable<string> {
      const stream = session.promptStreaming(input);
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
    destroy: () => session.destroy(),
    tokensUsed: () => session.inputUsage,
    tokensRemaining: () => session.inputQuota - session.inputUsage,
  };
}
