// Issue 3A — real_agent_smoke: the COMMON SMOKE RUNNER.
//
// This is a technical-readiness slice (NOT product workflow). It proves the
// existing AgentAdapter boundary (lib/runtime/adapter.ts) works against ONE
// real external subprocess before Issue 04 / 14 build more on top of it.
//
// What this spec exercises:
//   - The real_agent_smoke task family flows through the EXISTING Issue 03
//     plumbing (task create -> running/completed/failed -> SSE -> zod intake
//     validation -> SQLite + JSONL persistence) without changing the
//     Browser UI -> Runtime API contract.
//   - The CLI adapter (lib/runtime/adapters/cli-adapter.ts) spawns a
//     configured command (env: IKRAN_AGENT_CLI_COMMAND / IKRAN_AGENT_CLI_ARGS,
//     injected by tests/smoke-fixtures.ts), marshals the serializable
//     TaskPayload as JSON over stdin, collects stdout, and emits ACP-flavored
//     events. The command is CONFIG so Codex / Claude Code / Cursor profiles
//     can plug in later WITHOUT changing the runner.
//   - A deterministic, offline fake CLI (tests/fixtures/smoke-fake-cli.mjs)
//     simulates every required failure mode. CI never touches real agent
//     binaries, the network, or user credentials.
//   - HONEST FAILURE IS MANDATORY: every failure mode (CLI missing / not
//     configured / non-zero exit / stderr-only / invalid JSON / timeout /
//     permission-prompt-stuck) MUST surface as a `failed` task with an honest
//     reason. Runtime must NEVER invent a successful smoke result.
//
// Helpers mirror tests/agent-task-runner.spec.ts (raw node:http + raw SSE
// collector) so the full Browser UI -> Runtime -> adapter -> SSE -> 3-layer
// persistence path is driven end-to-end with no browser EventSource.

import http from "node:http";
import { expect, test, SMOKE_FAKE_CLI_PIDFILE } from "./smoke-fixtures";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getCliAdapter,
  resolveCliCommand,
  getNoCliAdapter
} from "../lib/runtime/adapters/cli-adapter";
import type { AdapterEvent, AdapterEventKind } from "../lib/runtime/adapter";

let port = 3000;
let baseURL = "http://localhost:3000";
let testFolder = "";

// ---- low-level HTTP helpers (mirror tests/agent-task-runner.spec.ts) ----

function rawGet(
  route: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: route, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.end();
  });
}

function rawPost(
  route: string,
  body: unknown,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const json = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(json),
          ...headers
        }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.write(json);
    req.end();
  });
}

// ---- SSE helpers ----

interface TaskFrame {
  kind: string;
  taskId: string;
  family: string;
  status: string;
  message?: string;
  data?: unknown;
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
  timestamp: string;
}

interface SSEHandle {
  promise: Promise<TaskFrame[]>;
  connected: Promise<void>;
}

function startTaskSSE(
  token: string,
  taskId: string,
  terminalKinds: string[],
  timeoutMs: number
): SSEHandle {
  let resolveConnected!: () => void;
  let resolveFrames!: (f: TaskFrame[]) => void;
  const connected = new Promise<void>((r) => {
    resolveConnected = r;
  });
  const promise = new Promise<TaskFrame[]>((r) => {
    resolveFrames = r;
  });
  const frames: TaskFrame[] = [];
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    try {
      req.destroy();
    } catch {
      /* ignore */
    }
    resolveFrames(frames);
  };

  const req = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: `/api/events?session=${encodeURIComponent(token)}&task=${encodeURIComponent(taskId)}`,
      method: "GET",
      headers: { host: `localhost:${port}` }
    },
    (res) => {
      res.setEncoding("utf-8");
      let buffer = "";
      let connectedResolved = false;
      const timer = setTimeout(finish, timeoutMs);

      res.on("data", (chunk: string) => {
        if (!connectedResolved) {
          connectedResolved = true;
          resolveConnected();
        }
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let ev = "";
          let dataLine = "";
          for (const line of raw.split("\n")) {
            if (line.startsWith("event: ")) ev = line.slice(7);
            else if (line.startsWith("data: ")) dataLine = line.slice(6);
          }
          if (ev === "task" && dataLine) {
            try {
              const data = JSON.parse(dataLine) as TaskFrame;
              frames.push(data);
              if (terminalKinds.includes(data.kind)) {
                clearTimeout(timer);
                finish();
              }
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      });
      res.on("end", () => {
        clearTimeout(timer);
        finish();
      });
      res.on("error", () => {
        clearTimeout(timer);
        finish();
      });
    }
  );
  req.on("error", () => {
    if (!settled) {
      try {
        resolveConnected();
      } catch {
        /* ignore */
      }
      finish();
    }
  });
  req.end();

  return { promise, connected };
}

