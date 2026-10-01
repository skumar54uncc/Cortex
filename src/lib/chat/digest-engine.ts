import { db, type DocumentRecord } from "../../db/schema";
import {
  decideRoute,
  streamAnswer,
  type RouteDecision,
} from "./llm-router";
import { getDigestFromCache, saveDigestToCache } from "./digest-cache";
import type { ChunkWithDoc } from "../search-engine";
import { citationHref } from "../kind-labels";
import { safeHttpHttpsHref } from "../url-security";
import {
  cleanSourceTitle,
  extractCitationIndexes,
  pageLabel,
  personalizeDigestNarrative,
  pickSitePages,
  splitNarrativeSentences,
  stripDigestMarkdown,
} from "./digest-format";
import {
  DIGEST_SCHEMA_VERSION,
  type DigestDomainGroup,
  type DigestInsight,
  type DigestNarrativePart,
  type DigestRequest,
  type DigestResult,
  type DigestSource,
} from "./digest-types";
import type { ChatSettings } from "./types";
import type { ParsedQuestion } from "./question-parser";

/** Exported for tests and the eval harness. */
export const DIGEST_SYSTEM_PROMPT = `You are Cortex, generating a "what I read" digest.

You will be given the titles, summaries, and key passages from webpages a user
visited during a specific time period, each one numbered. Your job is to produce
a structured digest in this exact format:

NARRATIVE: [2-4 sentences in second person, starting with "Your recent reading focused on..." and never say "The user". Name the sites, one sentence per site, and cite them: "On linkedin.com you read 3 profiles [1][2][3]." "On amazon.com you compared two deals [4][5]."]

TOPICS:
- [Topic name] ([N] pages)
- [Topic name] ([N] pages)
(3-5 topics, ordered by importance)

INSIGHTS:
- [Specific insight or finding] [1]
- [Specific insight or finding] [2]
(2-4 insights, each citing one source by [N])

CITATION RULES:
- Cite sources inline with [N] markers, where N is the number of a source in
  the SOURCES list. Use only numbers that appear in that list. Never invent one.
- Every narrative sentence after the first must name a site and end with at
  least one [N] marker, for example "On news.ycombinator.com you followed one
  thread [4]." Use the site names and counts from the SITES list.
- Every insight cites exactly one source by [N].
- Plain text only. No markdown bold, no headings, no markdown links.

CRITICAL RULES:
- Be specific. "AI agents" is not a topic. "Multi-agent orchestration with LangGraph" is.
- Insights must be substantive, not generic.
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

function domainOf(source: { domain: string; url: string }): string {
  if (source.domain) return source.domain;
  try {
    return new URL(source.url).hostname;
  } catch {
    return "";
  }
}

interface NumberedChunk {
  source: DigestSource;
  chunk: ChunkWithDoc;
}

function numberChunks(chunks: ChunkWithDoc[]): NumberedChunk[] {
  const out: NumberedChunk[] = [];
  for (const c of chunks ?? []) {
    const doc = c?.document;
    if (!doc) continue;
    // citationHref points a video or PDF citation at the exact moment or page.
    const preferred = citationHref(c, doc.url ?? "");
    const url =
      (preferred ? safeHttpHttpsHref(preferred) : null) ??
      safeHttpHttpsHref(doc.url ?? "");
    if (!url) continue;
    const domain = domainOf({ domain: doc.domain ?? "", url });
    out.push({
      chunk: c,
      source: {
        n: out.length + 1,
        url,
        title: cleanSourceTitle(doc.title || domain),
        domain,
        visitedAt: doc.lastVisitedAt ?? 0,
      },
    });
  }
  return out;
}

/**
 * The numbered source list: what the model sees as [N] and what every
 * sourceIndexes value in the result points at. Order is the incoming chunk
 * order (importance first), so [1] is the most important page. Any page whose
 * URL does not survive safeHttpHttpsHref is dropped before numbering, so the
 * numbers stay contiguous and every url in the result is a real http(s) link.
 */
/**
 * How many pages of the period the digest carries. The per-site counts and
 * the "show all pages" list come from this, so it must cover a busy day
 * rather than only the pages the model cited.
 */
export const DIGEST_SOURCE_CAP = 200;

export function buildDigestSources(chunks: ChunkWithDoc[]): DigestSource[] {
  return numberChunks(chunks).map((n) => n.source);
}

/** A plain document (no chunk) as an extra, never-cited entry in the sources list. */
function sourceFromDoc(doc: DocumentRecord, n: number): DigestSource | null {
  const url = safeHttpHttpsHref(doc.url ?? "");
  if (!url) return null;
  const domain = domainOf({ domain: doc.domain ?? "", url });
  return {
    n,
    url,
    title: cleanSourceTitle(doc.title || domain),
    domain,
    visitedAt: doc.lastVisitedAt ?? 0,
  };
}

/** Per-site counts with example source numbers, busiest site first. */
export function groupSourcesByDomain(
  sources: DigestSource[]
): DigestDomainGroup[] {
  const byDomain = new Map<string, DigestDomainGroup>();
  for (const s of sources) {
    const domain = s.domain || "unknown";
    const group = byDomain.get(domain);
    if (group) {
      group.count += 1;
      if (group.sourceIndexes.length < 6) group.sourceIndexes.push(s.n);
    } else {
      byDomain.set(domain, { domain, count: 1, sourceIndexes: [s.n] });
    }
  }
  return [...byDomain.values()].sort(
    (a, b) => b.count - a.count || a.domain.localeCompare(b.domain)
  );
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * A reading-focus paragraph built only from the library, used when every
 * model is unavailable. It names the busiest sites and a few real page
 * titles. Sentences stay free of [N] markers; citations are the source
 * indexes the UI renders as chips.
 */
export function localReadingFocus(
  groups: DigestDomainGroup[],
  sources: DigestSource[]
): {
  narrative: string;
  narrativeParts: DigestNarrativePart[];
} {
  if (groups.length === 0) {
    const text = "Cortex saved pages for this period, but none of them could be summarized.";
    return { narrative: text, narrativeParts: [{ text, sourceIndexes: [] }] };
  }
  const byDomain = new Map<string, DigestSource[]>();
  for (const source of sources) {
    const list = byDomain.get(source.domain) ?? [];
    list.push(source);
    byDomain.set(source.domain, list);
  }
  const focus = joinNames(groups.slice(0, 3).map((g) => g.domain));
  const parts: DigestNarrativePart[] = [
    { text: `Your recent reading focused on ${focus}.`, sourceIndexes: [] },
  ];
  for (const group of groups.slice(0, 3)) {
    const pool = byDomain.get(group.domain) ?? [];
    const named = pickSitePages(pool, 2);
    const titles = named.map((p) => pageLabel(p.title)).filter((t) => t && t !== "Untitled");
    const indexes = named
      .map((p) => pool.find((s) => s.url === p.url)?.n)
      .filter((n): n is number => typeof n === "number")
      .slice(0, 3);
    const pages = group.count === 1 ? "1 page" : `${group.count} pages`;
    const including = titles.length > 0 ? `, including ${joinNames(titles)}` : "";
    parts.push({
      text: `On ${group.domain} you read ${pages}${including}.`,
      sourceIndexes: indexes,
    });
  }
  return {
    narrative: parts.map((p) => p.text).join(" "),
    narrativeParts: parts,
  };
}

function sentenceIsFinished(text: string): boolean {
  return /[.!?]["')\]]*$/.test(text.trim());
}

function domainIsNamed(text: string, domain: string): boolean {
  const host = domain.replace(/^www\./i, "").toLowerCase();
  return text.toLowerCase().includes(host);
}

/**
 * A model reply can stop mid sentence once its output budget is spent.
 * Drop that fragment, then add a library sentence for every site it never named.
 */
export function finishReadingFocus(
  parts: DigestNarrativePart[],
  groups: DigestDomainGroup[],
  sources: DigestSource[]
): { narrative: string; narrativeParts: DigestNarrativePart[] } {
  const kept = parts.filter((p) => p.text.trim());
  while (kept.length > 1 && !sentenceIsFinished(kept[kept.length - 1]!.text)) {
    kept.pop();
  }
  if (kept.length === 0 || (kept.length === 1 && !sentenceIsFinished(kept[0]!.text))) {
    return localReadingFocus(groups, sources);
  }
  const covered = kept.map((p) => p.text).join(" ");
  const missing = groups.filter((g) => !domainIsNamed(covered, g.domain));
  const siteParts =
    missing.length > 0
      ? localReadingFocus(missing, sources).narrativeParts.filter((p) => p.text.startsWith("On "))
      : [];
  const narrativeParts = [...kept, ...siteParts];
  return {
    narrative: narrativeParts.map((p) => p.text).join(" "),
    narrativeParts,
  };
}

function sitesBlock(groups: DigestDomainGroup[]): string {
  return groups
    .map(
      (g) =>
        `- ${g.domain}: ${g.count} ${g.count === 1 ? "page" : "pages"} ${g.sourceIndexes
          .map((n) => `[${n}]`)
          .join("")}`
    )
    .join("\n");
}

/** Exported for tests: the numbered SOURCES and SITES blocks the model reads. */
export function buildDigestPrompt(
  chunks: ChunkWithDoc[],
  range: { from: Date; to: Date }
): string {
  const numbered = numberChunks(chunks);
  const sources = numbered.map((n) => n.source);

  const sourceBlocks = numbered.map(({ source, chunk }) => {
    const visited = new Date(source.visitedAt).toISOString().split("T")[0];
    return `[${source.n}] "${source.title}" (${source.domain}, visited ${visited})
