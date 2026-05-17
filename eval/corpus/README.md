# Eval corpus (`pages.jsonl`)

One JSON object per line. Pages are sorted by `id` when loaded.

## Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Stable corpus id (e.g. `synthetic-quantum-sieve-wiki`) |
| `url` | string | Canonical URL stored in IndexedDB |
| `title` | string | Document title |
| `html` | string | Sanitized HTML snapshot (for future structural chunking) |
| `extracted_text` | string | Text fed to `chunkArticle` in eval |
| `captured_at` | string | ISO8601 timestamp → `lastVisitedAt` / visit log |
| `category` | enum | `wikipedia` \| `docs` \| `blog` \| `news` \| `spa` \| `long-form` |

## Regenerate from fixtures

```bash
npm run eval:seed
```

Source of truth: `synthetic-seed.ts`. Commit the generated `pages.jsonl` so CI stays deterministic.

## Adding a real page later

1. Browse the page locally with Cortex installed.
2. In DevTools, run extraction on a clone (Readability path) or export `extracted_text` from a debug hook.
3. **Do not commit** copyrighted full text from Wikipedia, MDN, news paywalls, etc. Prefer your own notes or explicitly licensed content.
4. Add a row to `synthetic-seed.ts` or append to `pages.jsonl` with a new `id`, fictional or self-authored HTML, and run `npm run eval:seed`.
