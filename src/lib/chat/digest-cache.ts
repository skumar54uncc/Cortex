import { db } from "../../db/schema";
import { DIGEST_SCHEMA_VERSION, type DigestResult } from "./digest-types";

/**
 * Cached digests are keyed by schema version as well as range, so a digest
 * written before numbered citations existed is never handed to the new
 * renderer. Old rows are dropped the next time that range is regenerated.
 */
export function digestCacheKey(range: string): string {
  return `v${DIGEST_SCHEMA_VERSION}:${range}`;
}

function isCurrentShape(value: unknown): value is DigestResult {
  const r = value as Partial<DigestResult> | null;
  return (
    !!r &&
    typeof r === "object" &&
    r.schemaVersion === DIGEST_SCHEMA_VERSION &&
    Array.isArray(r.sources) &&
    Array.isArray(r.narrativeParts)
  );
}

export async function getDigestFromCache(
  range: string
): Promise<DigestResult | undefined> {
  const row = await db.digestCache.get(digestCacheKey(range));
  if (!row?.resultJson) return undefined;
  try {
    const parsed: unknown = JSON.parse(row.resultJson);
    return isCurrentShape(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function saveDigestToCache(
  range: string,
  result: DigestResult
): Promise<void> {
  await db.digestCache.put({
    range: digestCacheKey(range),
    generatedAt: result.generatedAt,
    resultJson: JSON.stringify(result),
  });
  // Best effort: clear the pre-versioned row for this range.
  try {
    await db.digestCache.delete(range);
  } catch {
    /* ignore */
  }
}
