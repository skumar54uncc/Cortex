import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __CORTEX_DEBUG__: false,
    __CORTEX_E2E_OPEN_SHADOW__: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: false,
  },
});
