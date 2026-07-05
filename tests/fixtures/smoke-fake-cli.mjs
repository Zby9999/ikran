#!/usr/bin/env node
// Fake external Agent CLI for the real_agent_smoke e2e (Issue 3A).
//
// This is a TEST DOUBLE — deterministic, offline, no network, no real agent.
// It is the "fake local CLI command" the acceptance criteria require so CI
// does not depend on Codex / Claude Code / Cursor / network / credentials.
//
// Contract (mirrors what a real headless Agent CLI would do, minus the LLM):
//   - Reads a JSON task payload from stdin. The payload is the serializable
//     TaskPayload produced by lib/runtime/adapters/cli-adapter.ts:
//     { family: "real_agent_smoke", input: { mode?: string, ... }, mock?: ... }.
//   - Selects behavior from input.mode. Each mode simulates one failure shape
//     the smoke runner must surface honestly (acceptance: "invalid JSON,
//     non-zero exit, stderr-only failure, timeout or missing command all
//     produce an honest failed task state").
//   - On success, prints a JSON object conforming to RealAgentSmokeResult
//     to stdout and exits 0. The runner then schema-validates it at the
//     intake point (reusing the existing Issue 03 plumbing).
//
// Mode map:
//   success          -> valid smoke JSON, exit 0
//   timeout          -> sleep silently past the runner's per-task timeout
//   nonzero_exit     -> brief stderr, exit 2
//   invalid_json     -> non-JSON stdout, exit 0
//   stderr_error     -> stderr only, exit 0 (no stdout)
//   not_installed    -> "command not found" stderr, exit 127
//   permission_stuck -> stderr "Permission required" (after a short delay so
//                       the SSE subscriber can observe it), then wait on stdin
//                       forever (simulates a stuck permission prompt) -> the
//                       runner's timeout kills the child -> failed/timeout.
//
// `input.mode` is a TEST-ONLY control field. A real Agent CLI (Issue 14)
// receives the same payload but ignores `mode`; its real contract is owned
// by the hardened headless CLI adapter, NOT by this smoke slice.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { writeFileSync } from "node:fs";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    // If stdin is never piped (no adapter wrote to it), resolve empty so the
    // process does not hang on a TTY.
    if (process.stdin.isTTY) resolve("");
    // Safety: resolve empty after 2s if no end event (should not happen via
    // the adapter, which always writes+ends stdin).
    setTimeout(() => resolve(data), 2000);
  });
}

const raw = await readStdin();
let payload = {};
try {
  payload = JSON.parse(raw || "{}");
} catch {
  payload = {};
}
const mode = (payload && payload.input && payload.input.mode) || "success";

switch (mode) {
  case "success": {
    const result = {
      message: "smoke ok",
      checklist: [
        { label: "runtime reached agent cli", done: true },
        { label: "agent returned json", done: true },
        { label: "json conforms to smoke schema", done: true }
      ]
    };
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  }

  case "timeout": {
    // Sleep far longer than any reasonable per-task timeout the test sets.
    await sleep(30_000);
    process.exit(0);
  }

  case "nonzero_exit": {
    process.stderr.write("agent-cli: internal error during smoke\n");
    process.exit(2);
  }

  case "invalid_json": {
    process.stdout.write("this is not valid json {{{");
    process.exit(0);
  }

  case "stderr_error": {
    process.stderr.write("Error: agent authentication required\n");
    process.exit(0);
  }

  case "not_installed": {
    process.stderr.write("agent-cli: command not found on PATH\n");
    process.exit(127);
  }

  case "permission_stuck": {
    // Delay slightly so the SSE subscriber (opened right after POST) has time
    // to connect and capture this progress-bearing stderr frame, then wait
    // forever. The runner's per-task timeout fires -> failed/timeout.
    await sleep(250);
    process.stderr.write("Permission required: awaiting user approval\n");
    await sleep(60_000);
    process.exit(0);
  }

  case "hang_with_pid": {
    // Leak-detection mode (Issue 3A cancel-leak test): write this process's
    // pid to IKRAN_FAKE_CLI_PIDFILE (if set) so the test can assert the runner
    // actually SIGKILLs the child on timeout, then hang forever. WITHOUT the
    // adapter.cancel() fix the child is orphaned and stays alive past timeout.
    const pidFile = process.env.IKRAN_FAKE_CLI_PIDFILE;
    if (pidFile) {
      try { writeFileSync(pidFile, String(process.pid)); } catch { /* ignore */ }
    }
    // Keep the event loop alive forever (do NOT exit). setInterval is a
    // keepalive handle so the process only dies when SIGKILLed by cancel().
    setInterval(() => {}, 1000);
    break; // MUST break — no process.exit here, so without break the switch
           // falls through to `default` and exits(1), defeating the hang.
  }

  default: {
    process.stderr.write(`agent-cli: unknown fake mode "${mode}"\n`);
    process.exit(1);
  }
}