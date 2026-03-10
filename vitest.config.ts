import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 55,
      },
    },
    testTimeout: 30000,
    server: {
      deps: {
        // ws must NOT be inlined — it uses node:http upgrade events
        // that break when Vite transforms the module.
        external: ["ws"],
      },
    },
  },
});
