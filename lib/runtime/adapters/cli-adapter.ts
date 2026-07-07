// Real CLI AgentAdapter — the COMMON SMOKE RUNNER (Issue 3A).
//
// This is the first real-subprocess adapter. It proves the existing
// AgentAdapter boundary (lib/runtime/adapter.ts) works against a real external
// Agent CLI BEFORE Issue 04 / 14 build more workbench UI on top of it.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ WHAT THIS IS (and is NOT)                                                │
// │  • A minimal, CLI-binary-agnostic smoke runner. The command + args come  │
// │    from CONFIG (env), so Codex / Claude Code / Cursor profiles can plug  │
// │    in later WITHOUT changing this runner.                                │
// │  • It spawns `command args...`, marshals the serializable TaskPayload as  │
// │    JSON over stdin, collects stdout, and emits ACP-flavored events.      │
// │  • It reuses the EXISTING Issue 03 plumbing: the runner validates the     │
// │    `done` output against the real_agent_smoke zod schema AT THE INTAKE   │
// │    POINT ONLY (pass -> done, fail -> failed/invalid_output).             │
// │  • Cancellation has TWO channels (Issue 3A cancel-leak fix):            │
// │      (1) adapter.cancel() — PRIMARY. The runner's onTimeout() calls it   │
// │      directly; it SIGKILLs the child immediately. This is the ONLY       │
// │      channel that reliably kills a hung subprocess (iterator.return()   │
// │      alone is queued behind the runner's pending it.next() and never    │
// │      processed, so the generator's `finally` never runs — the leak).    │
// │      (2) iterator.return() — SECONDARY, cooperative. Still called as a  │
// │      belt-and-suspenders signal; harmless once cancel() killed the child.│
// │    There is NO AbortSignal in the payload — the payload stays            │
// │    serializable for subprocess marshalling (hard constraint from         │
// │    adapter.ts). The cancel handle lives on the ADAPTER INSTANCE, never   │
// │    in the payload.                                                        │
// │  • Parent-crash net (minimal, 3A): live CLI children are tracked in a     │
// │    globalThis Set and SIGKILLed on process "exit" AND on catchable        │
// │    signals (SIGINT/SIGTERM/SIGHUP) so a Runtime crash / graceful shutdown │
// │    before timeout does not orphan them to PID 1. Handlers are installed   │
// │    lazily on the first real spawn (not at import time) and are            │
// │    globalThis-guarded so HMR reloads register only one handler set.       │
// │    Full process-group isolation (also covering SIGKILL/segfault of the    │
// │    Runtime) is Issue 14.                                                  │
// │                                                                           │
// │  • It does NOT ingest Figma, call Figma MCP, create design-system files,  │
// │    generate prototype code, or edit the user's project.                   │
// │  • It does NOT implement repair (Issue 13), multi-provider profiles, the │
// │    --output-schema flag convention, or hardening (all Issue 14).           │
// │  • HONEST FAILURE IS MANDATORY: missing command / not configured /        │
// │    non-zero exit / stderr-only / invalid JSON / timeout / permission-     │
// │    prompt-stuck all surface as a `failed` task with an honest reason.    │
// │    This adapter NEVER invents a successful smoke result.                  │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Failure → TaskErrorCode mapping (closed union in adapter.ts):
//   spawn ENOENT / not configured      -> adapter_error  ("command not found" / "not configured")
//   non-zero exit                      -> adapter_error  ("exited with code N: <stderr>")
//   exit 0 + empty stdout              -> invalid_output ("produced no stdout: <stderr>")
//   exit 0 + unparseable stdout         -> invalid_output ("stdout was not valid JSON: <snippet>")
//   exit 0 + valid JSON                 -> done(parsed)   (intake validates shape; wrong shape -> invalid_output)
//   killed by signal (timeout / cancel) -> the RUNNER finalizes failed/timeout; the adapter just stops.

