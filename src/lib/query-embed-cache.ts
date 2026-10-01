/**
 * In-memory query embedding cache for one offscreen session.
 * Not written to disk. Cleared when the document unloads.
 */

const MAX_ENTRIES = 32;

const cache = new Map<string, number[]>();

export function normalizeQueryForEmbed(text: string, maxChars = 8000): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

export function clearQueryEmbeddingCache(): void {
  cache.clear();
}

export function queryEmbeddingCacheSize(): number {
  return cache.size;
}

function lookup(key: string): number[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit.slice();
}

function remember(key: string, vector: number[]): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, vector.slice());
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export async function embedWithSessionCache(
  text: string,
  embed: (normalized: string) => Promise<number[] | null>,
  maxChars = 8000
): Promise<number[] | null> {
  const raw = normalizeQueryForEmbed(text, maxChars);
  if (!raw) return null;
  const hit = lookup(raw);
  if (hit) return hit;
  const vector = await embed(raw);
  if (!vector?.length) return null;
  remember(raw, vector);
  return vector.slice();
}
