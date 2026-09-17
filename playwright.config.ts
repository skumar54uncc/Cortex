import { defineConfig } from "@playwright/test";

/**
 * E2E against the unpacked extension in dist/. Run `npm run build` first.
 * Chromium extensions need a persistent context; see e2e/fixtures.ts.
 */
export default defineConfig({
  testDir: "./e2e",
  /** QA screenshot capture (docs/release-1.2.0/qa) only when CORTEX_QA=1. */
  testIgnore: process.env.CORTEX_QA ? [] : ["**/qa/**"],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  // One retry in CI: the synthetic toolbar dispatch can race the tab activation on a cold profile.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
