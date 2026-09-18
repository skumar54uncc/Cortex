import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SYNTHETIC_PAGES } from "../corpus/synthetic-seed";
import { SYNTHETIC_QUERIES } from "../queries/synthetic-queries";
import { GENERATED_PAGES, GENERATED_QUERIES, GENERATED_STATS } from "../corpus/generated-seed";

const EVAL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function writeJsonl(path: string, rows: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const sorted = [...rows].sort((a, b) => {
    const aid = (a as { id: string }).id;
    const bid = (b as { id: string }).id;
    return aid.localeCompare(bid);
  });
  const body = sorted.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(path, body, "utf8");
}

export function runSeed(): void {
  const pagesPath = join(EVAL_ROOT, "corpus", "pages.jsonl");
  const queriesPath = join(EVAL_ROOT, "queries", "retrieval.jsonl");
  const pages = [...SYNTHETIC_PAGES, ...GENERATED_PAGES];
  const queries = [...SYNTHETIC_QUERIES, ...GENERATED_QUERIES];
  writeJsonl(pagesPath, pages);
  writeJsonl(queriesPath, queries);
  console.info(`[eval:seed] Wrote ${pages.length} pages -> ${pagesPath}`);
  console.info(`[eval:seed] Wrote ${queries.length} queries -> ${queriesPath}`);
  console.info(`[eval:seed] Generated: ${JSON.stringify(GENERATED_STATS)}`);
}
