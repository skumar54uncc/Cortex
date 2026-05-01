import { db } from "../../db/schema";
import type { DigestResult } from "./digest-types";

export async function getDigestFromCache(
  range: string
): Promise<DigestResult | undefined> {
  const row = await db.digestCache.get(range);
  if (!row?.resultJson) return undefined;
  try {
    return JSON.parse(row.resultJson) as DigestResult;
  } catch {
    return undefined;
  }
}

export async function saveDigestToCache(
  range: string,
  result: DigestResult
): Promise<void> {
  await db.digestCache.put({
    range,
    generatedAt: result.generatedAt,
    resultJson: JSON.stringify(result),
  });
}
