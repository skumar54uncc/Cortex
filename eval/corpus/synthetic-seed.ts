import type { CorpusPage } from "../src/types";

const CAPTURED = "2026-05-17T00:00:00Z";

function words(n: number, filler: string): string {
  const parts: string[] = [];
  while (parts.length < n) {
    parts.push(filler);
  }
  return parts.slice(0, n).join(" ");
}

function buildQuantumSieveWiki(): string {
  const sections: string[] = [
    "# Quantum Sieve Algorithms",
    "Quantum sieve algorithms are fictional lattice tools used in the made-up field of post-classical candidate filtering. They do not exist in production cryptography; this document is synthetic test data for Cortex eval only.",
    "## Introduction",
    "A quantum sieve partitions an exponentially large search space into buckets that can be scanned in parallel on a simulated annealer mesh. The name evokes sieving primes, but here the objects are high-dimensional vectors representing design alternatives.",
    "Practitioners describe three invariants: coherence margin, bucket overlap, and collapse threshold. When coherence margin falls below 0.12, the sieve is said to be unstable and must be reindexed.",
    "## History",
    "The first published account appeared in the imaginary Journal of Speculative Computation in 2018. Dr. Lina Ortega proposed the Ortega lattice, which remains the pedagogical default in textbooks about quantum sieves.",
    "By 2022, competing teams introduced the Helical sieve and the Mirror sieve. None of these methods have been standardized; they serve as narrative devices in training corpora.",
    "## Core algorithm",
    "Input: a set of candidate vectors C, a bucket function B, and a tolerance epsilon.",
    "Step 1: Project each vector onto a low-dimensional sketch using a random orthonormal basis.",
    "Step 2: Assign sketch coordinates to buckets via B.",
    "Step 3: Within each bucket, pairwise compare candidates using a domain-specific distance.",
    "Step 4: Retain only pairs whose distance is below epsilon.",
    "Step 5: Collapse retained pairs into equivalence classes and emit representatives.",
    "The quantum metaphor refers to superposed bucket states during Step 2; measurement occurs when representatives are chosen.",
    "## Filtering candidates",
    "Filtering is the operational heart of the sieve. Poor filter design yields false negatives when epsilon is too tight, or false positives when epsilon is loose.",
    "The quantum sieve algorithm filters candidates by repeatedly halving buckets until each bucket size is below a cap K. Typical K values range from 64 to 256 depending on hardware.",
    "Advanced variants apply a secondary lexical screen: candidates must share at least two tokens with a query anchor string. This hybrid approach mirrors retrieval pipelines in personal knowledge tools.",
    "## Applications",
    "Synthetic applications include: design-space exploration for fictional spacecraft radiators, deduplication of made-up patent abstracts, and clustering of tutorial paragraphs in offline search benchmarks.",
    "In Cortex eval fixtures, the algorithm name anchors factual queries about filtering and bucket collapse.",
    "## References",
    "Ortega, L. (2018). Lattice sieves for imaginary quantum workspaces. Journal of Speculative Computation, 12(4), 201-227.",
    "Helix Research Group. (2022). Mirror sieves and coherence margins. Fictional Press.",
  ];
  const body = sections.join("\n\n");
  const extra = words(
    420,
    "Each bucket stores sketch coordinates normalized to unit length so cosine comparisons remain stable during collapse."
  );
  return `${body}\n\n## Extended notes\n\n${extra}`;
}

function buildHelixAnnouncement(): string {
  return [
    "# Helix Labs Announces Quantum Sieve Toolkit 3.2",
    "HELIUM CITY — May 17, 2026 — Helix Labs today announced version 3.2 of its entirely fictional Quantum Sieve Toolkit, aimed at offline retrieval researchers who need deterministic corpora.",
    "The release introduces bucket-aware indexing hooks and a 40 percent reduction in imaginary compile times. CEO Mara Chen said the update reflects customer demand for reproducible benchmarks.",
    "Analysts at the Made-Up Markets Desk called the announcement timely but unverifiable, noting that no commercial product ships under this name.",
    "Version 3.2 will be available to synthetic benchmark authors immediately. Real users should not expect downloads.",
    "Helix Labs also confirmed that support for the Ortega lattice remains unchanged, with documentation patches planned for Q3.",
    "Press contact: press@example.test — This article is synthetic and describes no actual product launch.",
  ].join("\n\n");
}

