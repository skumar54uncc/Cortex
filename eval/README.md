# Search evaluation harness (roadmap)

Cortex retrieval depends on **local IndexedDB state**, so automated relevance tests usually take one of these shapes:

1. **Fixture vectors:** Unit-test `search-engine` scoring helpers (`fuseRankScore`, BM25 math, tokenization) with frozen tensors — runs in Node.
2. **Golden snapshots:** Export a small `cortex-db` IndexedDB dump from a developer browser after indexing controlled URLs; replay queries in **headless Chromium** with the unpacked extension.
3. **Manual QA checklist:** Same queries after each release (`fixtures.example.json` format).

Copy `fixtures.example.json` to `fixtures.json` (gitignored) and extend with your own URLs once you have a stable corpus.
