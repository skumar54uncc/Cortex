import type { Worker, BrowserContext } from "@playwright/test";
import { test, expect, articleHtml, openOverlayViaToolbar } from "./fixtures";
import { queryInShadow } from "./shadow";

/**
 * Phase 5.4: create a collection in options, add a page through the context
 * menu, and scope search to the collection.
 */
const P = (topic: string) => [
  `Kombucha ${topic} notes for the brewing log. The ${topic} step decides the final taste of each batch.`,
  `Brewers track the ${topic} with a notebook and compare batches before bottling the next round of kombucha.`,
  `The ${topic} matters more in warm months, when fermentation speeds up and the scoby grows faster than usual.`,
  "This paragraph adds enough readable text for the indexer to accept the page on device.",
];

async function waitDocs(sw: Worker, n: number): Promise<void> {
  await expect
    .poll(
      () =>
        sw.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open("cortex-db");
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("chunks")) {
                  db.close();
                  resolve(0);
                  return;
                }
                const all = db.transaction("chunks", "readonly").objectStore("chunks").getAll();
                all.onsuccess = () => {
                  const rows = all.result as { documentId: number; embedState?: string }[];
                  const embeddedDocs = new Set(rows.filter((r) => r.embedState === "embedded").map((r) => r.documentId));
                  resolve(embeddedDocs.size);
                  db.close();
                };
              };
            })
        ),
      { timeout: 45_000 }
    )
    .toBeGreaterThanOrEqual(n);
}

async function search(context: BrowserContext, extId: string, query: string, collectionId?: number): Promise<string[]> {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extId}/popup.html`);
  const urls = await p.evaluate(
    async ({ q, cid }) => {
      const res = await new Promise<{ hits?: { url: string }[] }>((resolve) =>
        chrome.runtime.sendMessage(
          { type: "CORTEX_SEARCH", query: q, ...(cid != null ? { collectionId: cid } : {}) },
          (r) => resolve(r ?? {})
        )
      );
      return (res.hits ?? []).map((h) => h.url).sort();
    },
    { q: query, cid: collectionId ?? null }
  );
  await p.close();
  return urls;
}

test("create a collection, add a page from the context menu, scope search to it", async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  for (const [path, topic] of [["ph", "pH curve"], ["sugar", "sugar ratio"]] as const) {
    await context.route(`http://cortex-e2e.test/${path}`, (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: articleHtml(`Kombucha ${topic}`, P(topic)) })
    );
  }
  const a = await context.newPage();
  await a.goto("http://cortex-e2e.test/ph");
  const b = await context.newPage();
  await b.goto("http://cortex-e2e.test/sugar");
  await waitDocs(serviceWorker, 2);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.fill("#cx-collection-name", "Job search");
  await options.click("#cx-collection-create");
  await expect(options.locator("#cx-collection-list")).toContainText("Job search");
  await expect(options.locator("#cx-collection-list")).toContainText("0 pages");

  const colId = await serviceWorker.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const all = req.result.transaction("collections", "readonly").objectStore("collections").getAll();
          all.onsuccess = () => {
            resolve((all.result as { id: number }[])[0]!.id);
            req.result.close();
          };
        };
      })
  );

  await serviceWorker.evaluate(async (id) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url?.endsWith("/ph"));
    const ev = chrome.contextMenus.onClicked as unknown as {
      dispatch: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void;
    };
    ev.dispatch({ menuItemId: `cortex-collection-${id}`, editable: false, pageUrl: tab!.url! }, tab);
  }, colId);

  await options.reload();
  await expect(options.locator("#cx-collection-list")).toContainText("1 page");

  expect(await search(context, extensionId, "kombucha brewing batches")).toEqual([
    "http://cortex-e2e.test/ph",
    "http://cortex-e2e.test/sugar",
  ]);
  expect(await search(context, extensionId, "kombucha brewing batches", colId)).toEqual(["http://cortex-e2e.test/ph"]);

  // The overlay shows the scope picker with the collection.
  await openOverlayViaToolbar(a, serviceWorker);
  await expect
    .poll(async () => (await queryInShadow(a, "cortex-scope-select")).map((m) => m.text).join(" "))
    .toContain("Job search (1)");
});
