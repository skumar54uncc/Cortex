import type { ChunkWithDoc } from "../search-engine";
import { citationHref, snippetLabel } from "../kind-labels";

export const CHAT_SYSTEM_PROMPT = `You are Cortex, a personal browser memory assistant.

You answer questions using ONLY the sources provided. Each source is content from a
webpage the user actually visited.

CRITICAL RULES:
1. Cite sources inline using [N] markers. Every factual claim needs a citation.
2. If the answer isn't in the sources, say "I don't have anything in your library
   about that". Do NOT invent answers.
3. When the user asks "which website said X", give them the URL and a short quote.
4. For summaries, use this structure:
   - One paragraph overview
   - 3-5 bullet points with citations
   - End with the date range you covered
5. Be concise. Do not pad. Do not add disclaimers.
6. Use the user's own words from the sources where possible.`;

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface BuildPromptInput {
  question: string;
  chunks: ChunkWithDoc[];
  timeContext?: string;
  history?: ChatHistoryTurn[];
}

/** Prior turns for multi-turn Ask (most recent last, char-budgeted). */
export function selectHistoryForPrompt(
  turns: ChatHistoryTurn[],
  maxChars = 4_000
): ChatHistoryTurn[] {
  const out: ChatHistoryTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    const text = t.content.trim();
    if (!text) continue;
    const slice = text.length > 900 ? `${text.slice(0, 900)}…` : text;
    if (used + slice.length > maxChars && out.length > 0) break;
    out.unshift({ role: t.role, content: slice });
    used += slice.length;
  }
  return out;
}

const EVIDENCE_FILLER = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "what",
  "when",
  "where",
  "which",
  "have",
  "been",
  "about",
  "your",
  "did",
]);

function evidenceTerms(question: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of question.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || EVIDENCE_FILLER.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

function termOverlap(text: string, terms: string[]): number {
  const hay = text.toLowerCase();
  let n = 0;
  for (const term of terms) {
    if (hay.includes(term)) n += 1;
  }
  return n;
}

/**
 * Search returns the single best passage per page. Chat also needs the other
 * passages on those same pages that share the question's words, so an answer
 * buried later in an article is not dropped.
 */
export function expandChatEvidence(
  hits: ChunkWithDoc[],
  pageChunks: ChunkWithDoc[],
  question: string,
  extraPerDoc = 2
): ChunkWithDoc[] {
  const terms = evidenceTerms(question);
  const byDoc = new Map<number, ChunkWithDoc[]>();
  for (const chunk of pageChunks) {
    const list = byDoc.get(chunk.documentId) ?? [];
    list.push(chunk);
    byDoc.set(chunk.documentId, list);
  }

  const out: ChunkWithDoc[] = [];
  const seen = new Set<number>();
  for (const hit of hits) {
    if (hit.id != null) seen.add(hit.id);
    out.push(hit);
    if (terms.length === 0) continue;
    const extras = (byDoc.get(hit.documentId) ?? [])
      .filter((chunk) => chunk.id == null || !seen.has(chunk.id))
      .map((chunk) => ({ chunk, score: termOverlap(chunk.text, terms) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.ord - b.chunk.ord)
      .slice(0, extraPerDoc);
    for (const row of extras) {
      if (row.chunk.id != null) seen.add(row.chunk.id);
      out.push(row.chunk);
    }
  }
  return out;
}

export function buildChatPrompt(input: BuildPromptInput): string {
  const today = new Date().toISOString().split("T")[0];
  const summaryShown = new Set<number>();

  const sources = input.chunks.map((c, i) => {
    const showSummary = !summaryShown.has(c.documentId);
    summaryShown.add(c.documentId);
    const summary = c.document.summary?.trim() ?? "";
    return {
      n: i + 1,
      // Kind and locator (release 1.2.0): "(video 12:40 to 13:40)", "(PDF page 4)".
      label: snippetLabel(c),
      title: c.document.title,
      url: citationHref(c, c.document.url) ?? c.document.url,
      domain: c.document.domain,
      visitedAt: new Date(c.document.lastVisitedAt).toISOString().split("T")[0],
      text: truncateChunk(c.text, 800),
      summary: showSummary && summary ? truncateChunk(summary, 500) : "",
    };
  });

  const sourcesBlock = sources
    .map((s) => {
      const summaryLine = s.summary ? `\nPage summary: ${s.summary}` : "";
      return `[${s.n}]${s.label ? ` (${s.label})` : ""} "${s.title}" (${s.domain}, visited ${s.visitedAt})
URL: ${s.url}${summaryLine}
Content: ${s.text}`;
    })
    .join("\n\n---\n\n");

  const historyBlock =
    input.history && input.history.length > 0
      ? `\n\nPREVIOUS MESSAGES IN THIS CHAT (for context only; still cite [N] from SOURCES below):\n${input.history
          .map(
            (h) =>
              `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`
          )
          .join("\n\n")}\n`
      : "";

  return `Today is ${today}.${input.timeContext ? ` The user is asking about ${input.timeContext}.` : ""}
${historyBlock}
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
