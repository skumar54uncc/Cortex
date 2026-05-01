/**
 * Advanced local retrieval: BM25 + cosine fusion, recency, engagement.
 * Intended to run in the offscreen document (stable lifetime vs service worker).
 */

import {
  db,
  getUrlsVisitedBetween,
  type DocumentRecord,
  type ChunkRecord,
} from "../db/schema";
import { cosineSimilarity } from "./similarity";
import { titleMatchScore, recencyBoost } from "./ranking";
import { parseAskQuery, buildEvidenceIntro } from "./query-parse";

export interface SearchHitDTO {
  url: string;
  title: string;
  summary: string;
  visitedAt: number;
  snippet: string;
  score: number;
  /** Optional — only when there’s a non-obvious lexical hook */
  matchReason?: string;
  /** Human-readable scores for “Why this matched” */
  scoreBreakdown: string;
}

export interface SearchResponseDTO {
  hits: SearchHitDTO[];
  evidence?: string;
  /** Best-ranked chunk per document (RAG / chat) — only when requested */
  chunks?: ChunkWithDoc[];
}

/** Chunk plus parent document for grounded answers */
export interface ChunkWithDoc extends ChunkRecord {
  document: DocumentRecord;
}

export interface AdvancedSearchOptions {
  /** Cap ranked documents returned (default 28) */
  maxHits?: number;
  /** Overrides any date window inferred from the query string */
  forceTimeRange?: { start: number; end: number };
  /** Attach chunk payloads aligned with hits order */
  includeChunks?: boolean;
}

const BM25_K1 = 1.35;
const BM25_B = 0.78;

const QUERY_ALIASES: [RegExp, string][] = [
  [/linked\s*in/gi, "linkedin"],
  [/linked-in/gi, "linkedin"],
];

function normalizeQueryText(s: string): string {
  let out = s.trim();
  for (const [re, rep] of QUERY_ALIASES) {
    out = out.replace(re, rep);
  }
  return out;
}

function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9]{2,}/g);
  return raw ?? [];
}

function termFreqMap(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) {
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}

function documentFrequencyForTerms(
  prepared: { tf: Map<string, number> }[],
  terms: string[]
): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of terms) df.set(t, 0);

  for (const p of prepared) {
    for (const t of terms) {
      if ((p.tf.get(t) ?? 0) > 0) {
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }
  }
  return df;
}

function idf(nDocs: number, df: number): number {
  const safeDf = Math.max(0, df);
  return Math.log(1 + (nDocs - safeDf + 0.5) / (safeDf + 0.5));
}

function bm25ForChunk(
  tf: Map<string, number>,
  dl: number,
  avgdl: number,
  queryTerms: string[],
  idfCache: Map<string, number>
): number {
  if (queryTerms.length === 0 || avgdl <= 0) return 0;
  let sum = 0;
  for (const term of queryTerms) {
    const tfRaw = tf.get(term) ?? 0;
    if (tfRaw <= 0) continue;
    const idfv = idfCache.get(term) ?? 0;
    const denom =
      tfRaw + BM25_K1 * (1 - BM25_B + (BM25_B * dl) / avgdl);
    sum += idfv * ((tfRaw * (BM25_K1 + 1)) / denom);
  }
  return sum;
}

function minMaxNorm(values: number[]): number[] {
  if (values.length === 0) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = hi - lo || 1;
  return values.map((v) => (Number.isFinite(v) ? (v - lo) / span : 0));
}

function fuseRankScore(parts: {
  cosine: number;
  bm25Norm: number;
  titleMatch: number;
  visitedAt: number;
  engagement: number;
  hasSemantic: boolean;
}): number {
  const rec = recencyBoost(parts.visitedAt);
  const eng = Math.min(1, Math.max(0, parts.engagement));
  const lexicalBlend = 0.72 * parts.bm25Norm + 0.28 * parts.titleMatch;

  if (parts.hasSemantic) {
    return (
      0.48 * parts.cosine +
      0.24 * lexicalBlend +
      0.12 * rec +
      0.16 * eng
    );
  }

  return 0.52 * lexicalBlend + 0.26 * rec + 0.22 * eng;
}

