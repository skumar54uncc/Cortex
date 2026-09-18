import type { Worker } from "@playwright/test";
import { test, expect, articleHtml, LOREM_PARAGRAPHS } from "./fixtures";

/**
 * Phase 5.3: "Save to Cortex" context menu. The click is dispatched inside
 * the service worker; the note prompt appears in the page and is answered.
 */
async function readHighlights(sw: Worker) {
  return sw.evaluate(
    () =>
      new Promise<{ quote: string; note?: string; embedded: boolean }[]>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["highlights", "chunks"], "readonly");
          const h = tx.objectStore("highlights").getAll();
          const c = tx.objectStore("chunks").getAll();
          tx.oncomplete = () => {
            const chunks = new Map((c.result as { id: number; embedState?: string }[]).map((x) => [x.id, x]));
            resolve(
              (h.result as { quote: string; note?: string; chunkId: number }[]).map((x) => ({
                quote: x.quote,
                note: x.note,
                embedded: chunks.get(x.chunkId)?.embedState === "embedded",
              }))
            );
            db.close();
          };
        };
      })
  );
}

async function clickSaveHighlight(sw: Worker, urlPart: string, selectionText: string): Promise<void> {
  await sw.evaluate(
    async ({ part, text }) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url?.includes(part));
      const ev = chrome.contextMenus.onClicked as unknown as {
        dispatch: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void;
      };
      ev.dispatch({ menuItemId: "cortex-save-highlight", selectionText: text, editable: false, pageUrl: tab!.url! }, tab);
    },
    { part: urlPart, text: selectionText }
  );
}

test("save a selection with a note; it is stored, embedded and found by search", async ({ context, serviceWorker }) => {
  await context.route("http://cortex-e2e.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: articleHtml("Highlight page", LOREM_PARAGRAPHS) })
  );
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept("remember for the enterprise pitch"));
  await page.goto("http://cortex-e2e.test/hl");

  await clickSaveHighlight(serviceWorker, "/hl", "Enterprise deployments can pin settings through managed storage");
  await expect.poll(() => readHighlights(serviceWorker), { timeout: 30_000 }).toEqual([
    {
      quote: "Enterprise deployments can pin settings through managed storage",
      note: "remember for the enterprise pitch",
      embedded: true,
    },
  ]);

  // Search from an extension page (a worker cannot message itself).
  const extId = serviceWorker.url().split("/")[2];
  const shell = await context.newPage();
  await shell.goto(`chrome-extension://${extId}/popup.html`);
  const kinds = await shell.evaluate(async () => {
    const res = await new Promise<{ hits?: { kind?: string }[] }>((resolve) =>
      chrome.runtime.sendMessage({ type: "CORTEX_SEARCH", query: "my highlights about managed storage" }, (r) => resolve(r ?? {}))
    );
    return (res.hits ?? []).map((h) => h.kind);
  });
  expect(kinds[0]).toBe("highlight");
});

test("cancelling the note prompt saves nothing; sensitive sites are refused", async ({ context, serviceWorker }) => {
  await context.route("http://cortex-e2e.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: articleHtml("Cancel page", LOREM_PARAGRAPHS) })
  );
  await context.route("https://mybank.example/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: articleHtml("Bank", LOREM_PARAGRAPHS) })
  );
  const page = await context.newPage();
  page.on("dialog", (d) => void d.dismiss());
  await page.goto("http://cortex-e2e.test/cancel");
  await clickSaveHighlight(serviceWorker, "/cancel", "Retrieval combines a lexical BM25 score");

  const bank = await context.newPage();
  let bankDialogs = 0;
  bank.on("dialog", (d) => {
    bankDialogs += 1;
    void d.accept("x");
  });
  await bank.goto("https://mybank.example/account");
  await clickSaveHighlight(serviceWorker, "mybank.example", "account balance");

  await page.waitForTimeout(2500);
  expect(await readHighlights(serviceWorker)).toEqual([]);
  expect(bankDialogs).toBe(0);
});