// ---- project helpers ----

async function captureToken(
  page: import("@playwright/test").Page
): Promise<string> {
  let sessionToken: string | null = null;
  await page.route("**/api/**", async (route) => {
    const token = route.request().headers()["x-ikran-session"];
    if (token) {
      sessionToken = token;
    }
    await route.continue();
  });
  await page.goto(baseURL + "/");
  await expect(page.getByTestId("runtime-helper")).toContainText(
    "Local runtime connected"
  );
  if (!sessionToken) {
    throw new Error("Runtime session token was not captured from the UI request");
  }
  await page.unroute("**/api/**");
  return sessionToken;
}

async function bindFolder(token: string, folder: string): Promise<void> {
  const res = await rawPost(
    "/api/project/bind",
    { path: folder },
    { host: `localhost:${port}`, "x-ikran-session": token }
  );
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body).ok).toBe(true);
}

async function postTask(
  token: string,
  body: {
    family: string;
    payload: { input?: unknown; mock?: unknown };
    timeoutMs?: number;
  }
): Promise<{ taskId: string; status: string }> {
  const res = await rawPost("/api/tasks", body, {
    host: `localhost:${port}`,
    "x-ikran-session": token
  });
  expect(res.status).toBe(201);
  const parsed = JSON.parse(res.body);
  expect(parsed.ok).toBe(true);
  return { taskId: parsed.taskId, status: parsed.status };
}

// ---- file/db inspection helpers ----

