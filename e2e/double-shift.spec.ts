import { test, expect, routeArticle } from "./fixtures";

/** Tapping Shift twice opens the panel, and twice again closes it. */
async function panelOpen(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.getElementById("cortex-overlay-root")?.isConnected));
}

async function doubleShift(page: import("@playwright/test").Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.down("Shift");
    await page.keyboard.up("Shift");
  }
}

test("double Shift opens the panel, and double Shift again closes it", async ({ context }) => {
  await routeArticle(context, "Double shift page");
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/double-shift");
  await page.bringToFront();
  await page.waitForTimeout(1500);

  await doubleShift(page);
  await expect.poll(() => panelOpen(page), { timeout: 15_000 }).toBe(true);

  await doubleShift(page);
  await expect.poll(() => panelOpen(page), { timeout: 15_000 }).toBe(false);
});

test("holding Shift to type capitals does not open the panel", async ({ context }) => {
  await routeArticle(context, "No accidental open");
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/no-open");
  await page.bringToFront();
  await page.waitForTimeout(1500);

  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyA");
  await page.keyboard.press("KeyB");
  await page.keyboard.up("Shift");
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyC");
  await page.keyboard.up("Shift");

  await page.waitForTimeout(1500);
  expect(await panelOpen(page)).toBe(false);
});