function buildSideprojectBlog(): string {
  const bullets = [
    "- Week 1: sketched bucket functions on paper",
    "- Week 2: wired a fake IndexedDB and cried once",
    "- Week 3: added semantic fusion weights nobody asked for",
    "- Week 4: wrote twenty eval queries and called it science",
  ].join("\n");
  return [
    "# How I Built a Fake Quantum Sieve Demo in a Weekend",
    "I did not actually build a quantum computer. I built a story about one, because eval harnesses need paragraphs with personality.",
    "The goal was simple: prove that my local search stack could retrieve a blog post when I asked navigational questions like that article about my weekend project.",
    "## Motivation",
    "Personal knowledge tools fail quietly. You only notice when you ask a reasonable question and get an irrelevant snippet about something you read three months ago.",
    "So I fabricated Helix Labs, invented Ortega lattices, and typed furiously until the word counter smiled.",
    "## What worked",
    "Chunk overlap helped. Sliding windows felt archaic but predictable, which is exactly what you want before you rewrite everything in PR 3.",
    "I also learned that summaries matter even when they are truncated. The indexer wants a field; give it a field.",
    "## What failed",
    "Trying to sound like a real VC-backed launch announcement while also explaining cosine similarity was a mistake. Pick one audience.",
    "## Lessons",
    "Ship the harness before you ship the clever algorithm. Measure the baseline. Tell the truth about the number.",
    bullets,
    "If you read this in an interview, remember: the project is real, the quantum sieve is not.",
  ].join("\n\n");
}

function buildNexaApiDocs(): string {
  return [
    "# NexaFilter API Reference (Fictional)",
    "NexaFilter is a made-up library for bucketed candidate filtering in offline benchmarks.",
    "## Installation",
    "```bash",
    "npm install nexa-filter-fake --save-dev",
    "```",
    "## `createSieve(config)`",
    "Creates a sieve instance.",
    "```typescript",
    "interface SieveConfig {",
    "  bucketCap: number;",
    "  epsilon: number;",
    "  sketchDims: number;",
    "}",
    "function createSieve(config: SieveConfig): Sieve;",
    "```",
    "Returns a `Sieve` object. Throws if `epsilon` is negative.",
    "## `sieve.filterCandidates(vectors, anchor)`",
    "Filters candidate vectors against a lexical anchor string.",
    "```typescript",
    "filterCandidates(vectors: Float32Array[], anchor: string): string[];",
    "```",
    "The quantum sieve algorithm filters candidates by bucket id first, then lexical overlap.",
    "## `Sieve.collapse()`",
    "Collapses equivalence classes and returns representative ids.",
    "## Error codes",
    "| Code | Meaning |",
    "|------|---------|",
    "| NF001 | Bucket cap exceeded |",
    "| NF002 | Coherence margin too low |",
    "## See also",
    "Ortega lattice, Helix Toolkit, Cortex eval harness.",
  ].join("\n");
}

function buildTinyStub(): string {
  return [
    "Quantum sieve algorithms filter candidates using imaginary buckets. This page is intentionally short for edge-case retrieval tests in the Cortex eval corpus.",
    "There is only one paragraph. Do not expect sections.",
  ].join(" ");
}

export const SYNTHETIC_PAGES: CorpusPage[] = [
  {
    id: "synthetic-quantum-sieve-wiki",
    url: "https://example.test/wiki/quantum-sieve-algorithms",
    title: "Quantum Sieve Algorithms",
    html: `<article>${buildQuantumSieveWiki().replace(/\n/g, "<br/>")}</article>`,
    extracted_text: buildQuantumSieveWiki(),
    captured_at: CAPTURED,
    category: "wikipedia",
  },
  {
    id: "synthetic-helix-announcement",
    url: "https://example.test/news/helix-toolkit-3-2",
    title: "Helix Labs Announces Quantum Sieve Toolkit 3.2",
    html: `<article>${buildHelixAnnouncement().replace(/\n/g, "<br/>")}</article>`,
    extracted_text: buildHelixAnnouncement(),
    captured_at: CAPTURED,
    category: "news",
  },
  {
    id: "synthetic-sideproject-blog",
    url: "https://example.test/blog/fake-quantum-sieve-weekend",
    title: "How I Built a Fake Quantum Sieve Demo in a Weekend",
    html: `<article>${buildSideprojectBlog().replace(/\n/g, "<br/>")}</article>`,
    extracted_text: buildSideprojectBlog(),
    captured_at: CAPTURED,
    category: "blog",
  },
  {
    id: "synthetic-nexa-api-docs",
    url: "https://example.test/docs/nexafilter/api",
    title: "NexaFilter API Reference",
    html: `<article><pre>${buildNexaApiDocs()}</pre></article>`,
    extracted_text: buildNexaApiDocs(),
    captured_at: CAPTURED,
    category: "docs",
  },
  {
    id: "synthetic-tiny-stub",
    url: "https://example.test/edge/tiny-stub",
    title: "Tiny Stub",
    html: `<p>${buildTinyStub()}</p>`,
    extracted_text: buildTinyStub(),
    captured_at: CAPTURED,
    category: "long-form",
  },
];
