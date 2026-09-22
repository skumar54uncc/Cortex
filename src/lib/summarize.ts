/**
 * Page summaries. Chrome's Summarizer API when the model is installed,
 * otherwise the opening of the page.
 *
 * Chrome moved this API from the `ai.summarizer` namespace to a `Summarizer`
 * global; the old name never matched again, so every summary silently became
 * an excerpt. Both are tried, newest first. Like the Prompt API, the request
 * names its output language, which is what Chrome logs a warning about.
 *
 * On device either way: no network call and nothing leaves the machine.
 */
import { stripIndexedTextNoise } from "./capture/text-noise";

const SUMMARY_MIN_CHARS = 220;
const SUMMARY_INPUT_CHARS = 12000;
const SUMMARY_MAX_CHARS = 400;
const EXCERPT_CHARS = 240;

interface SummarizerSession {
  summarize: (input: string) => Promise<string>;
  destroy?: () => void;
}

const CREATE_OPTIONS = {
  type: "tldr",
  format: "plain-text",
  length: "short",
  outputLanguage: "en",
} as const;

interface SummarizerGlobal {
  availability?: () => Promise<string>;
  capabilities?: () => Promise<{ available: string }>;
  create?: (opts?: object) => Promise<SummarizerSession>;
}

/** The current global, then the namespace older Chrome versions used. */
function summarizerApi(): SummarizerGlobal | undefined {
  const g = globalThis as unknown as {
    Summarizer?: SummarizerGlobal;
    ai?: { summarizer?: SummarizerGlobal };
  };
  return g.Summarizer ?? g.ai?.summarizer;
}

async function installedModel(api: SummarizerGlobal): Promise<boolean> {
  if (api.availability) return (await api.availability()) === "available";
  const caps = await api.capabilities?.();
  return caps?.available === "readily";
}

function excerpt(cleaned: string): string {
  const slice = cleaned.slice(0, EXCERPT_CHARS);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > 80 ? slice.slice(0, lastSpace) : slice;
  return `${head}…`;
}

export async function summarizeBestEffort(text: string): Promise<string> {
  // Skip links and other chrome read as the first sentence of the page.
  const cleaned = stripIndexedTextNoise(String(text ?? ""), "");
  if (cleaned.length <= SUMMARY_MIN_CHARS) return cleaned;

  try {
    const api = summarizerApi();
    if (api?.create && (await installedModel(api))) {
      const model = await api.create(CREATE_OPTIONS);
      try {
        const out = await model.summarize(cleaned.slice(0, SUMMARY_INPUT_CHARS));
        if (out?.trim()) return out.trim().slice(0, SUMMARY_MAX_CHARS);
      } finally {
        model.destroy?.();
      }
    }
  } catch {
    /* fall through to the excerpt */
  }

  return excerpt(cleaned);
}
