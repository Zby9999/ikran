import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit / pure-function pyramid (Vitest).
 * Does NOT run Playwright globalSetup — no Next build.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Keep Vitest out of Playwright e2e / helpers / fixtures.
    exclude: ["node_modules", "tests/helpers/**", "tests/fixtures/**"]
  }
});
