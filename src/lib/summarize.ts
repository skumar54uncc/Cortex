/** Chrome Summarizer API when present; otherwise excerpt fallback */
export async function summarizeBestEffort(text: string): Promise<string> {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 220) return cleaned;

  const ai = (
    globalThis as unknown as {
      ai?: {
        summarizer?: {
          capabilities?: () => Promise<{ available: string }>;
          create?: (opts?: object) => Promise<{
            summarize: (s: string) => Promise<string>;
          }>;
        };
      };
    }
  ).ai;

  try {
    const summ = ai?.summarizer;
    if (summ?.create) {
      const caps = await summ.capabilities?.();
      if (caps?.available === "readily" || caps?.available === "after-download") {
        const model = await summ.create({
          type: "tl;dr",
          format: "plain-text",
          length: "short",
        });
        const out = await model.summarize(cleaned.slice(0, 12000));
        if (out?.trim()) return out.trim().slice(0, 400);
      }
    }
  } catch {
    /* fall through */
  }

  const slice = cleaned.slice(0, 240);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > 80 ? slice.slice(0, lastSpace) : slice;
  return `${head}…`;
}
