declare global {
  interface Window {
    LanguageModel?: {
      availability(): Promise<
        "unavailable" | "downloadable" | "downloading" | "available"
      >;
      params(): Promise<{
        defaultTopK: number;
        maxTopK: number;
        defaultTemperature: number;
        maxTemperature: number;
      }>;
      create(options?: {
        initialPrompts?: Array<{
          role: "system" | "user" | "assistant";
          content: string;
        }>;
        temperature?: number;
        topK?: number;
        monitor?: (m: unknown) => void;
      }): Promise<LanguageModelSession>;
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

export async function isNanoAvailable(): Promise<{
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

  try {
    const status = await window.LanguageModel.availability();
    return {
      available: status === "available",
      status,
      reason:
        status === "downloadable"
          ? "Model needs to be downloaded (one-time, large download)."
          : status === "downloading"
            ? "Model is currently downloading."
            : status === "unavailable"
              ? "Built-in AI not available on this device."
              : undefined,
    };
  } catch (e) {
    return { available: false, status: "unavailable", reason: String(e) };
  }
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
