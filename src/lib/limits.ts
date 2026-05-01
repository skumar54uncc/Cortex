/** Ask / digest input guards */
export const CHAT_LIMITS = {
  MAX_QUESTION_CHARS: 12_000,
} as const;

/**
 * Storage + indexing caps — wired progressively into eviction (Step 2) and indexing guards.
 */
export const STORAGE_LIMITS = {
  MAX_DOCUMENTS: 10_000,
  MAX_CHUNKS: 250_000,
  MAX_VISIT_LOG_ENTRIES: 50_000,
  MAX_TOTAL_BYTES_HARD: 1_000_000_000,
  MAX_TOTAL_BYTES_SOFT: 500_000_000,

  MAX_CHUNKS_PER_DOCUMENT: 36,
  MAX_DOCUMENT_TEXT_BYTES: 1_000_000,

  MAX_INDEX_CALLS_PER_DOMAIN_PER_MINUTE: 5,
  REINDEX_COOLDOWN_MS: 24 * 60 * 60 * 1000,
} as const;