import { spawn, type ChildProcess } from "node:child_process";
import type {
  AgentAdapter,
  AdapterEvent,
  TaskPayload
} from "../adapter";

// ── Parent-crash orphan net (minimal, Issue 3A) ─────────────────────────────
// Track every live CLI subprocess this module has spawned, so that if the
// Runtime is terminated before a task's onTimeout() fires, we SIGKILL the
// children instead of letting them be reparented to PID 1.
//
// Coverage (honest):
//   • process.exit() — caught by the "exit" handler (backstop below).
//   • SIGINT / SIGTERM / SIGHUP — caught by explicit handlers that kill the
//     children first, then exit with the conventional 128+signum code.
//   • NOT covered: SIGKILL of the Runtime, or a hard segfault/crash. No
//     user-space handler can catch those — full process-group isolation
//     (spawn detached in its own pgrp, kill the whole group) is Issue 14.
//
// Why explicit signal handlers (not just "exit"): process.on("exit") does NOT
// fire when the process is terminated by a signal's default disposition — it
// only fires on an explicit process.exit(). Empirically, `next start` does
// NOT convert SIGTERM into process.exit(), so an "exit"-only net leaves
// children orphaned on a signal kill. The signal handlers close that gap for
// every CATCHABLE termination signal; SIGKILL/segfault remain Issue 14.
// Parent-crash orphan-net state lives on globalThis (mirrors task-runner.ts
// `liveHandles` and session.ts). Next.js dev HMR reloads this module, which
// re-runs the module body. A module-level `Set`/`let` would be re-created on
// every reload, so each reload would register ANOTHER set of signal handlers,
// each closing over a DIFFERENT (stale) Set; the first (old) handler fires
// first and exits the process, so the real child tracked in the NEW module's
// Set would never be SIGKILLed → orphan. One globalThis registry + one
// installed-flag means only ONE handler set is ever installed and it always
// references the live Set, across reloads.
const G = globalThis as unknown as {
  __IKRAN_LIVE_CHILDREN?: Set<ChildProcess>;
  __IKRAN_EXIT_CLEANUP_INSTALLED?: boolean;
};
const liveChildren: Set<ChildProcess> =
  G.__IKRAN_LIVE_CHILDREN ?? (G.__IKRAN_LIVE_CHILDREN = new Set());

// A child is "live" (worth SIGKILLing) only if kill() has not been called on
// it AND it has not yet exited. Checking only `!child.killed` is insufficient:
// it would call kill() on children that already exited normally (a no-op that
// returns false, but ambiguous in lifecycle reasoning). Shared by the
// exit/signal handlers, cancel(), and the generator `finally` so every kill
// site uses ONE definition of "still running".
function isLive(child: ChildProcess): boolean {
  return (
    !child.killed &&
    child.exitCode === null &&
    child.signalCode === null
  );
}

// SIGKILL every still-running tracked child. Idempotent and safe to call from
// the exit handler, the signal handlers, or anywhere else: already-exited /
// already-killed children are skipped via isLive().
function killLiveChildren(): void {
  for (const child of liveChildren) {
    if (isLive(child)) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process may have just exited between the isLive check and the kill.
      }
    }
  }
}

// Conventional shell exit code for a process terminated by a signal
// (128 + signal number). We re-exit with this after killing children so the
// parent (shell / supervisor) still observes a signal-style exit, not 0.
const SIGNAL_EXIT_CODE: Readonly<Record<string, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143
};