function readEvents(
  folder: string
): { type: string; payload: Record<string, unknown> }[] {
  const file = `${folder}/.ikran/events.jsonl`;
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function getTaskRow(
  folder: string,
  taskId: string
): { status: string; error_code: string | null } | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const db = new Database(`${folder}/.ikran/ikran.db`);
  try {
    const row = db
      .prepare("SELECT status, error_code FROM tasks WHERE id = ?")
      .get(taskId) as { status: string; error_code: string | null } | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

// ---- direct adapter helpers (no Runtime needed) ----

async function collectAdapterEvents(
  iterable: AsyncIterable<AdapterEvent>
): Promise<AdapterEvent[]> {
  const events: AdapterEvent[] = [];
  for await (const ev of iterable) {
    events.push(ev);
  }
  return events;
}

function lastEventKind(events: AdapterEvent[]): AdapterEventKind | null {
  return events.length ? events[events.length - 1].kind : null;
}

// ---- test suite ----

test.describe("Ikran Issue 3A — real_agent_smoke common smoke runner", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ runtime }) => {
    port = runtime.port;
    baseURL = runtime.baseURL;
    testFolder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-3a-"));
  });

  test.afterEach(() => {
    if (testFolder) {
      rmSync(testFolder, { recursive: true, force: true });
      testFolder = "";
    }
  });

  // ---- direct adapter-level honest-failure coverage (no Runtime spawn) ----
  // These exercise the CLI adapter's transport-error paths that the fake CLI
  // cannot itself simulate (the fake CLI is, by definition, already installed).

  test("ENOENT: configured command binary missing -> honest adapter_error", async () => {
    const adapter = getCliAdapter({
      command: "ikran-definitely-missing-bin-xyz-12345",
      args: []
    });
    const events = await collectAdapterEvents(
      adapter.run({ family: "real_agent_smoke", input: {} })
    );
    // Must terminate in an `error`, never `done`.
    expect(lastEventKind(events)).toBe("error");
    const err = events.find((e) => e.kind === "error");
    expect(err?.error?.code).toBe("adapter_error");
    expect(err?.error?.message?.toLowerCase()).toContain("not found");
  });

  test("not configured: resolveCliCommand() returns null when env unset; getNoCliAdapter emits honest error", async () => {
    const savedCmd = process.env.IKRAN_AGENT_CLI_COMMAND;
    const savedArgs = process.env.IKRAN_AGENT_CLI_ARGS;
    delete process.env.IKRAN_AGENT_CLI_COMMAND;
    delete process.env.IKRAN_AGENT_CLI_ARGS;
    try {
      // In the test process the CLI env is NOT set (the smoke fixture only
      // injects it into the spawned Runtime). So resolveCliCommand() is null.
      expect(resolveCliCommand()).toBeNull();

      const adapter = getNoCliAdapter(
        "Agent CLI command not configured (set IKRAN_AGENT_CLI_COMMAND)"
      );
      const events = await collectAdapterEvents(
        adapter.run({ family: "real_agent_smoke", input: {} })
      );
      expect(lastEventKind(events)).toBe("error");
      const err = events.find((e) => e.kind === "error");
      expect(err?.error?.code).toBe("adapter_error");
      expect(err?.error?.message).toContain("not configured");

      // And the positive direction: setting the env makes resolveCliCommand()
      // return the parsed command + args (JSON array form).
      process.env.IKRAN_AGENT_CLI_COMMAND = "node";
      process.env.IKRAN_AGENT_CLI_ARGS = JSON.stringify([
        "/abs/path/to/fake-cli.mjs"
      ]);
      const cmd = resolveCliCommand();
      expect(cmd).toEqual({
        command: "node",
        args: ["/abs/path/to/fake-cli.mjs"]
      });
    } finally {
      if (savedCmd === undefined) delete process.env.IKRAN_AGENT_CLI_COMMAND;
      else process.env.IKRAN_AGENT_CLI_COMMAND = savedCmd;
      if (savedArgs === undefined) delete process.env.IKRAN_AGENT_CLI_ARGS;
      else process.env.IKRAN_AGENT_CLI_ARGS = savedArgs;
    }
  });

  // ---- full e2e through the existing Issue 03 plumbing ----

  test("success: real_agent_smoke round-trips Runtime -> fake CLI -> Runtime -> SSE -> persisted (done)", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    const { taskId } = await postTask(token, {
      family: "real_agent_smoke",
      payload: { input: { mode: "success" } }
    });

    const real = startTaskSSE(token, taskId, ["completed"], 8000);
    await real.connected;
    const frames = await real.promise;

    const completed = frames.find((f) => f.kind === "completed");
    expect(completed).toBeTruthy();
    // Output conforms to RealAgentSmokeResult (intake validation passed).
    expect(completed?.output).toMatchObject({
      message: "smoke ok",
      checklist: expect.arrayContaining([
        expect.objectContaining({ label: "agent returned json", done: true })
      ])
    });

    // GET /api/tasks/[id] -> done + validated smoke output.
    await bindFolder(token, testFolder);
    const detail = await rawGet(`/api/tasks/${taskId}`, {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    expect(detail.status).toBe(200);
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.task.status).toBe("done");
    expect(detailBody.task.result).toMatchObject({ message: "smoke ok" });

    // 3-layer persistence: SQLite done; events.jsonl has started + completed.
    expect(getTaskRow(testFolder, taskId)?.status).toBe("done");
    const types = readEvents(testFolder).map((e) => e.type);
    expect(types).toContain("agent_task_started");
    expect(types).toContain("agent_task_completed");
    // Smoke path must NOT write prototype/design-system artifacts — only the
    // existing task-state + JSONL event log. No new event types leak in.
    expect(types).not.toContain("draft_design_system_generated");
  });

  test("timeout: silent hang -> failed/timeout (honest, no fabricated success)", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    const { taskId } = await postTask(token, {
      family: "real_agent_smoke",
      payload: { input: { mode: "timeout" } },
      timeoutMs: 400
    });

    const sse = startTaskSSE(token, taskId, ["failed"], 8000);
    await sse.connected;
    const frames = await sse.promise;
    const failed = frames.find((f) => f.kind === "failed");
    expect(failed).toBeTruthy();
    expect(failed?.errorCode).toBe("timeout");
    // No `completed` frame must ever appear for a hung smoke.
    expect(frames.find((f) => f.kind === "completed")).toBeFalsy();

    await bindFolder(token, testFolder);
    const detail = await rawGet(`/api/tasks/${taskId}`, {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.task.status).toBe("failed");
    expect(detailBody.task.errorCode).toBe("timeout");

    const row = getTaskRow(testFolder, taskId);
    expect(row?.status).toBe("failed");
    expect(row?.error_code).toBe("timeout");
    const types = readEvents(testFolder).map((e) => e.type);
    expect(types).toContain("agent_task_failed");
    expect(types).not.toContain("agent_task_completed");
  });

  test("non-zero exit -> failed/adapter_error with exit code in reason", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    const { taskId } = await postTask(token, {
      family: "real_agent_smoke",
      payload: { input: { mode: "nonzero_exit" } }
    });

    const sse = startTaskSSE(token, taskId, ["failed"], 8000);
    await sse.connected;
    const frames = await sse.promise;
    const failed = frames.find((f) => f.kind === "failed");
    expect(failed).toBeTruthy();
    expect(failed?.errorCode).toBe("adapter_error");
    // Honest reason includes the exit code and the agent's stderr.
    expect(failed?.errorMessage).toMatch(/code 2/i);
    expect(failed?.errorMessage).toContain("internal error during smoke");
    expect(frames.find((f) => f.kind === "completed")).toBeFalsy();

    await bindFolder(token, testFolder);
    const detail = await rawGet(`/api/tasks/${taskId}`, {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.task.status).toBe("failed");
    expect(detailBody.task.errorCode).toBe("adapter_error");

    const row = getTaskRow(testFolder, taskId);
    expect(row?.status).toBe("failed");
    expect(row?.error_code).toBe("adapter_error");
  });

  test("invalid JSON stdout -> failed/invalid_output (honest, not a fake success)", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    const { taskId } = await postTask(token, {
      family: "real_agent_smoke",
      payload: { input: { mode: "invalid_json" } }
    });

    const sse = startTaskSSE(token, taskId, ["failed"], 8000);
    await sse.connected;
    const frames = await sse.promise;
    const failed = frames.find((f) => f.kind === "failed");
    expect(failed).toBeTruthy();
    expect(failed?.errorCode).toBe("invalid_output");
    expect(failed?.errorMessage?.toLowerCase()).toContain("json");
    expect(frames.find((f) => f.kind === "completed")).toBeFalsy();

    await bindFolder(token, testFolder);
    const detail = await rawGet(`/api/tasks/${taskId}`, {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.task.status).toBe("failed");
    expect(detailBody.task.errorCode).toBe("invalid_output");

    const row = getTaskRow(testFolder, taskId);
    expect(row?.status).toBe("failed");
    expect(row?.error_code).toBe("invalid_output");
    const types = readEvents(testFolder).map((e) => e.type);
    expect(types).toContain("agent_task_failed");
    expect(types).not.toContain("agent_task_completed");
  });

  test("stderr-only failure (exit 0, no stdout) -> failed/invalid_output with stderr in reason", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    const { taskId } = await postTask(token, {
      family: "real_agent_smoke",
      payload: { input: { mode: "stderr_error" } }
    });

    const sse = startTaskSSE(token, taskId, ["failed"], 8000);
    await sse.connected;
    const frames = await sse.promise;
    const failed = frames.find((f) => f.kind === "failed");
    expect(failed).toBeTruthy();
    expect(failed?.errorCode).toBe("invalid_output");
    // Honest reason surfaces the agent's stderr text.
    expect(failed?.errorMessage).toContain("agent authentication required");
    expect(frames.find((f) => f.kind === "completed")).toBeFalsy();

    const row = getTaskRow(testFolder, taskId);
    expect(row?.status).toBe("failed");
    expect(row?.error_code).toBe("invalid_output");
  });

  test("CLI-not-installed (fake exits 127 'command not found') -> failed/adapter_error", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    const { taskId } = await postTask(token, {
      family: "real_agent_smoke",
      payload: { input: { mode: "not_installed" } }
    });

    const sse = startTaskSSE(token, taskId, ["failed"], 8000);
    await sse.connected;
    const frames = await sse.promise;
    const failed = frames.find((f) => f.kind === "failed");
    expect(failed).toBeTruthy();
    expect(failed?.errorCode).toBe("adapter_error");
    expect(failed?.errorMessage).toContain("command not found");
    expect(failed?.errorMessage).toMatch(/code 127|127/);
    expect(frames.find((f) => f.kind === "completed")).toBeFalsy();

    const row = getTaskRow(testFolder, taskId);
    expect(row?.status).toBe("failed");
    expect(row?.error_code).toBe("adapter_error");
  });

  test("permission-prompt-stuck -> failed/timeout with the permission signal surfaced", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    const { taskId } = await postTask(token, {
      family: "real_agent_smoke",
      payload: { input: { mode: "permission_stuck" } },
      timeoutMs: 1500
    });

    const sse = startTaskSSE(token, taskId, ["failed"], 8000);
    await sse.connected;
    const frames = await sse.promise;
    const failed = frames.find((f) => f.kind === "failed");
    expect(failed).toBeTruthy();
    expect(failed?.errorCode).toBe("timeout");
    // The stuck permission prompt's stderr surfaces as a progress frame so a
    // human can see WHY it hung — honest telemetry, not a silent kill.
    const permissionProgress = frames.find(
      (f) => f.kind === "progress" && /permission/i.test(f.message ?? "")
    );
    expect(permissionProgress).toBeTruthy();
    expect(frames.find((f) => f.kind === "completed")).toBeFalsy();

    const row = getTaskRow(testFolder, taskId);
    expect(row?.status).toBe("failed");
    expect(row?.error_code).toBe("timeout");
    const types = readEvents(testFolder).map((e) => e.type);
    expect(types).toContain("agent_task_failed");
    expect(types).not.toContain("agent_task_completed");
  });

  test("cancel-leak: timeout SIGKILLs the subprocess (child pid dead, not orphaned)", async ({
    page
  }) => {
    // Regression test for the Issue 3A cancel-leak. iterator.return() alone
    // CANNOT kill a hung subprocess: while the runner is concurrently draining
    // the iterator (a pending it.next() is in flight), .return() is queued
    // behind that .next() and never processed, so the generator's `finally`
    // never runs and the child is orphaned. The fix: the runner calls
    // adapter.cancel() directly, which SIGKILLs the child. This test FAILS
    // without the cancel() fix (the child stays alive past timeout).
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    // Clean any stale pidfile from a prior run.
    try {
      rmSync(SMOKE_FAKE_CLI_PIDFILE);
    } catch {
      /* ignore */
    }

    const { taskId } = await postTask(token, {
      family: "real_agent_smoke",
      payload: { input: { mode: "hang_with_pid" } },
      timeoutMs: 400
    });

    // The fake CLI writes its pid to SMOKE_FAKE_CLI_PIDFILE immediately on
    // start. Poll for the pidfile so we know which child pid to assert deadness
    // on (the Runtime spawns the fake CLI in a separate process, so the test
    // cannot read the adapter's child handle directly).
    let pid: number | null = null;
    for (let i = 0; i < 30 && pid === null; i++) {
      if (existsSync(SMOKE_FAKE_CLI_PIDFILE)) {
        const txt = readFileSync(SMOKE_FAKE_CLI_PIDFILE, "utf-8").trim();
        if (txt) pid = parseInt(txt, 10);
      }
      if (pid === null) await new Promise((r) => setTimeout(r, 100));
    }
    if (pid === null) {
      throw new Error("fake CLI never wrote its pidfile — spawn failed?");
    }
    expect(pid).toBeGreaterThan(0);

    // Wait for the runner to finalize the task as timeout.
    const sse = startTaskSSE(token, taskId, ["failed"], 8000);
    await sse.connected;
    const frames = await sse.promise;
    const failed = frames.find((f) => f.kind === "failed");
    expect(failed).toBeTruthy();
    expect(failed?.errorCode).toBe("timeout");
    expect(frames.find((f) => f.kind === "completed")).toBeFalsy();

    // THE LEAK ASSERTION: the child subprocess must actually be DEAD after
    // timeout. process.kill(pid, 0) throws (ESRCH) if the pid no longer exists.
    // WITHOUT the cancel() fix this stays alive (setInterval keepalive) and
    // the test fails. Poll to allow the Runtime to reap the SIGKILLed child
    // (brief zombie window between kill and close-event reap).
    let alive = true;
    for (let i = 0; i < 30; i++) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(alive).toBe(false); // child MUST be dead — not orphaned

    const row = getTaskRow(testFolder, taskId);
    expect(row?.status).toBe("failed");
    expect(row?.error_code).toBe("timeout");

    // Cleanup pidfile for the next run.
    try {
      rmSync(SMOKE_FAKE_CLI_PIDFILE);
    } catch {
      /* ignore */
    }
  });
});