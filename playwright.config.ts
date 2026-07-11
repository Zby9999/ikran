import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Unit / pure tests live under tests/unit (Vitest). Keep them out of
  // Playwright so they never trigger globalSetup's Next build.
  testIgnore: ["**/unit/**", "**/helpers/**"],
  // Produce one `next build` before workers start; each worker then serves that
  // build via `next start` on its own port with its own IKRAN_STATE_DIR (see
  // tests/fixtures.ts). This is what enables real parallelism (workers>1)
  // without clobbering the runtime's single active-project pointer: isolation
  // is per worker process + per worker state dir, not serialization.
  globalSetup: "./tests/global-setup",
  // Parallel e2e: each worker spawns its own isolated Ikran Runtime (Next
  // start on a unique port + own IKRAN_STATE_DIR + own IKRAN_NEXT_DIST_DIR) via
  // the worker-scoped `runtime` fixture in tests/fixtures.ts. No shared
  // webServer — the runtime is a single-project-per-process singleton by PRD
  // design, so test isolation is achieved by giving each worker its own
  // runtime process, not by serializing.
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    // Fallback only; tests navigate to their worker's runtime.baseURL
    // (absolute) from the `runtime` fixture, so this is rarely used.
    baseURL: "http://localhost:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});