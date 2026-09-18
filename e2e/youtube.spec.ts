import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Worker } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * Phase 5.6: YouTube transcripts. www.youtube.com is served by context.route
 * from self-authored fixtures (player response and json3 captions); no real
 * YouTube request is made.
 */
const fx = (n: string) => readFileSync(join(__dirname, "..", "tests", "fixtures", "youtube", n), "utf8");
const PLAYER = fx("player-response.json");
const CAPTIONS = fx("captions.json3.json");
const WATCH = "https://www.youtube.com/watch?v=tIdAl4Mgr01";

async function routeYouTube(context: BrowserContext): Promise<void> {
  await context.route("https://www.youtube.com/api/timedtext**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: CAPTIONS })
  );
  await context.route("https://www.youtube.com/watch**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="en"><head><title>Tidal microgrids explained - YouTube</title>
<script>var ytInitialPlayerResponse = ${PLAYER};</script></head>
<body><main><h1>Tidal microgrids explained</h1>
<video width="640" height="360"></video>
<p>${"How island microgrids use tidal turbines to keep the lights on at slack tide. ".repeat(4)}</p>
</main></body></html>`,
    })
  );
}

async function transcriptChunks(sw: Worker): Promise<{ text: string; locator: { startSec: number; videoId: string } }[]> {
  return sw.evaluate(
    () =>
      new Promise((resolve) => {
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
            resolve((all.result as { kind?: string }[]).filter((c) => c.kind === "transcript") as never);
            db.close();
          };
        };
      })
  );
}

test("after 30 s of playback the captions are indexed as transcript windows with video locators", async ({
  context,
  serviceWorker,
}) => {
  test.setTimeout(120_000);
  await routeYouTube(context);
  const page = await context.newPage();
  await page.goto(WATCH);
  // Bridge injected in the page world once the page passed the gate.
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __cortexYtBridge?: boolean }).__cortexYtBridge)), { timeout: 30_000 }).toBe(true);

  await page.evaluate(() => document.querySelector("video")!.dispatchEvent(new Event("playing")));
  await page.waitForTimeout(20_000);
  expect(await transcriptChunks(serviceWorker)).toEqual([]); // not before 30 s

  await expect.poll(() => transcriptChunks(serviceWorker), { timeout: 40_000 }).toHaveLength(3);
  const chunks = await transcriptChunks(serviceWorker);
  expect(chunks.map((c) => c.locator)).toEqual([
    { videoId: "tIdAl4Mgr01", startSec: 0, endSec: 60 },
    { videoId: "tIdAl4Mgr01", startSec: 60, endSec: 120 },
    { videoId: "tIdAl4Mgr01", startSec: 120, endSec: 180 },
  ]);
  expect(chunks[1].text).toBe("[1:00] Batteries carry the island through slack tide.");
});

test("transcripts off: the page-world bridge is never injected", async ({ context, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, youtubeTranscriptsEnabled: false } });
  });
  await routeYouTube(context);
  const page = await context.newPage();
  await page.goto(WATCH);
  // The page itself is still indexed as a normal page.
  await expect
    .poll(
      () =>
        serviceWorker.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open("cortex-db");
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("documents")) {
                  db.close();
                  resolve(0);
                  return;
                }
                const c = db.transaction("documents", "readonly").objectStore("documents").count();
                c.onsuccess = () => {
                  resolve(c.result);
                  db.close();
                };
              };
            })
        ),
      { timeout: 30_000 }
    )
    .toBe(1);
  expect(await page.evaluate(() => Boolean((window as unknown as { __cortexYtBridge?: boolean }).__cortexYtBridge))).toBe(false);
});
