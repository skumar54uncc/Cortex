import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { test, expect, openOverlayViaToolbar, routeArticle } from "../fixtures";
import { clickInShadow } from "../shadow";

/**
 * Phase 2 gate: screenshots at 360, 600 and 1280px, at 200% zoom, in both
 * themes, and keyboard only. Run with CORTEX_QA=1 npm run e2e -- e2e/qa.
 * Output: docs/release-1.2.0/qa/*.png
 */
const OUT = resolve(__dirname, "..", "..", "docs", "release-1.2.0", "qa");
mkdirSync(OUT, { recursive: true });

type Theme = "light" | "dark";
const WIDTHS: Array<[number, number]> = [
  [360, 740],
  [600, 800],
  [1280, 900],
];

async function setTheme(sw: import("@playwright/test").Worker, theme: Theme): Promise<void> {
  await sw.evaluate(async (t) => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, theme: t } });
  }, theme);
}

for (const theme of ["light", "dark"] as Theme[]) {
  for (const [w, h] of WIDTHS) {
    test(`${theme} ${w}px: search, results, ask, digest`, async ({ context, serviceWorker }) => {
      await setTheme(serviceWorker, theme);
      await routeArticle(context, "Cortex QA article about local memory");
      const page = await context.newPage();
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`http://cortex-e2e.test/qa-${theme}-${w}`);
      // Let the content script index the page so search has a hit.
      await page.waitForTimeout(2500);
      await openOverlayViaToolbar(page, serviceWorker);
      await page.screenshot({ path: join(OUT, `${theme}-${w}-search.png`) });

      await page.keyboard.type("local memory");
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(OUT, `${theme}-${w}-search-results.png`) });

      await clickInShadow(page, "cortex-tab", "Ask");
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `${theme}-${w}-ask.png`) });
      if (w < 880) {
        await clickInShadow(page, "cortex-chat-drawer-toggle");
        await page.waitForTimeout(350);
        await page.screenshot({ path: join(OUT, `${theme}-${w}-ask-drawer.png`) });
      }

      await clickInShadow(page, "cortex-tab", "Digest");
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(OUT, `${theme}-${w}-digest.png`) });
      expect(true).toBe(true);
    });
  }

}

for (const theme of ["light", "dark"] as Theme[]) {
  test(`${theme} zoom 200%`, async ({ context, serviceWorker }) => {
    await setTheme(serviceWorker, theme);
    await routeArticle(context, "Cortex QA zoom article");
    const page = await context.newPage();
    // Layout equivalent of 200% browser zoom in a 1280x900 window: a 640x450
    // CSS px viewport. Rendered at 2x through CDP after navigation (Playwright
    // re-applies its own metrics on load, so the override goes last).
    await page.setViewportSize({ width: 640, height: 450 });
    await page.goto(`http://cortex-e2e.test/zoom-${theme}`);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 640,
      height: 450,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await page.waitForTimeout(1500);
    await openOverlayViaToolbar(page, serviceWorker);
    await page.screenshot({ path: join(OUT, `${theme}-zoom200-search.png`) });
    await clickInShadow(page, "cortex-tab", "Ask");
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${theme}-zoom200-ask.png`) });
    await cdp.detach();
  });

  test(`${theme} keyboard only`, async ({ context, serviceWorker }) => {
    await setTheme(serviceWorker, theme);
    await routeArticle(context, "Cortex QA keyboard article");
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`http://cortex-e2e.test/kbd-${theme}`);
    await page.waitForTimeout(1500);
    await openOverlayViaToolbar(page, serviceWorker);
    // Tab from the search input to the header controls and tabs; focus ring visible.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(OUT, `${theme}-keyboard-focus-ring.png`) });
    // Move to the Ask tab with the keyboard and activate it.
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(OUT, `${theme}-keyboard-tabbed.png`) });
    await page.keyboard.press("Escape");
    await expect
      .poll(() => page.evaluate(() => Boolean(document.getElementById("cortex-overlay-root"))))
      .toBe(false);
  });
}