// Install the exit/signal handlers. Idempotent + globalThis-guarded: safe to
// call on every real spawn and across HMR reloads — only the first call
// installs. NOT called at module import time: deferring to the first real
// spawn keeps this module import-side-effect-free, so tests that import
// task-runner → cli-adapter (e.g. tests/timeout-clamp.spec.ts) do not get the
// Playwright worker's signal behavior modified. The handlers are only needed
// once a real CLI child actually exists; run() calls this right before spawn.
function installExitCleanup(): void {
  if (G.__IKRAN_EXIT_CLEANUP_INSTALLED) return;
  G.__IKRAN_EXIT_CLEANUP_INSTALLED = true;
  // Backstop: fires on an explicit process.exit() from anywhere. Does NOT
  // fire on signal-terminated exit (handled below) or on SIGKILL/segfault
  // (uncatchable — Issue 14).
  process.on("exit", killLiveChildren);
  // Catchable termination signals. A listener on a signal SUPPRESSES Node's
  // default disposition for that signal, so these handlers MUST re-exit
  // (process.exit) — otherwise the process would stop dying on SIGTERM/SIGINT,
  // a behavior change. We kill the children synchronously first, then re-exit
  // with 128+signum. `once` guards against re-entry on a repeated signal.
  //
  // The re-exit is DEFERRED via setImmediate: a synchronous process.exit()
  // inside the listener terminates the process before any later
  // signal-listener (Next dev, test harness, Runtime shutdown hooks) in the
  // same signal's listener round can run, silently bypassing their shutdown
  // semantics. setImmediate yields one tick so those listeners run, then
  // still guarantees we re-exit (a listener suppresses Node's default
  // disposition, so without an explicit exit the process would survive the
  // signal).
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      killLiveChildren();
      const code = SIGNAL_EXIT_CODE[sig] ?? 1;
      setImmediate(() => {
        process.exit(code);
      });
    });
  }
}

export interface CliAdapterOptions {
  /** Executable to spawn, e.g. "node" or "codex". */
  command: string;
  /** Args appended after the command, e.g. ["/abs/path/to/agent-cli.mjs"]. */
  args: string[];
  /** cwd for the child; defaults to process.cwd(). */
  cwd?: string;
  /** Extra env merged over process.env for the child. */
  env?: NodeJS.ProcessEnv;
}

// Resolve the CLI command + args from CONFIG (env). This is the single point a
// real Codex / Claude Code / Cursor profile plugs into: set
// IKRAN_AGENT_CLI_COMMAND + IKRAN_AGENT_CLI_ARGS (a JSON array, or a
// whitespace-split string) and the same runner spawns that profile. Returns
// null when no command is configured so the runner can fail honestly instead
// of inventing a default.
export function resolveCliCommand(): {
  command: string;
  args: string[];
} | null {
  const command = process.env.IKRAN_AGENT_CLI_COMMAND?.trim();
  if (!command) return null;
  const argsRaw = process.env.IKRAN_AGENT_CLI_ARGS;
  let args: string[] = [];
  if (argsRaw && argsRaw.trim()) {
    try {
      const parsed: unknown = JSON.parse(argsRaw);
      if (Array.isArray(parsed)) {
        args = parsed.map((a) => String(a));
      } else {
        args = String(parsed).split(/\s+/).filter(Boolean);
      }
    } catch {
      // Not JSON -> treat as a whitespace-separated arg string.
      args = argsRaw.split(/\s+/).filter(Boolean);
    }
  }
  return { command, args };
}

// Adapter used when no CLI command is configured. Emits a single honest
// `error` so the task fails (adapter_error) with a clear reason, instead of
// silently doing nothing or fabricating a success.
export function getNoCliAdapter(reason: string): AgentAdapter {
  return {
    async *run(payload: TaskPayload): AsyncIterable<AdapterEvent> {
      yield {
        kind: "progress",
        message: `real_agent_smoke: ${reason}`
      };
      yield {
        kind: "error",
        error: { code: "adapter_error", message: reason }
      };
    }
  };
}

