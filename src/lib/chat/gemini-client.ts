const GEMINI_STREAM_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent";

export interface GeminiOptions {
  apiKey: string;
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

function sanitizeGeminiErrorBody(body: string, maxLen = 240): string {
  const scrubbed = body
    .replace(/key=AIza[0-9A-Za-z_-]+/gi, "key=[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]");
  return scrubbed.length > maxLen ? `${scrubbed.slice(0, maxLen)}…` : scrubbed;
}

export async function* geminiStream(
  prompt: string,
  options: GeminiOptions
): AsyncIterable<string> {
  const url = `${GEMINI_STREAM_URL}?alt=sse`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: options.systemPrompt
      ? { parts: [{ text: options.systemPrompt }] }
      : undefined,
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxOutputTokens ?? 2048,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": options.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Gemini API error ${response.status}: ${sanitizeGeminiErrorBody(errorBody)}`
    );
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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
}
