import type { ChunkWithDoc } from "../search-engine";

export const CHAT_SYSTEM_PROMPT = `You are Cortex, a personal browser memory assistant.

You answer questions using ONLY the sources provided. Each source is content from a
webpage the user actually visited.

CRITICAL RULES:
1. Cite sources inline using [N] markers. Every factual claim needs a citation.
2. If the answer isn't in the sources, say "I don't have anything in your library
   about that" — do NOT invent answers.
3. When the user asks "which website said X", give them the URL and a short quote.
4. For summaries, use this structure:
   - One paragraph overview
   - 3-5 bullet points with citations
   - End with the date range you covered
5. Be concise. Do not pad. Do not add disclaimers.
6. Use the user's own words from the sources where possible.`;

export interface BuildPromptInput {
  question: string;
  chunks: ChunkWithDoc[];
  timeContext?: string;
}

export function buildChatPrompt(input: BuildPromptInput): string {
  const today = new Date().toISOString().split("T")[0];

  const sources = input.chunks.map((c, i) => ({
    n: i + 1,
    title: c.document.title,
    url: c.document.url,
    domain: c.document.domain,
    visitedAt: new Date(c.document.lastVisitedAt).toISOString().split("T")[0],
    text: truncateChunk(c.text, 800),
  }));

  const sourcesBlock = sources
    .map(
      (s) =>
        `[${s.n}] "${s.title}" (${s.domain}, visited ${s.visitedAt})
URL: ${s.url}
Content: ${s.text}`
    )
    .join("\n\n---\n\n");

  return `Today is ${today}.${input.timeContext ? ` The user is asking about ${input.timeContext}.` : ""}

SOURCES FROM USER'S LIBRARY:

${sourcesBlock}

USER QUESTION: ${input.question}

ANSWER (with [N] citations):`;
}

function truncateChunk(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).replace(/\s\S*$/, "")}...`;
}

export function selectChunksForBudget(
  chunks: ChunkWithDoc[],
  maxPromptChars: number,
  questionChars: number
): ChunkWithDoc[] {
  const overhead = 1500;
  const availableForChunks = maxPromptChars - questionChars - overhead;
  const selected: ChunkWithDoc[] = [];
  let used = 0;

  for (const chunk of chunks) {
    const chunkSize = chunk.text.length + 200;
    if (used + chunkSize > availableForChunks) break;
    selected.push(chunk);
    used += chunkSize;
  }

  return selected;
}
