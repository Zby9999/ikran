// Smoke fixture: extends the shared worker-scoped Runtime fixture with the
// env vars that point the real_agent_smoke family at the fake local CLI.
//
// This keeps the existing tests/fixtures.ts spawn logic untouched (backward
// compatible) and lets tests/real-agent-smoke.spec.ts drive a real subprocess
// (the fake CLI) through the SAME Browser UI -> Runtime -> adapter -> SSE path
// the mocked adapter proved, without depending on Codex / Claude Code /
// Cursor / network / credentials.
//
// The CLI command + args come from CONFIG (env), so the runner stays
// CLI-binary-agnostic: Codex / Claude Code / Cursor profiles can plug in later
// by changing IKRAN_AGENT_CLI_COMMAND / IKRAN_AGENT_CLI_ARGS without touching
// the runner (Issue 14 formalizes multi-provider profiles).

import path from "node:path";
import { tmpdir } from "node:os";
import { test as base } from "./fixtures";

// Resolve the fake CLI abs path relative to the repo root (tests run from the
// repo cwd), so the spawned Runtime child can find it regardless of worker.
const SMOKE_FAKE_CLI_PATH = path.resolve(
  process.cwd(),
  "tests",
  "fixtures",
  "smoke-fake-cli.mjs"
);

// Per-worker pidfile the fake CLI writes its pid to in `hang_with_pid` mode.
// Keyed by the worker's process.pid so parallel workers (separate processes)
// never collide. Exported so the leak test reads the SAME path the Runtime
// child inherits via env, without recomputing the convention in two places.
export const SMOKE_FAKE_CLI_PIDFILE = path.join(
  tmpdir(),
  `ikran-fake-cli-pid-${process.pid}.txt`
);

export const test = base.extend<{}, { runtimeEnv: Record<string, string> }>({
  runtimeEnv: [
    async ({}, use) => {
      await use({
        // The common smoke runner spawns `command args...` and marshals the
        // serializable TaskPayload as JSON over stdin. Here we point it at
        // the deterministic, offline fake CLI.
        IKRAN_AGENT_CLI_COMMAND: "node",
        IKRAN_AGENT_CLI_ARGS: JSON.stringify([SMOKE_FAKE_CLI_PATH]),
        // Pidfile the fake CLI writes to in `hang_with_pid` mode so the leak
        // test can assert the runner SIGKILLs the child on timeout.
        IKRAN_FAKE_CLI_PIDFILE: SMOKE_FAKE_CLI_PIDFILE
      });
    },
    { scope: "worker" }
  ]
});

export { expect } from "./fixtures";