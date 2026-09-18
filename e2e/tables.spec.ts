import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Worker } from "@playwright/test";
import { test, expect } from "./fixtures";

/** Phase 5.7: data tables become table chunks with row locators. */
const HTML = readFileSync(join(__dirname, "..", "tests", "fixtures", "tables", "synth-prices.html"), "utf8");

async function route(context: BrowserContext): Promise<void> {
  await context.route("http://cortex-e2e.test/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HTML })
  );
}

type Row = { kind?: string; text: string; locator?: { rowStart: number; rowEnd: number; caption: string }; embedState?: string };

async function chunks(sw: Worker): Promise<Row[]> {
  return sw.evaluate(
    () =>
      new Promise<Row[]>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("chunks")) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction("chunks", "readonly").objectStore("chunks").getAll();
          all.onsuccess = () => {
            resolve(all.result as Row[]);
            db.close();
          };
        };
      })
  );
}

test("tables are indexed row by row; article chunks leave them out; table intent ranks them first", async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await route(context);
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/synths");
  await expect
    .poll(async () => (await chunks(serviceWorker)).filter((c) => c.kind === "table" && c.embedState === "embedded").length, {
      timeout: 40_000,
    })
    .toBe(5);
  const all = await chunks(serviceWorker);
  const tables = all.filter((c) => c.kind === "table");
  expect(tables[0]!.locator).toMatchObject({ rowStart: 1, rowEnd: 12, caption: "Voice card recap prices, 2026" });
  expect(tables[0]!.text).toContain("Model: Synth 1; Price (credits): 101");
  const textChunks = all.filter((c) => (c.kind ?? "text") === "text");
  expect(textChunks.length).toBeGreaterThan(0);
  expect(textChunks.some((c) => c.text.includes("Synth 17"))).toBe(false);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const hit = await popup.evaluate(async () => {
    const res = await new Promise<{ hits?: { kind?: string; snippet: string }[] }>((resolve) =>
      chrome.runtime.sendMessage({ type: "CORTEX_SEARCH", query: "table price of Synth 17" }, (r) => resolve(r ?? {}))
    );
    return res.hits?.[0];
  });
  expect(hit?.kind).toBe("table");
});

test("tables off: no table chunks are stored", async ({ context, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, tablesEnabled: false } });
  });
  await route(context);
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/synths-off");
  await expect.poll(async () => (await chunks(serviceWorker)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect((await chunks(serviceWorker)).filter((c) => c.kind === "table")).toEqual([]);
});