// The common smoke runner. Spawns the configured CLI, marshals the payload,
// collects stdout, and emits ACP-flavored events.
export function getCliAdapter(opts: CliAdapterOptions): AgentAdapter {
  // Instance-level state shared between run() and cancel() so the runner can
  // kill the subprocess DIRECTLY on timeout/cancel (Issue 3A cancel-leak fix).
  // `iterator.return()` alone CANNOT kill a hung child: while the runner is
  // concurrently draining the iterator (a pending it.next() is in flight),
  // .return() is queued behind that .next() and never processed, so the
  // generator's `finally` never runs and the child is orphaned. cancel()
  // SIGKILLs the child directly AND wakes the generator so its loop observes
  // `cancelled` and returns (running `finally` as a harmless no-op).
  let child: ChildProcess | null = null;
  let cancelled = false;
  let resolveWait: (() => void) | null = null;

  // Direct, reliable cancellation. Called by the runner's onTimeout/cancel
  // path. Idempotent: safe before the child is spawned, after it has exited,
  // or never. SIGKILLs the child immediately and wakes the generator so it
  // exits cleanly.
  function cancel(): void {
    cancelled = true;
    if (child && isLive(child)) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process may have just exited; ignore.
      }
    }
    if (resolveWait) {
      const r = resolveWait;
      resolveWait = null;
      r();
    }
  }

  return { run, cancel };

  async function* run(payload: TaskPayload): AsyncIterable<AdapterEvent> {
    // Install the parent-crash orphan-net handlers before the first real
    // spawn. Idempotent + globalThis-guarded (see installExitCleanup); a no-op
    // on every call after the first, including across HMR reloads.
    installExitCleanup();
    // Event/callback -> async-generator bridge. The child's stdio/close/error
    // callbacks push into `queued`; the generator drains `queued`. `terminal`
    // holds the final done/error event (set on close/error); once it is set and
    // the queue is drained, the generator yields terminal and returns.
    const queued: AdapterEvent[] = [];
    let terminal: AdapterEvent | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let heartbeatStep = 0;

    const wake = () => {
      if (resolveWait) {
        const r = resolveWait;
        resolveWait = null;
        r();
      }
    };
    const pushProgress = (message: string) => {
      if (cancelled || terminal) return;
      queued.push({ kind: "progress", message });
      wake();
    };
    const pushStepProgress = (message: string) => {
      if (cancelled || terminal) return;
      heartbeatStep += 1;
      queued.push({
        kind: "progress",
        message,
        data: { step: Math.min(heartbeatStep, 5.5) }
      });
      wake();
    };
    const setTerminal = (ev: AdapterEvent) => {
      if (cancelled) return;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      terminal = ev;
      wake();
    };

    try {
      yield { kind: "progress", message: `spawning agent CLI: ${opts.command}` };

      let stdoutBuf = "";
      let stderrBuf = "";

      try {
        child = spawn(opts.command, opts.args, {
          cwd: opts.cwd ?? process.cwd(),
          env: { ...process.env, ...opts.env },
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch (err) {
        // Synchronous spawn failure (rare; ENOENT is reported via 'error').
        const msg = `Agent CLI failed to spawn: ${
          err instanceof Error ? err.message : String(err)
        }`;
        yield { kind: "error", error: { code: "adapter_error", message: msg } };
        return;
      }

      // Track the live child for the parent-crash orphan net (see top of file).
      // Removed from the set on close/error so the exit handler only sees
      // children that are genuinely still running at process exit.
      if (child) {
        liveChildren.add(child);
        const forget = () => { liveChildren.delete(child as ChildProcess); };
        child.on("close", forget);
        child.on("error", forget);
      }

      // Race guard: if cancel() fired before spawn completed (runner timeout
      // raced ahead — extremely unlikely since spawn is synchronous, but cheap
      // to guard), kill the just-spawned child now. The loop's `if (cancelled)
      // return` then exits cleanly.
      if (cancelled && child && isLive(child)) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* process may have just exited */
        }
      }

      child.stdout?.setEncoding("utf-8");
      child.stderr?.setEncoding("utf-8");

      child.stdout?.on("data", (chunk: string) => {
        if (cancelled) return;
        stdoutBuf += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        if (cancelled) return;
        stderrBuf += chunk;
        // Surface stderr as progress telemetry so a human can see what the
        // real Agent CLI is saying (Codex/Claude print progress to stderr).
        const line = chunk.trimEnd();
        if (line) pushProgress(`agent: ${line}`);
      });
      child.on("error", (err: Error) => {
        // ENOENT lands here: the configured command binary does not exist.
        const msg = err.message.includes("ENOENT")
          ? `Agent CLI command not found: ${opts.command}`
          : `Agent CLI spawn error: ${err.message}`;
        setTerminal({
          kind: "error",
          error: { code: "adapter_error", message: msg }
        });
      });
      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        if (cancelled) return;
        if (signal) {
          // Killed (typically by our return() on timeout/cancel). The runner
          // has already finalized; emit an honest error so a standalone run
          // (no runner) also surfaces it.
          setTerminal({
            kind: "error",
            error: {
              code: "adapter_error",
              message: `Agent CLI killed by signal ${signal}`
            }
          });
          return;
        }
        if (code !== null && code !== 0) {
          const stderrSnippet = stderrBuf.trim().slice(0, 500);
          const msg = `Agent CLI exited with code ${code}${
            stderrSnippet ? `: ${stderrSnippet}` : ""
          }`;
          setTerminal({
            kind: "error",
            error: { code: "adapter_error", message: msg }
          });
          return;
        }
        // exit 0: the Agent's stdout must be valid JSON.
        const trimmed = stdoutBuf.trim();
        if (!trimmed) {
          const stderrSnippet = stderrBuf.trim().slice(0, 500);
          const msg = `Agent CLI produced no stdout${
            stderrSnippet ? `: ${stderrSnippet}` : ""
          }`;
          setTerminal({
            kind: "error",
            error: { code: "invalid_output", message: msg }
          });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          const snippet = trimmed.slice(0, 120);
          setTerminal({
            kind: "error",
            error: {
              code: "invalid_output",
              message: `Agent stdout was not valid JSON: ${snippet}`
            }
          });
          return;
        }
        // Parsed OK -> hand to the runner for intake-point schema validation.
        setTerminal({ kind: "done", output: parsed });
      });

      // Marshal the serializable payload to the child's stdin and close it so
      // the Agent CLI receives a complete JSON document and can proceed.
      const stdinJson = JSON.stringify(payload);
      try {
        child.stdin?.write(stdinJson);
        child.stdin?.end();
      } catch {
        // Child may have exited before stdin was writable; the close/error
        // handler will produce the honest terminal event. Ignore the write failure.
      }

      pushProgress("agent CLI running");
      heartbeat = setInterval(() => {
        pushStepProgress("agent CLI still running");
      }, 700);

      // Drain queued events, then yield the terminal event and return.
      while (true) {
        // cancel() may have fired while we were suspended at the await below
        // (it SIGKILLs the child + resolves resolveWait, waking us). Exit
        // silently — the runner has already finalized the task (timeout /
        // cancel), so a terminal event here would be dropped by the runner
        // anyway (handle.status !== "running"). The `finally` below still runs
        // as a harmless no-op (child already killed).
        if (cancelled) return;
        if (queued.length > 0) {
          yield queued.shift() as AdapterEvent;
          continue;
        }
        if (terminal) {
          yield terminal;
          return;
        }
        // Wait for the next stdio/close event. cancel() resolves this promise
        // directly; wake() resolves it from event callbacks.
        await new Promise<void>((r) => {
          resolveWait = r;
        });
        resolveWait = null;
      }
    } finally {
      // Secondary cleanup. With cancel() as the primary kill path, this runs
      // as a no-op on cancel (child already SIGKILLed) and as the normal
      // cleanup on clean exit / iterator.return(). Kept so a hung child is
      // never leaked even if cancel() was never wired (defense in depth).
      cancelled = true;
      resolveWait = null;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (child && isLive(child)) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process may have just exited; ignore.
        }
      }
    }
  }
}
