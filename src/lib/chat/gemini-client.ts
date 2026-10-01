/**
 * Cloud models, in order. The first is the one we want. The rest are tried
 * when that model is missing, rate-limited, or overloaded.
 */
export const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
] as const;

/** Primary cloud model. Kept for callers that only need the preferred id. */
export const GEMINI_MODEL = GEMINI_MODELS[0];

/** Statuses where another model may succeed. A bad key or a bad prompt will not. */
export function geminiStatusIsFallback(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function modelUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;
}

export interface GeminiOptions {
  apiKey: string;
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Cancels the request and the SSE read (CORTEX_CHAT_ABORT). */
  signal?: AbortSignal;
}

function sanitizeGeminiErrorBody(body: string, maxLen = 240): string {
  const scrubbed = body
    .replace(/key=AIza[0-9A-Za-z_-]+/gi, "key=[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]");
  return scrubbed.length > maxLen ? `${scrubbed.slice(0, maxLen)}…` : scrubbed;
}

class GeminiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

function friendlyGeminiFailure(status: number): string {
  if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504) {
    return "Gemini is busy right now. Try again in a moment.";
  }
  if (status === 404) return "No Gemini model on this API key could answer.";
  if (status === 401 || status === 403) {
    return "The Gemini API key was rejected. Check it in Cortex settings.";
  }
  return "Gemini could not answer just now.";
}

async function* streamGeminiModel(
  model: string,
  prompt: string,
  options: GeminiOptions
): AsyncIterable<string> {
  const url = `${modelUrl(model)}?alt=sse`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: options.systemPrompt
      ? { parts: [{ text: options.systemPrompt }] }
      : undefined,
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxOutputTokens ?? 2048,
      // Gemini 3 counts thinking tokens against maxOutputTokens. Left on its
      // default, a digest is cut off mid sentence (the visible "On codepen.io").
      thinkingConfig: { thinkingLevel: "low" },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": options.apiKey,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new GeminiHttpError(
      `Gemini API error ${response.status}: ${sanitizeGeminiErrorBody(errorBody)}`,
      response.status
    );
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch {
        /* skip malformed SSE chunks */
      }
    }
  }
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function* geminiStream(
  prompt: string,
  options: GeminiOptions
): AsyncIterable<string> {
  let last: GeminiHttpError | null = null;
  for (const model of GEMINI_MODELS) {
    if (options.signal?.aborted) return;
    let yielded = false;
    try {
      for await (const chunk of streamGeminiModel(model, prompt, options)) {
        yielded = true;
        yield chunk;
      }
      return;
    } catch (e) {
      if (yielded) throw e;
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (e instanceof GeminiHttpError && geminiStatusIsFallback(e.status)) {
        last = e;
        continue;
      }
      throw e;
    }
  }
  throw new Error(last ? friendlyGeminiFailure(last.status) : "Gemini could not answer just now.");
}
