import { chromium } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, openOverlayViaToolbar } from "../fixtures";

/**
 * Phase 6 investigation: GitHub's own bundle threw "Maximum call stack size
 * exceeded" during the live sweep while the Cortex overlay was open. Is it
 * caused by Cortex? Count the page's own uncaught errors in three runs.
 */
test.skip(!process.env.CORTEX_LIVE, "live network: set CORTEX_LIVE=1");
test.setTimeout(5 * 60_000);

const URL = "https://github.com/mozilla/pdf.js";

async function overflowCount(page: import("@playwright/test").Page, act: () => Promise<void>): Promise<number> {
  let n = 0;
  page.on("pageerror", (e) => {
    if (/Maximum call stack/.test(e.message)) n += 1;
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8_000);
  await act();
  await page.waitForTimeout(6_000);
  return n;
}

test("GitHub stack overflow: without Cortex, with Cortex idle, with the overlay open", async ({ context, serviceWorker }) => {
  const plain = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "cortex-plain-")), { channel: "chromium", headless: true });
  const without = await overflowCount(await plain.newPage(), async () => undefined);
  await plain.close();

  const idlePage = await context.newPage();
  const idle = await overflowCount(idlePage, async () => undefined);
  await idlePage.close();

  const page = await context.newPage();
  let overlayOpened = true;
  const withOverlay = await overflowCount(page, async () => {
    await openOverlayViaToolbar(page, serviceWorker).catch(() => (overlayOpened = false));
    await page.keyboard.type("population");
    await page.waitForTimeout(3_000);
    await page.keyboard.press("Escape");
  });
  console.log(JSON.stringify({ without, idle, withOverlay, overlayOpened, url: page.url() }));
  expect(typeof without).toBe("number");
});