URL: ${source.url}
Content: ${(chunk.text ?? "").slice(0, 600)}`;
  });

  const groups = groupSourcesByDomain(sources);

  return `Time period: ${range.from.toISOString().split("T")[0]} to ${range.to.toISOString().split("T")[0]}
Representative passages from ${sources.length} visits:

SITES (use these names and counts in the narrative):

${sitesBlock(groups)}

SOURCES:

${sourceBlocks.join("\n\n---\n\n")}

Generate the digest now in the required format, citing sources as [N].`;
}

export interface ParsedDigest {
  narrative: string;
  narrativeParts: DigestNarrativePart[];
  topics: Array<{ topic: string; pageCount: number }>;
  insights: DigestInsight[];
  sources: DigestSource[];
  domainGroups: DigestDomainGroup[];
  citationsFromModel: boolean;
}

/**
 * Spread the top sources over the narrative sentences when the model cited
 * nothing, so the UI still shows named, clickable links. Sources arrive in
 * importance order, so [1] lands on the first sentence.
 */
function dealFallbackIndexes(partCount: number, sourceCount: number): number[][] {
  const out: number[][] = Array.from({ length: partCount }, () => []);
  if (partCount === 0 || sourceCount === 0) return out;
  const take = Math.min(sourceCount, partCount === 1 ? 3 : partCount * 2);
  for (let i = 0; i < take; i++) out[i % partCount]!.push(i + 1);
  for (const list of out) list.sort((a, b) => a - b);
  return out;
}

function toInsight(text: string, source: DigestSource): DigestInsight {
  return {
    text,
    sourceUrl: source.url,
    sourceTitle: source.title,
    sourceIndexes: [source.n],
  };
}

/** Exported for tests / eval harness: parses LLM digest layout. */
export function parseDigestOutput(
  raw: string,
  chunks: ChunkWithDoc[]
): ParsedDigest {
  const sources = buildDigestSources(chunks ?? []);
  const maxIndex = sources.length;
  const byIndex = new Map(sources.map((s) => [s.n, s]));
  const text = stripDigestMarkdown(raw ?? "");

  // Sections end at the next header or at the end of the output: a model that
  // skips TOPICS or INSIGHTS must not swallow the section before it.
  const narrativeMatch = text.match(
    /NARRATIVE:\s*([\s\S]*?)(?=\n\s*(?:TOPICS|INSIGHTS)\s*:|$)/i
  );
  const topicsMatch = text.match(
    /TOPICS:\s*([\s\S]*?)(?=\n\s*INSIGHTS\s*:|$)/i
  );
  const insightsMatch = text.match(/INSIGHTS:\s*([\s\S]*)/i);

  const topics = (topicsMatch?.[1] || "")
    .split("\n")
    .map((line) => {
      const m = line.match(/^[-*]\s*(.+?)\s*\((\d+)\s*pages?\)/i);
      if (!m) return null;
      const topic = extractCitationIndexes(m[1]!.trim(), maxIndex).text;
      if (!topic) return null;
      return { topic, pageCount: Number.parseInt(m[2]!, 10) };
    })
    .filter(Boolean) as Array<{ topic: string; pageCount: number }>;

  const narrativeRawSource =
    narrativeMatch?.[1] ??
    // No NARRATIVE: header at all: treat the head of the output as prose.
    text.match(/^([\s\S]*?)(?=\n\s*(?:TOPICS|INSIGHTS)\s*:|$)/i)?.[1] ??
    "";

  const narrativeRaw = narrativeRawSource.trim().replace(/\s+/g, " ");
  const personalized = narrativeRaw
    ? personalizeDigestNarrative(narrativeRaw)
    : "No summary generated.";

  const sentences = splitNarrativeSentences(personalized);
  const narrativeParts: DigestNarrativePart[] = sentences.map((s) => {
    const { text: clean, indexes } = extractCitationIndexes(s, maxIndex);
    return { text: clean || s, sourceIndexes: indexes };
  });

  // Insight bullets. A bullet that cites a valid source keeps that source; if
  // no bullet cites anything usable, the bullets survive with the top sources
  // attached rather than disappearing from the UI.
  const insightLines = (insightsMatch?.[1] || "")
    .split("\n")
    .map((line) => line.match(/^\s*[-*]\s*(.+?)\s*$/)?.[1] ?? "")
    .filter((line) => line.length > 0);

  const citedInsights: DigestInsight[] = [];
  const uncitedTexts: string[] = [];
  for (const line of insightLines) {
    const { text: clean, indexes, hadMarker } = extractCitationIndexes(
      line,
      maxIndex
    );
    if (!clean) continue;
    const source = indexes.length > 0 ? byIndex.get(indexes[0]!) : undefined;
    if (source) {
      citedInsights.push(toInsight(clean, source));
    } else if (!hadMarker) {
      // A marker the model got wrong (out of range, malformed) means the
      // bullet claimed a source it does not have: drop it rather than
      // attach the wrong page. A bullet with no marker at all is kept.
      uncitedTexts.push(clean);
    }
  }

  let insights: DigestInsight[] = citedInsights;
  if (citedInsights.length === 0 && uncitedTexts.length > 0) {
    insights = uncitedTexts
      .map((t, i) => {
        const source = byIndex.get((i % Math.max(sources.length, 1)) + 1);
        return source ? toInsight(t, source) : null;
      })
      .filter(Boolean) as DigestInsight[];
  }

  const modelCitedNarrative = narrativeParts.some(
    (p) => p.sourceIndexes.length > 0
  );
  const citationsFromModel = modelCitedNarrative || citedInsights.length > 0;

  if (!modelCitedNarrative && sources.length > 0) {
    const dealt = dealFallbackIndexes(narrativeParts.length, sources.length);
    narrativeParts.forEach((part, i) => {
      part.sourceIndexes = dealt[i] ?? [];
    });
  }

  return {
    narrative: narrativeParts.map((p) => p.text).join(" ").trim() || personalized,
    narrativeParts,
    topics,
    insights,
    sources,
    domainGroups: groupSourcesByDomain(sources),
    citationsFromModel,
  };
}

/** Numbered prompt sources first, then any other page visited in the range. */
function mergeSources(
  cited: DigestSource[],
  docs: DocumentRecord[],
  minTotal: number
): DigestSource[] {
  const out = [...cited];
  const seen = new Set(out.map((s) => s.url));
  for (const doc of docs) {
    if (out.length >= Math.max(minTotal, cited.length)) break;
    const safe = safeHttpHttpsHref(doc.url ?? "");
    if (!safe || seen.has(safe)) continue;
    const extra = sourceFromDoc(doc, out.length + 1);
    if (!extra) continue;
    seen.add(safe);
    out.push(extra);
  }
  return out;
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
    const narrative = `You didn't visit any pages ${label} that Cortex indexed. Browse some content and try again.`;
    return {
      schemaVersion: DIGEST_SCHEMA_VERSION,
      range: request.range,
      generatedAt: Date.now(),
      pageCount: 0,
      domainsCount: 0,
      narrative,
      narrativeParts: [{ text: narrative, sourceIndexes: [] }],
      topics: [],
      insights: [],
      sources: [],
      domainGroups: [],
      citationsFromModel: false,
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

  /*
   * A model writes the reading focus when one is available. If every model
   * fails, the paragraph is written from the pages already grouped below,
   * and the API error is never shown.
   */
  let rawOut = "";
  let modelFailed = false;
  try {
    const route: RouteDecision = await decideRoute(prompt, fakeQuestion, settings);
    for await (const token of streamAnswer(prompt, DIGEST_SYSTEM_PROMPT, route, settings, {
      maxOutputTokens: 8192,
    })) {
      rawOut += token;
    }
  } catch {
    modelFailed = true;
  }

  const parsedOut = parseDigestOutput(rawOut, packed);
  // Cited sources keep their [N]; the rest of the period fills the
  // "show all pages" list with numbers that simply were never cited.
  const sources = mergeSources(parsedOut.sources, docs, DIGEST_SOURCE_CAP);
  const domainGroups = groupSourcesByDomain(sources);
  const local = modelFailed || !rawOut.trim() ? localReadingFocus(domainGroups, sources) : null;
  const finished = local ? null : finishReadingFocus(parsedOut.narrativeParts, domainGroups, sources);

  const result: DigestResult = {
    schemaVersion: DIGEST_SCHEMA_VERSION,
    range: request.range,
    generatedAt: Date.now(),
    pageCount: docs.length,
    domainsCount: new Set(docs.map((d) => d.domain)).size,
    narrative: local?.narrative ?? finished!.narrative,
    narrativeParts: local?.narrativeParts ?? finished!.narrativeParts,
    topics: parsedOut.topics,
    insights: parsedOut.insights,
    sources,
    domainGroups,
    citationsFromModel: local ? false : parsedOut.citationsFromModel,
  };

  // A library-only summary is not cached: the next open should try the model again.
  if (!local) await saveDigestToCache(request.range, result);
  return result;
}
