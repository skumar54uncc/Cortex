import { test, expect, articleHtml, LOREM_PARAGRAPHS } from "./fixtures";

/**
 * Smoke test for the on-device embedding path after the Transformers.js v4
 * migration: a page is indexed by the content script, the service worker
 * queues chunks, the offscreen document embeds them with the bundled WASM
 * runtime, and IndexedDB ends up with 384-d vectors. Also asserts that no
 * network request left the machine for model or runtime files.
 */
test("indexes a page and stores 384-d embeddings without any external fetch", async ({
  context,
  serviceWorker,
}) => {
  const external: string[] = [];
  context.on("request", (req) => {
    const u = req.url();
    if (!u.startsWith("chrome-extension://") && !u.startsWith("http://cortex-e2e.test/")) {
      external.push(u);
    }
  });

  await context.route("http://cortex-e2e.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml("Cortex E2E article about local embeddings", LOREM_PARAGRAPHS),
    })
  );

  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/article");

  const result = await serviceWorker.evaluate(async () => {
    const deadline = Date.now() + 90_000;
    const readChunks = (): Promise<{ total: number; embedded: number; dim: number }> =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("cortex-db");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("chunks")) {
            db.close();
            resolve({ total: 0, embedded: 0, dim: 0 });
            return;
          }
          const tx = db.transaction("chunks", "readonly");
          const all = tx.objectStore("chunks").getAll();
          all.onsuccess = () => {
            const rows = all.result as { embedState?: string; embedding?: number[] }[];
            const embedded = rows.filter((r) => r.embedState === "embedded");
            resolve({
              total: rows.length,
              embedded: embedded.length,
              dim: embedded[0]?.embedding?.length ?? 0,
            });
            db.close();
          };
          all.onerror = () => reject(all.error);
        };
      });
    let last = { total: 0, embedded: 0, dim: 0 };
    while (Date.now() < deadline) {
      last = await readChunks();
      if (last.total > 0 && last.embedded === last.total) return last;
      await new Promise((r) => setTimeout(r, 500));
    }
    return last;
  });

  expect(result.total).toBeGreaterThan(0);
  expect(result.embedded).toBe(result.total);
  expect(result.dim).toBe(384);
  expect(external).toEqual([]);
});
