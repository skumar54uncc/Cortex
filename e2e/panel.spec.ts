import { test, expect, openOverlayViaToolbar, routeArticle } from "./fixtures";
import { clickInShadow, panelBox, type Box } from "./shadow";

/**
 * Phase 2.2: one panel size for every tab, vertically centered.
 * width: min(960px, 100vw - 32px), height: min(760px, 100dvh - 48px).
 */
function expectSameBox(a: Box, b: Box, label: string): void {
  expect(Math.abs(a.width - b.width), `${label} width`).toBeLessThanOrEqual(1);
  expect(Math.abs(a.height - b.height), `${label} height`).toBeLessThanOrEqual(1);
  expect(Math.abs(a.x - b.x), `${label} x`).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y - b.y), `${label} y`).toBeLessThanOrEqual(1);
}

test("panel keeps one size across Search, Ask and Digest and is vertically centered", async ({
  context,
  serviceWorker,
}) => {
  await routeArticle(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://cortex-e2e.test/panel");
  await openOverlayViaToolbar(page, serviceWorker);

  const search = await panelBox(page);
  await clickInShadow(page, "cortex-tab", "Ask");
  await page.waitForTimeout(150);
  const ask = await panelBox(page);
  await clickInShadow(page, "cortex-tab", "Digest");
  await page.waitForTimeout(150);
  const digest = await panelBox(page);

  expectSameBox(search, ask, "search vs ask");
  expectSameBox(search, digest, "search vs digest");

  // 1280x900 viewport: width min(960, 1248) = 960, height min(760, 852) = 760
  expect(Math.round(search.width)).toBe(960);
  expect(Math.round(search.height)).toBe(760);
  const expectedTop = (900 - 760) / 2;
  expect(Math.abs(search.y - expectedTop)).toBeLessThanOrEqual(2);
});

test("small viewport: panel fills width minus 32px and height minus 48px", async ({
  context,
  serviceWorker,
}) => {
  await routeArticle(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 600, height: 500 });
  await page.goto("http://cortex-e2e.test/panel-small");
  await openOverlayViaToolbar(page, serviceWorker);
  const b = await panelBox(page);
  expect(Math.round(b.width)).toBe(600 - 32);
  expect(Math.round(b.height)).toBe(500 - 48);
  expect(Math.abs(b.y - 24)).toBeLessThanOrEqual(2);
});
