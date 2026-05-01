import { db, type DocumentRecord } from "../../db/schema";
import {
  decideRoute,
  streamAnswer,
  type RouteDecision,
} from "./llm-router";
import { getDigestFromCache, saveDigestToCache } from "./digest-cache";
import type { ChunkWithDoc } from "../search-engine";
import type { DigestRequest, DigestResult } from "./digest-types";
import type { ChatSettings } from "./types";
import type { ParsedQuestion } from "./question-parser";

const DIGEST_SYSTEM_PROMPT = `You are Cortex, generating a "what I read" digest.

You will be given the titles, summaries, and key passages from webpages a user
visited during a specific time period. Your job is to produce a structured digest
in this exact format:

NARRATIVE: [2-3 sentences describing the user's reading focus during this period]

TOPICS:
- [Topic name] ([N] pages)
- [Topic name] ([N] pages)
(3-5 topics, ordered by importance)

INSIGHTS:
- [Specific insight or finding] [1]
- [Specific insight or finding] [2]
(2-4 insights, each citing one source by [N])

CRITICAL RULES:
- Be specific. "AI agents" is not a topic. "Multi-agent orchestration with LangGraph" is.
- Insights must be substantive, not generic.
- Every insight cites exactly one source.
- Do not invent. Only state what's in the sources.
- Match the user's voice: if they read technical content, write technically.`;

function resolveRange(range: DigestRequest["range"]) {
  const now = new Date();
  if (range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { from: start, to: now };
  }
  if (range === "yesterday") {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { from: start, to: end };
  }
  const start = new Date();
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  return { from: start, to: now };
}

async function getRepresentativeChunks(
  docs: DocumentRecord[]
): Promise<ChunkWithDoc[]> {
  const result: ChunkWithDoc[] = [];
  for (const doc of docs) {
    if (doc.id == null) continue;
    const chunks = await db.chunks
      .where("documentId")
      .equals(doc.id)
      .toArray();
    if (chunks.length === 0) continue;
    const best = [...chunks].sort((a, b) => b.text.length - a.text.length)[0];
    if (!best?.id) continue;
    result.push({ ...best, document: doc });
  }
  return result;
}

function selectChunksForDigest(
  chunks: ChunkWithDoc[],
  maxChars: number
): ChunkWithDoc[] {
  const sorted = [...chunks].sort((a, b) => {
    const importanceDiff =
      (b.document.importanceScore || 0) - (a.document.importanceScore || 0);
    if (Math.abs(importanceDiff) > 0.1) return importanceDiff;
    return b.document.lastVisitedAt - a.document.lastVisitedAt;
  });

  const selected: ChunkWithDoc[] = [];
  let used = 0;
  for (const chunk of sorted) {
    const size = Math.min(chunk.text.length, 600) + 300;
    if (used + size > maxChars - 2000) break;
    selected.push(chunk);
    used += size;
  }
  return selected;
}

function buildDigestPrompt(
  chunks: ChunkWithDoc[],
  range: { from: Date; to: Date }
): string {
  const sources = chunks
    .map(
      (c, i) =>
        `[${i + 1}] "${c.document.title}" (${c.document.domain})
${c.text.slice(0, 600)}`
    )
    .join("\n\n---\n\n");

  return `Time period: ${range.from.toISOString().split("T")[0]} to ${range.to.toISOString().split("T")[0]}
Representative passages from ${chunks.length} visits:

SOURCES:

${sources}

Generate the digest now in the required format.`;
}

interface ParsedDigest {
  narrative: string;
  topics: Array<{ topic: string; pageCount: number }>;
  insights: Array<{ text: string; sourceUrl: string; sourceTitle: string }>;
}

