import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, Worker } from "@playwright/test";
import {
  test,
  expect,
  openOverlayViaToolbar,
  routeArticle,
  EXTENSION_PATH_E2E_AUDIT,
} from "./fixtures";
import { clickInShadow } from "./shadow";

/**
 * Phase 4.5 accessibility gate: zero serious or critical axe-core violations.
 * Runs on dist-e2e (npm run build:e2e), identical to production except that
 * the overlay shadow root is open so axe can see inside it.
 */
test.use({ extensionPath: EXTENSION_PATH_E2E_AUDIT });

type Row = { surface: string; violations: { id: string; impact: string | null; nodes: number }[] };
const REPORT: Row[] = [];
const OUT = resolve(__dirname, "..", "docs", "release-1.2.0", "axe-report.json");

test.afterAll(() => {
  mkdirSync(resolve(OUT, ".."), { recursive: true });
  writeFileSync(OUT, JSON.stringify(REPORT, null, 2) + "\n");
});

async function audit(page: Page, surface: string, include?: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]);
  if (include) builder = builder.include(include);
  const res = await builder.analyze();
  REPORT.push({
    surface,
    violations: res.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, nodes: v.nodes.length })),
  });
  const blocking = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    `${surface}: serious/critical axe violations`
  ).toEqual([]);
}

async function setTheme(sw: Worker, theme: "light" | "dark"): Promise<void> {
  await sw.evaluate(async (t) => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, theme: t } });
  }, theme);
}

for (const theme of ["light", "dark"] as const) {
  test(`overlay (${theme}): search, results, ask, digest, forget menu`, async ({ context, serviceWorker }) => {
    await setTheme(serviceWorker, theme);
    await routeArticle(context, "Axe audit article about local memory");
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`http://cortex-e2e.test/axe-${theme}`);
    await page.waitForTimeout(2500);
    await openOverlayViaToolbar(page, serviceWorker);
    await audit(page, `overlay ${theme} search idle`, "#cortex-overlay-root");

    await page.keyboard.type("local memory");
    await page.waitForTimeout(1500);
    await audit(page, `overlay ${theme} search results`, "#cortex-overlay-root");

    await clickInShadow(page, "cortex-tab", "Ask");
    await page.waitForTimeout(600);
    await audit(page, `overlay ${theme} ask`, "#cortex-overlay-root");

    await clickInShadow(page, "cortex-tab", "Digest");
    await page.waitForTimeout(1500);
    await audit(page, `overlay ${theme} digest`, "#cortex-overlay-root");

    await clickInShadow(page, "cortex-menu-btn");
    await page.waitForTimeout(200);
    await audit(page, `overlay ${theme} forget menu`, "#cortex-overlay-root");
  });
}

test("narrow overlay (360px): ask with chats drawer open", async ({ context, serviceWorker }) => {
  await routeArticle(context, "Axe narrow article");
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("http://cortex-e2e.test/axe-narrow");
  await openOverlayViaToolbar(page, serviceWorker);
  await clickInShadow(page, "cortex-tab", "Ask");
  await clickInShadow(page, "cortex-chat-drawer-toggle");
  await page.waitForTimeout(300);
  await audit(page, "overlay narrow ask drawer", "#cortex-overlay-root");
});

for (const path of ["options.html", "popup.html", "onboarding.html", "search-shell.html"]) {
  test(`extension page: ${path}`, async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/${path}`);
    await page.waitForTimeout(1200);
    await audit(page, path);
  });
}