function pickSnippet(text: string, query: string, maxChars = 200): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const words = tokenize(query).filter((w) => w.length >= 3);
  const lower = cleaned.toLowerCase();
  let idx = -1;
  for (const w of words) {
    const at = lower.indexOf(w);
    if (at !== -1) {
      idx = at;
      break;
    }
  }

  let start = idx <= 0 ? 0 : Math.max(0, idx - 48);
  if (start > 0) {
    const near = cleaned.lastIndexOf(". ", start);
    if (near !== -1 && start - near < 100) start = near + 2;
    else {
      const sp = cleaned.lastIndexOf(" ", start);
      if (sp !== -1 && start - sp < 40) start = sp + 1;
    }
  }

  let chunk = cleaned.slice(start, start + maxChars).trim();

  let cut = chunk.length;
  const sentenceRe = /[.!?]\s+/g;
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(chunk)) !== null) {
    if (m.index > 72 && m.index < maxChars - 24) cut = Math.min(cut, m.index + m[0].length);
  }
  if (cut < chunk.length - 12) chunk = chunk.slice(0, cut).trim();
  else {
    const lastSp = chunk.lastIndexOf(" ");
    if (lastSp >= maxChars * 0.5) chunk = chunk.slice(0, lastSp).trim();
  }

  const truncated = start + chunk.length < cleaned.length || start > 0;
  return truncated ? `${chunk}…` : chunk;
}

function explainMatch(
  queryTerms: string[],
  chunkText: string,
  title: string,
  cosine: number,
  bm25Norm: number,
  hasSemantic: boolean
): { matchReason?: string; scoreBreakdown: string } {
  const semPct = Math.round(Math.min(100, Math.max(0, cosine * 100)));
  const lexPct = Math.round(Math.min(100, Math.max(0, bm25Norm * 100)));

  const breakdownParts: string[] = [];
  if (hasSemantic) {
    breakdownParts.push(`Semantic layer ~${semPct}% aligned with your query`);
  } else {
    breakdownParts.push("Semantic layer weak — this rank leaned on keywords and recency");
  }
  breakdownParts.push(`Keyword layer ~${lexPct}% vs other passages in your library`);

  const pool = `${title} ${chunkText}`.toLowerCase();
  const distinctive = queryTerms.filter((w) => w.length >= 6 && pool.includes(w));

  let matchReason: string | undefined;
  if (distinctive.length >= 2) {
    matchReason = `Phrases in page: ${distinctive.slice(0, 3).join(", ")}`;
  } else if (distinctive.length === 1 && distinctive[0].length >= 8) {
    matchReason = `Notable term in page: “${distinctive[0]}”`;
  }

  return {
    matchReason,
    scoreBreakdown: breakdownParts.join(". ") + ".",
  };
}