/** Exported for tests / eval harness — parses LLM digest layout. */
export function parseDigestOutput(raw: string, chunks: ChunkWithDoc[]): ParsedDigest {
  const narrativeMatch = raw.match(
    /NARRATIVE:\s*([\s\S]*?)(?=\n\s*TOPICS\s*:|\nTOPICS\s*:)/i
  );
  const topicsMatch = raw.match(
    /TOPICS:\s*([\s\S]*?)(?=\n\s*INSIGHTS\s*:|\nINSIGHTS\s*:)/i
  );
  const insightsMatch = raw.match(/INSIGHTS:\s*([\s\S]*)/i);

  const topics = (topicsMatch?.[1] || "")
    .split("\n")
    .map((line) => {
      const m = line.match(/^[-*]\s*(.+?)\s*\((\d+)\s*pages?\)/i);
      if (!m) return null;
      return { topic: m[1]!.trim(), pageCount: parseInt(m[2]!, 10) };
    })
    .filter(Boolean) as Array<{ topic: string; pageCount: number }>;

  const insights = (insightsMatch?.[1] || "")
    .split("\n")
    .map((line) => {
      const m = line.match(/^[-*]\s*(.+?)\s*\[(\d+)\]/);
      if (!m) return null;
      const citation = parseInt(m[2]!, 10);
      const source = chunks[citation - 1];
      if (!source) return null;
      return {
        text: m[1]!.trim(),
        sourceUrl: source.document.url,
        sourceTitle: source.document.title,
      };
    })
    .filter(Boolean) as Array<{
    text: string;
    sourceUrl: string;
    sourceTitle: string;
  }>;

  return {
    narrative:
      narrativeMatch?.[1]?.trim().replace(/\s+/g, " ") ||
      "No summary generated.",
    topics,
    insights,
  };
}

export async function generateDigest(
  request: DigestRequest,
  settings: ChatSettings
): Promise<DigestResult> {
  if (!request.forceRegenerate) {
    const cached = await getDigestFromCache(request.range);
    if (cached && Date.now() - cached.generatedAt < 30 * 60 * 1000) {
      return cached;
    }
  }

  const range = resolveRange(request.range);

  const docs = await db.documents
    .where("lastVisitedAt")
    .between(range.from.getTime(), range.to.getTime(), true, true)
    .toArray();

  if (docs.length === 0) {
    const label =
      request.range === "today"
        ? "today"
        : request.range === "yesterday"
          ? "yesterday"
          : "in the last 7 days";
    return {
      range: request.range,
      generatedAt: Date.now(),
      pageCount: 0,
      domainsCount: 0,
      narrative: `You didn't visit any pages ${label} that Cortex indexed. Browse some content and try again.`,
      topics: [],
      insights: [],
      sources: [],
    };
  }

  const chunks = await getRepresentativeChunks(docs);
  const maxChars =
    settings.cloudEnabled && settings.geminiApiKey ? 200_000 : 18_000;
  const packed = selectChunksForDigest(chunks, maxChars);

  const prompt = buildDigestPrompt(packed, range);

  const fakeQuestion: ParsedQuestion = {
    rawQuery: "",
    searchQuery: "",
    intent: "summarize_period",
    estimatedComplexity: "high",
    timeRange: undefined,
  };

  const route: RouteDecision = await decideRoute(
    prompt,
    fakeQuestion,
    settings
  );

  let rawOut = "";
  for await (const token of streamAnswer(
    prompt,
    DIGEST_SYSTEM_PROMPT,
    route,
    settings
  )) {
    rawOut += token;
  }

  const parsedOut = parseDigestOutput(rawOut, packed);

  const result: DigestResult = {
    range: request.range,
    generatedAt: Date.now(),
    pageCount: docs.length,
    domainsCount: new Set(docs.map((d) => d.domain)).size,
    narrative: parsedOut.narrative,
    topics: parsedOut.topics,
    insights: parsedOut.insights,
    sources: docs.slice(0, 24).map((d) => ({
      url: d.url,
      title: d.title,
      domain: d.domain,
      visitedAt: d.lastVisitedAt,
    })),
  };

  await saveDigestToCache(request.range, result);
  return result;
}
