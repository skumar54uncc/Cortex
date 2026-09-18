import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __CORTEX_DEBUG__: false,
    __CORTEX_E2E_OPEN_SHADOW__: false,
  },
  test: {
    environment: "node",
    setupFiles: ["eval/setup-fake-idb.ts"],
    include: ["eval/__tests__/**/*.test.ts"],
    globals: false,
  },
});