export async function runAdvancedSearch(
  rawQuery: string,
  embedQuery: (text: string) => Promise<number[] | null>,
  opts?: AdvancedSearchOptions
): Promise<SearchResponseDTO> {
  const parsed = parseAskQuery(normalizeQueryText(rawQuery));
  const effectiveParsed: typeof parsed = {
    ...parsed,
    timeRange:
      opts?.forceTimeRange !== undefined
        ? opts.forceTimeRange
        : parsed.timeRange,
  };

  const q = normalizeQueryText(parsed.embeddingText).trim();
  if (!q) return { hits: [] };

  let queryVec: number[] | null = null;
  try {
    queryVec = await embedQuery(q.slice(0, 8000));
  } catch {
    queryVec = null;
  }

  const docs = await db.documents.toArray();
  const docMap = new Map<number, DocumentRecord>(
    docs.filter((d) => d.id != null).map((d) => [d.id as number, d])
  );

  const chunkRows = await db.chunks.toArray();

  const lexicalProbe = [q, ...parsed.entityTerms].join("\n ");
  const queryTerms = [...new Set(tokenize(lexicalProbe))];
  if (queryTerms.length === 0) {
    return {
      hits: [],
      evidence:
        "Use letters or numbers in your query (e.g. “linkedin”, company names).",
    };
  }

  type Prepared = {
    chunk: ChunkRecord;
    doc: DocumentRecord;
    corpus: string;
    tf: Map<string, number>;
    dl: number;
  };

  const prepared: Prepared[] = [];
  let totalDl = 0;

  for (const c of chunkRows) {
    const doc = docMap.get(c.documentId);
    if (!doc?.id) continue;

    const corpus = `${doc.title ?? ""}\n${doc.summary ?? ""}\n${c.text ?? ""}`;
    const tokens = tokenize(corpus);
    const tf = termFreqMap(tokens);
    const dl = tokens.length || 1;
    totalDl += dl;
    prepared.push({ chunk: c, doc, corpus, tf, dl });
  }

  const nChunks = prepared.length;
  if (nChunks === 0) {
    return {
      hits: [],
      evidence:
        "Nothing indexed yet — browse pages normally so Cortex can store text chunks locally.",
    };
  }

  const avgdl = totalDl / nChunks;
  const dfMap = documentFrequencyForTerms(prepared, queryTerms);

  const idfCache = new Map<string, number>();
  for (const t of queryTerms) {
    idfCache.set(t, idf(nChunks, dfMap.get(t) ?? 0));
  }

  const lexicalProbeForTitle = [q, ...parsed.entityTerms].join("\n");

  const bm25RawList: number[] = [];
  const cosineList: number[] = [];

  for (const p of prepared) {
    bm25RawList.push(
      bm25ForChunk(p.tf, p.dl, avgdl, queryTerms, idfCache)
    );
    let cos = 0;
    if (queryVec && p.chunk.embedding?.length) {
      cos = cosineSimilarity(queryVec, p.chunk.embedding);
    }
    cosineList.push(cos);
  }

  const bm25NormList = minMaxNorm(bm25RawList);

  type Acc = {
    score: number;
    chunk: ChunkRecord;
    matchReason?: string;
    scoreBreakdown: string;
    bm25Raw: number;
    cosine: number;
    bm25Norm: number;
  };

  const bestByDoc = new Map<number, Acc>();

  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    const doc = p.doc;
    const bm25Raw = bm25RawList[i]!;
    const bm25Norm = bm25NormList[i] ?? 0;
    const cosine = cosineList[i]!;
    const tm = titleMatchScore(doc.title || "", lexicalProbeForTitle);

    const engagement = doc.importanceScore ?? 0;
    const visitedAt =
      typeof doc.lastVisitedAt === "number" && Number.isFinite(doc.lastVisitedAt)
        ? doc.lastVisitedAt
        : Date.now();

    const hasSemantic =
      cosine > 0.025 && !!(queryVec?.length && p.chunk.embedding?.length);

    let fused = fuseRankScore({
      cosine,
      bm25Norm,
      titleMatch: tm,
      visitedAt,
      engagement,
      hasSemantic,
    });

    let bonus = 0;
    const pool = p.corpus.toLowerCase();
    for (const term of parsed.entityTerms) {
      if (term.length > 1 && pool.includes(term.toLowerCase())) bonus += 0.06;
    }
    if (
      parsed.preferLinkedIn &&
      doc.url.toLowerCase().includes("linkedin.com")
    ) {
      bonus += 0.05;
    }

    fused = Math.min(1.45, fused + bonus);

    const prev = bestByDoc.get(doc.id!);
    const { matchReason, scoreBreakdown } = explainMatch(
      queryTerms,
      p.chunk.text,
      doc.title || "",
      cosine,
      bm25Norm,
      hasSemantic
    );

    if (
      !prev ||
      fused > prev.score ||
      (fused === prev.score && bm25Raw > prev.bm25Raw)
    ) {
      bestByDoc.set(doc.id!, {
        score: fused,
        chunk: p.chunk,
        matchReason,
        scoreBreakdown,
        bm25Raw,
        cosine,
        bm25Norm,
      });
    }
  }

  let ranked = [...bestByDoc.entries()]
    .map(([docId, v]) => {
      const doc = docMap.get(docId);
      return doc ? { doc, ...v } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null && Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score);

  const topScore = ranked[0]?.score ?? 0;
  const cutoff = Math.max(0.028, Math.min(0.26, topScore * 0.072));

  ranked = ranked.filter((x) => x.score >= cutoff);

  let timeRelaxed = false;
  if (effectiveParsed.timeRange) {
    const urlsInRange = await getUrlsVisitedBetween(
      effectiveParsed.timeRange.start,
      effectiveParsed.timeRange.end
    );
    const filtered = ranked.filter((row) => urlsInRange.has(row.doc.url));
    if (filtered.length > 0) {
      ranked = filtered;
    } else {
      timeRelaxed = true;
    }
  }

  const maxHits = opts?.maxHits ?? 28;
  const slice = ranked.slice(0, maxHits);

  const hits: SearchHitDTO[] = slice.map(
    ({ doc, score, chunk, matchReason, scoreBreakdown }) => ({
      url: doc.url,
      title: doc.title || "Untitled",
      summary: doc.summary,
      visitedAt:
        typeof doc.lastVisitedAt === "number" && Number.isFinite(doc.lastVisitedAt)
          ? doc.lastVisitedAt
          : Date.now(),
      snippet: pickSnippet(chunk.text, q),
      score,
      ...(matchReason ? { matchReason } : {}),
      scoreBreakdown,
    })
  );

  let evidence: string | undefined;
  if (hits.length > 0) {
    evidence = buildEvidenceIntro(effectiveParsed, hits.length, timeRelaxed);
  } else if (
    parsed.entityTerms.length > 0 ||
    effectiveParsed.timeRange != null
  ) {
    evidence =
      "No memories matched strongly — try quoted names, shorter keywords (e.g. linkedin), or revisit pages so Cortex can index them.";
  }

  const chunks: ChunkWithDoc[] | undefined = opts?.includeChunks
    ? slice
        .filter((row) => row.chunk.id != null)
        .map((row) => ({
          ...row.chunk,
          document: row.doc,
        }))
    : undefined;

  return { hits, evidence, ...(chunks ? { chunks } : {}) };
}
