import { test, expect } from "./fixtures";

/**
 * Phase 3.4 wiring: a 1.0.x style document (no chunkingVersion, 420/75
 * chunks) is upgraded by the cortex-rechunk alarm inside the real service
 * worker, and its new chunks get embedded.
 */
test("rechunk alarm upgrades a legacy document to the current chunking version", async ({
  serviceWorker,
}) => {
  const words = Array.from({ length: 900 }, (_, i) => `legacyword${i + 1}`);
  const wideChunks = [words.slice(0, 420), words.slice(345, 765), words.slice(690, 900)].map((w) =>
    w.join(" ")
  );

  const docId = await serviceWorker.evaluate(async (chunks) => {
    const open = (): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    // Let the extension create its schema first.
    for (let i = 0; i < 50; i++) {
      const db = await open();
      const ready = db.objectStoreNames.contains("documents");
      db.close();
      if (ready) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const db = await open();
    const id = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(["documents", "chunks"], "readwrite");
      const add = tx.objectStore("documents").add({
        url: "https://legacy.example/page",
        domain: "legacy.example",
        title: "Legacy page",
        summary: "legacy",
        lastVisitedAt: Date.now(),
        visitCount: 1,
        importanceScore: 0.1,
      });
      add.onsuccess = () => {
        const docId = add.result as number;
        chunks.forEach((text, ord) =>
          tx.objectStore("chunks").add({ documentId: docId, ord, text, embedState: "pending" })
        );
        tx.oncomplete = () => resolve(docId);
      };
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const ev = chrome.alarms.onAlarm as unknown as { dispatch?: (a: chrome.alarms.Alarm) => void };
    ev.dispatch?.({ name: "cortex-rechunk", scheduledTime: Date.now() });
    return id;
  }, wideChunks);

  const result = await serviceWorker.evaluate(async (id) => {
    const read = (): Promise<{ version?: number; chunks: number; embedded: number }> =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("cortex-db");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["documents", "chunks"], "readonly");
          const d = tx.objectStore("documents").get(id);
          const c = tx.objectStore("chunks").index("documentId").getAll(id);
          tx.oncomplete = () => {
            const rows = c.result as { embedState?: string }[];
            resolve({
              version: (d.result as { chunkingVersion?: number } | undefined)?.chunkingVersion,
              chunks: rows.length,
              embedded: rows.filter((r) => r.embedState === "embedded").length,
            });
            db.close();
          };
        };
      });
    const deadline = Date.now() + 60_000;
    let last = await read();
    while (Date.now() < deadline) {
      last = await read();
      if (last.version === 2 && last.chunks > 0 && last.embedded === last.chunks) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    return last;
  }, docId);

  expect(result.version).toBe(2);
  // 900 words at 180/40 = 7 chunks (was 3 at 420/75)
  expect(result.chunks).toBe(7);
  expect(result.embedded).toBe(7);
});
