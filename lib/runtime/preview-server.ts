// Runtime-owned prototype dev-server lifecycle (Issue 30).
//
// The Agent writes prototype code and declares the artifact; it never
// supervises a dev server. Runtime owns install → start → probe and reports an
// explicit readiness (installing / starting / ready / failed) instead of a
// vague "loading". Every terminal path is reachable: a failed install, an
// occupied port that is not a live preview, a process that dies, and a probe
// that never succeeds all end in `failed` rather than hanging.
//
// A ready surface stays live until its process exits; Runtime then marks the
// surface stale and stops there — it never auto-restarts (Issue 30 stale
// semantics mirror the Figma evidence stale warning).
//
// All host effects go through `PreviewSupervisorDeps` so unit tests exercise
// the state machine without spawning processes or binding ports.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { stopAllPrototypePreviewRefresh } from "./prototype-preview-refresh";

export type PreviewReadiness =
  | "installing"
  | "starting"
  | "ready"
  | "failed";

/** First port Runtime hands to a prototype preview. */
export const PREVIEW_PORT_BASE = 4300;
export const PREVIEW_PORT_RANGE = 100;

/** Overall budget for one record_preview readiness attempt. */
export const PREVIEW_READY_TIMEOUT_MS = 90_000;
/** A preview must keep answering across this window before it is declared ready. */
export const PREVIEW_STABLE_WINDOW_MS = 750;
const PREVIEW_PROBE_INTERVAL_MS = 250;
const PREVIEW_DIAGNOSTIC_LIMIT = 2_000;
export const PREVIEW_DEPENDENCY_FINGERPRINT_FILE =
  ".ikran-dependency-fingerprint";

export type PreviewFailureKind =
  | "install_failed"
  | "port_conflict"
  | "command_not_found"
  | "dev_server_exited"
  | "preview_timeout";

export type PreviewFailureDiagnosis = {
  kind: PreviewFailureKind;
  exitCode?: number | null;
  signal?: string | null;
  stderrTail?: string;
};

export type PreviewProcessExit = {
  code: number | null;
  signal: string | null;
  stderrTail?: string;
};

export type PreviewDependencyInstallResult =
  | { ok: true }
  | {
      ok: false;
      exitCode?: number | null;
      signal?: string | null;
      stderrTail?: string;
    };

/**
 * The Agent declares a dev command, but Runtime owns the shell — `devCommand`
 * is executed with `shell: true`, so an unconstrained string would be a raw
 * exec channel bypassing the semantic-tool boundary. Only package-manager
 * script invocations are allowed (`npm run dev`, `pnpm dev`, `yarn dev`,
 * `bun run dev`, `npx vite`); anything with shell metacharacters, pipes,
 * chaining, or redirection is rejected before it ever reaches spawn.
 */
const ALLOWED_DEV_COMMAND =
  /^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+[a-zA-Z0-9:_-]+|npx\s+(?:[a-zA-Z0-9:@/._-]+\s+)?[a-zA-Z0-9:@/._-]+)$/;

export function isAllowedDevCommand(command: string): boolean {
  return ALLOWED_DEV_COMMAND.test(command.trim());
}

export interface PreviewProcessHandle {
  /** Resolves with the exit description once the dev server process ends. */
  exited: Promise<PreviewProcessExit>;
  kill(): void;
}

