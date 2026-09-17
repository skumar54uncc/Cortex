import { defineConfig } from "@playwright/test";

/**
 * E2E against the unpacked extension in dist/. Run `npm run build` first.
 * Chromium extensions need a persistent context; see e2e/fixtures.ts.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
