import { isNanoAvailable, createNanoSession } from "./nano-client";
import { geminiStream } from "./gemini-client";
import type { ParsedQuestion } from "./question-parser";
import type { ChatSettings } from "./types";

export interface RouteDecision {
  provider: "nano" | "cloud";
  reason: string;
}

const NANO_MAX_PROMPT_CHARS = 18_000;

/** Public Google AI Studio URL — safe to show in UI copy */
export const GEMINI_API_KEY_HELP_URL = "https://aistudio.google.com/apikey";

export class ChatUnavailableError extends Error {
  constructor(
    message: string,
    public userAction: string
  ) {
    super(message);
    this.name = "ChatUnavailableError";
  }
}

function cloudKeyMissingOrDisabled(settings: ChatSettings): ChatUnavailableError {
  if (!settings.cloudEnabled) {
    return new ChatUnavailableError(
      "Cloud chat is turned off.",
      `Turn on "Enable cloud chat" in Cortex settings, then add your free Gemini API key from Google AI Studio: ${GEMINI_API_KEY_HELP_URL}`
    );
  }
  return new ChatUnavailableError(
    "You haven't added a Gemini API key yet.",
    `Create a free API key from Google (AI Studio), open Cortex settings → Chat with your library, and paste it there: ${GEMINI_API_KEY_HELP_URL}`
  );
}

export async function decideRoute(
  prompt: string,
  question: ParsedQuestion,
  settings: ChatSettings
): Promise<RouteDecision> {
  if (settings.mode === "on-device-only") {
    const nanoStatus = await isNanoAvailable();
    if (!nanoStatus.available) {
      throw new ChatUnavailableError(
        nanoStatus.reason || "On-device AI unavailable",
        "Switch to Auto or Cloud mode in settings, or wait for Chrome built-in AI to finish setup."
      );
    }
    return { provider: "nano", reason: "forced_on_device" };
  }

  if (settings.mode === "cloud-only") {
    if (!settings.cloudEnabled || !settings.geminiApiKey.trim()) {
      throw cloudKeyMissingOrDisabled(settings);
    }
    return { provider: "cloud", reason: "forced_cloud" };
  }

  const nanoStatus = await isNanoAvailable();
  const promptFitsInNano = prompt.length < NANO_MAX_PROMPT_CHARS;
  const isComplex = question.estimatedComplexity === "high";

  if (nanoStatus.available && promptFitsInNano && !isComplex) {
    return { provider: "nano", reason: "auto_nano_fits" };
  }

  if (settings.cloudEnabled && settings.geminiApiKey.trim()) {
    return {
      provider: "cloud",
      reason: nanoStatus.available
        ? isComplex
          ? "auto_cloud_complex_question"
          : "auto_cloud_prompt_too_long"
        : "auto_cloud_nano_unavailable",
    };
  }

  throw cloudKeyMissingOrDisabled(settings);
}

export async function* streamAnswer(
  prompt: string,
  systemPrompt: string,
  decision: RouteDecision,
  settings: ChatSettings
): AsyncIterable<string> {
  if (decision.provider === "nano") {
    const session = await createNanoSession(systemPrompt);
    try {
      for await (const chunk of session.prompt(prompt)) {
        yield chunk;
      }
    } finally {
      session.destroy();
    }
  } else {
    yield* geminiStream(prompt, {
      apiKey: settings.geminiApiKey,
      systemPrompt,
      temperature: 0.3,
      maxOutputTokens: 2048,
    });
  }
}
