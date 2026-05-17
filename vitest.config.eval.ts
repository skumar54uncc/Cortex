import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __CORTEX_DEBUG__: false,
  },
  test: {
    environment: "node",
    setupFiles: ["eval/setup-fake-idb.ts"],
    include: ["eval/__tests__/**/*.test.ts"],
    globals: false,
  },
});
