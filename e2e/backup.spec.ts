import { readFileSync } from "node:fs";
import type { Page, Worker } from "@playwright/test";
import { test, expect, articleHtml } from "./fixtures";

/** Phase 5.10: Markdown export, JSON backup, and restore through the options page. */
const TITLE = "Quillfeather glacier survey";
const PARAS = [
  "The quillfeather glacier survey logged a magnetometer drift of four nanotesla per hour at the northern station during the long night.",
  "Field teams recalibrated the fluxgate on day three and compared the readings against the southern reference station before the storm.",
  "Solar wind coupling remains the leading explanation for the drift, although the team wants a second winter of data before publishing.",
];

type Chunk = { documentId: number; embedState?: string; embedding?: unknown };

async function chunks(sw: Worker): Promise<Chunk[]> {
  return sw.evaluate(
    () =>
      new Promise<Chunk[]>((resolve) => {
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
            resolve(all.result as Chunk[]);
            db.close();
          };
        };
      })
  );
}

async function saved(page: Page, click: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path!) };
}

test("export notes and backup, wipe, restore from the file: the page is back and searchable", async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await serviceWorker.evaluate(async () => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, geminiApiKey: "e2e-secret-key-123" } });
  });
  await context.route("http://cortex-e2e.test/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: articleHtml(TITLE, PARAS) })
  );
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/quillfeather");
  await expect
    .poll(async () => (await chunks(serviceWorker)).filter((c) => c.embedState === "embedded").length, { timeout: 40_000 })
    .toBeGreaterThan(0);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  const md = await saved(options, () => options.click("#cx-export-md"));
  expect(md.name).toMatch(/^cortex-notes-\d{4}-\d{2}-\d{2}\.zip$/);
  expect(md.bytes.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
  expect(md.bytes.toString("utf8")).toContain("notes/quillfeather-glacier-survey.md");
  await expect(options.locator("#cx-export-feedback")).toHaveText(`Saved ${md.name}.`);

  const backup = await saved(options, () => options.click("#cx-export-json"));
  const json = backup.bytes.toString("utf8");
  expect(JSON.parse(json)).toMatchObject({ format: "cortex-backup", version: 1, schemaVersion: 6 });
  expect(json).toContain("quillfeather glacier survey");
  expect(json).not.toContain("e2e-secret-key-123");
  expect(json).not.toContain("embedding");

  // Another extension page (not options) may not export the library.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const refused = await popup.evaluate(
    () => new Promise<{ ok?: boolean }>((resolve) => chrome.runtime.sendMessage({ type: "CORTEX_EXPORT", format: "json" }, resolve))
  );
  expect(refused.ok).toBe(false);

  await options.evaluate(
    () => new Promise((resolve) => chrome.runtime.sendMessage({ type: "CORTEX_CLEAR_ALL_DATA" }, resolve))
  );
  expect(await chunks(serviceWorker)).toEqual([]);

  await options.setInputFiles("#cx-restore-file", { name: backup.name, mimeType: "application/json", buffer: backup.bytes });
  await expect(options.locator("#cx-restore-confirm")).toBeVisible();
  await expect(options.locator("#cx-restore-summary")).toContainText("1 page");
  await expect(options.locator("#cx-restore-summary")).toBeFocused();
  await options.click("#cx-restore-btn");
  await expect(options.locator("#cx-restore-feedback")).toHaveText(
    "Restored 1 page. Cortex is re-indexing in the background.",
    { timeout: 20_000 }
  );

  // Restored chunks come back without vectors and are embedded again on device.
  await expect
    .poll(async () => {
      const cs = await chunks(serviceWorker);
      return cs.length > 0 && cs.every((c) => c.embedState === "embedded");
    }, { timeout: 60_000 })
    .toBe(true);
  const hit = await popup.evaluate(async () => {
    const res = await new Promise<{ hits?: { title?: string }[] }>((resolve) =>
      chrome.runtime.sendMessage({ type: "CORTEX_SEARCH", query: "fluxgate recalibration drift" }, (r) => resolve(r ?? {}))
    );
    return res.hits?.[0]?.title;
  });
  expect(hit).toBe(TITLE);
});

test("restore refuses a file that is not a Cortex backup and changes nothing", async ({ context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles("#cx-restore-file", {
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "something-else" })),
  });
  await expect(options.locator("#cx-restore-feedback")).toHaveText("This file is not a Cortex backup.");
  await expect(options.locator("#cx-restore-confirm")).toBeHidden();
});