export interface PreviewSupervisorDeps {
  /** True when the prototype root already has installed dependencies. */
  dependenciesInstalled(root: string): boolean;
  /** Blocking dependency install; resolves false when it fails. */
  installDependencies(
    root: string
  ): Promise<boolean | PreviewDependencyInstallResult>;
  startDevServer(input: {
    root: string;
    command: string;
    port: number;
  }): PreviewProcessHandle;
  /** True when the URL answers with any HTTP response. */
  probeUrl(url: string): Promise<boolean>;
  isPortFree(port: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type PreviewStartOutcome = {
  readiness: PreviewReadiness;
  reason: PreviewFailureKind | null;
  diagnosis?: PreviewFailureDiagnosis;
};

/** Digest of the inputs that determine the installed prototype dependency tree. */
export function prototypeDependencyFingerprint(root: string): string | null {
  const inputs = ["package.json"];
  const lockfile = ["npm-shrinkwrap.json", "package-lock.json"].find((file) =>
    existsSync(path.join(root, file))
  );
  if (lockfile) inputs.push(lockfile);
  try {
    const hash = createHash("sha256");
    for (const relativePath of inputs) {
      hash.update(relativePath);
      hash.update("\0");
      hash.update(
        readFileSync(/* turbopackIgnore: true */ path.join(root, relativePath))
      );
      hash.update("\0");
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
}

export function previewDependencyInstallPlan(root: string): {
  command: "npm";
  args: string[];
} {
  const hasLock = ["npm-shrinkwrap.json", "package-lock.json"].some((file) =>
    existsSync(path.join(root, file))
  );
  return hasLock
    ? { command: "npm", args: ["ci", "--include=dev"] }
    : {
        command: "npm",
        args: ["install", "--include=dev", "--no-package-lock"]
      };
}

function sanitizeDiagnosticOutput(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let output = value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /\b((?:api[_-]?key|token|secret|password)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1[redacted]"
    )
    .replace(/\b(?:figd_|sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, "$1[redacted]@");
  if (output.length > PREVIEW_DIAGNOSTIC_LIMIT) {
    const marker = "\n...[truncated]...\n";
    const headLength = Math.floor((PREVIEW_DIAGNOSTIC_LIMIT - marker.length) / 2);
    output =
      output.slice(0, headLength) +
      marker +
      output.slice(-(PREVIEW_DIAGNOSTIC_LIMIT - marker.length - headLength));
  }
  return output.trim();
}

function exitDiagnosis(exit: PreviewProcessExit): PreviewFailureDiagnosis {
  const stderrTail = sanitizeDiagnosticOutput(exit.stderrTail);
  const commandMissing =
    exit.code === 127 || /(?:command not found|not found)/i.test(stderrTail ?? "");
  return {
    kind: commandMissing ? "command_not_found" : "dev_server_exited",
    exitCode: exit.code,
    signal: exit.signal,
    ...(stderrTail ? { stderrTail } : {})
  };
}

/**
 * Every dev server this Runtime spawned and has not seen exit. The Runtime
 * process owns these children, so a clean shutdown sweeps the registry
 * (`killAllPreviewServers`) instead of leaving orphaned servers behind.
 */
const livePreviewHandles = new Set<PreviewProcessHandle>();

/**
 * Handles stopped by Runtime shutdown rather than by an unexpected process
 * exit. A WeakSet lets the later `exited` continuation distinguish those two
 * causes without retaining completed handles. Shutdown parking owns the
 * surface state; if that best-effort DB write failed, leaving the previous
 * live row untouched lets the next Runtime recover it as an unclean shutdown.
 */
const intentionallyStoppedPreviewHandles = new WeakSet<PreviewProcessHandle>();

/**
 * Kill every Runtime-owned preview dev server. Called on Runtime shutdown;
 * the surfaces are marked stale (`runtime_shutdown`) separately, and the next
 * launch restores them from their persisted run records.
 */
export function killAllPreviewServers(): void {
  stopAllPrototypePreviewRefresh();
  for (const handle of livePreviewHandles) {
    try {
      intentionallyStoppedPreviewHandles.add(handle);
      handle.kill();
    } catch {
      // Process already gone — nothing to sweep.
    }
  }
  livePreviewHandles.clear();
}

export interface PreviewStartInput {
  root: string;
  command: string;
  port: number;
  url: string;
  timeoutMs?: number;
  /** Persist each readiness transition (surface row + lifecycle event). */
  onReadiness(readiness: PreviewReadiness, reason: string | null): void;
  /** Called once the ready dev server exits — surface becomes stale. */
  onExit(reason: string): void;
}

export function previewUrlForPort(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Drive one surface from install to ready. Returns the terminal readiness for
 * this attempt; `onReadiness` reports every intermediate transition so the
 * designer sees installing/starting rather than a blank wait.
 */
export async function startPreviewServer(
  input: PreviewStartInput,
  deps: PreviewSupervisorDeps = defaultPreviewSupervisorDeps
): Promise<PreviewStartOutcome> {
  const timeoutMs = input.timeoutMs ?? PREVIEW_READY_TIMEOUT_MS;
  const deadline = deps.now() + timeoutMs;

  if (!deps.dependenciesInstalled(input.root)) {
    input.onReadiness("installing", null);
    const installed = await deps.installDependencies(input.root);
    if (installed === false || (typeof installed === "object" && !installed.ok)) {
      const detail = typeof installed === "object" ? installed : undefined;
      const stderrTail = sanitizeDiagnosticOutput(detail?.stderrTail);
      const diagnosis: PreviewFailureDiagnosis = {
        kind: "install_failed",
        ...(detail?.exitCode !== undefined ? { exitCode: detail.exitCode } : {}),
        ...(detail?.signal !== undefined ? { signal: detail.signal } : {}),
        ...(stderrTail ? { stderrTail } : {})
      };
      input.onReadiness("failed", "install_failed");
      return { readiness: "failed", reason: "install_failed", diagnosis };
    }
  }

  input.onReadiness("starting", null);

  // An occupied port is only usable when it already answers as this preview;
  // anything else is a conflict the designer must resolve, not a retry loop.
  if (!(await deps.isPortFree(input.port))) {
    let stableSince: number | null = null;
    while (deps.now() < deadline) {
      if (!(await deps.probeUrl(input.url))) {
        input.onReadiness("failed", "port_conflict");
        return {
          readiness: "failed",
          reason: "port_conflict",
          diagnosis: { kind: "port_conflict" }
        };
      }
      stableSince ??= deps.now();
      if (deps.now() - stableSince >= PREVIEW_STABLE_WINDOW_MS) {
        input.onReadiness("ready", null);
        return { readiness: "ready", reason: null };
      }
      await deps.sleep(PREVIEW_PROBE_INTERVAL_MS);
    }
    input.onReadiness("failed", "preview_timeout");
    return {
      readiness: "failed",
      reason: "preview_timeout",
      diagnosis: { kind: "preview_timeout" }
    };
  }

  const handle = deps.startDevServer({
    root: input.root,
    command: input.command,
    port: input.port
  });
  livePreviewHandles.add(handle);

  let processExit: PreviewProcessExit | null = null;
  void handle.exited.then((exit) => {
    livePreviewHandles.delete(handle);
    processExit = processExit ?? exit;
  });

  let stableSince: number | null = null;
  while (deps.now() < deadline) {
    if (processExit) {
      const diagnosis = exitDiagnosis(processExit);
      input.onReadiness("failed", diagnosis.kind);
      return { readiness: "failed", reason: diagnosis.kind, diagnosis };
    }
    if (await deps.probeUrl(input.url)) {
      stableSince ??= deps.now();
      if (deps.now() - stableSince >= PREVIEW_STABLE_WINDOW_MS) {
        input.onReadiness("ready", null);
        // No auto-restart: a later exit only marks the surface stale.
        void handle.exited.then(() => {
          if (!intentionallyStoppedPreviewHandles.has(handle)) {
            input.onExit("dev_server_exited");
          }
        });
        return { readiness: "ready", reason: null };
      }
    } else {
      stableSince = null;
    }
    await deps.sleep(PREVIEW_PROBE_INTERVAL_MS);
  }

  handle.kill();
  livePreviewHandles.delete(handle);
  input.onReadiness("failed", "preview_timeout");
  return {
    readiness: "failed",
    reason: "preview_timeout",
    diagnosis: { kind: "preview_timeout" }
  };
}

/**
 * First port not already claimed by another surface and free on the host.
 * Persisted on the surface row so the preview URL stays stable across runs.
 */
export async function allocatePreviewPort(
  takenPorts: readonly number[],
  deps: PreviewSupervisorDeps = defaultPreviewSupervisorDeps
): Promise<number | null> {
  const taken = new Set(takenPorts);
  for (let offset = 0; offset < PREVIEW_PORT_RANGE; offset++) {
    const port = PREVIEW_PORT_BASE + offset;
    if (taken.has(port)) continue;
    if (await deps.isPortFree(port)) return port;
  }
  return null;
}

function shellCommand(root: string, command: string, port: number) {
  return spawn(command, {
    cwd: root,
    shell: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(port) }
  });
}

export const defaultPreviewSupervisorDeps: PreviewSupervisorDeps = {
  dependenciesInstalled(root) {
    const fingerprint = prototypeDependencyFingerprint(root);
    if (!fingerprint) return false;
    try {
      return (
        readFileSync(
          path.join(root, "node_modules", PREVIEW_DEPENDENCY_FINGERPRINT_FILE),
          "utf8"
        ).trim() === fingerprint
      );
    } catch {
      return false;
    }
  },
  installDependencies(root) {
    return new Promise((resolve) => {
      const fingerprint = prototypeDependencyFingerprint(root);
      if (!fingerprint) {
        resolve({ ok: false, stderrTail: "package.json is missing or unreadable" });
        return;
      }
      const plan = previewDependencyInstallPlan(root);
      const child = spawn(plan.command, plan.args, {
        cwd: root,
        shell: false,
        stdio: ["ignore", "ignore", "pipe"]
      });
      let settled = false;
      let stderrTail = "";
      child.stderr?.on("data", (chunk) => {
        stderrTail = `${stderrTail}${String(chunk)}`.slice(-8_000);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, stderrTail: `${stderrTail}\n${error.message}` });
      });
      child.on("exit", (code, signal) => {
        if (settled) return;
        settled = true;
        if (code !== 0) {
          resolve({ ok: false, exitCode: code, signal, stderrTail });
          return;
        }
        try {
          writeFileSync(
            path.join(root, "node_modules", PREVIEW_DEPENDENCY_FINGERPRINT_FILE),
            `${fingerprint}\n`,
            "utf8"
          );
          resolve({ ok: true });
        } catch (error) {
          resolve({
            ok: false,
            exitCode: code,
            signal,
            stderrTail: error instanceof Error ? error.message : String(error)
          });
        }
      });
    });
  },
  startDevServer({ root, command, port }) {
    const child = shellCommand(root, command, port);
    const exited = new Promise<PreviewProcessExit>(
      (resolve) => {
        let settled = false;
        let stderrTail = "";
        child.stderr?.on("data", (chunk) => {
          stderrTail = `${stderrTail}${String(chunk)}`.slice(-8_000);
        });
        child.on("error", (error) => {
          if (settled) return;
          settled = true;
          resolve({
            code: null,
            signal: null,
            stderrTail: `${stderrTail}\n${error.message}`
          });
        });
        child.on("exit", (code, signal) => {
          if (settled) return;
          settled = true;
          resolve({ code, signal, stderrTail });
        });
      }
    );
    return {
      exited,
      kill() {
        try {
          child.kill();
        } catch {
          // Process already gone — nothing to supervise.
        }
      }
    };
  },
  async probeUrl(url) {
    try {
      const response = await fetch(url, { method: "GET" });
      return response.status > 0;
    } catch {
      return false;
    }
  },
  isPortFree(port) {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  },
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
  now() {
    return Date.now();
  }
};
