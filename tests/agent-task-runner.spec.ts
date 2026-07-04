// Issue 03 — Mocked AgentAdapter task loop (V1–V4 + happy path + boundaries).
//
// These are Playwright e2e specs. They drive the new task API + the single
// multiplexed /api/events SSE at the boundary the PRD calls highest-value
// ("浏览器 UI -> Ikran Runtime -> mocked AgentAdapter -> ... -> SSE result").
// No sidebar/UI rendering is asserted here — that is a Figma-driven UI issue.
//
// SSE is read with a raw node:http streaming client (not the browser
// EventSource) so frame collection is deterministic and independent of browser
// timing. The collector subscribes BEFORE the task is posted so the `started`
// frame is reliably captured.

import http from "node:http";
import { expect, test } from "./fixtures";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let port = 3000;
let baseURL = "http://localhost:3000";
let testFolder = "";

// ---- low-level HTTP helpers (mirror tests/ikran-runtime-health.spec.ts) ----

function rawGet(
  route: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "GET",
        headers
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
  /** Resolves once the stream is connected AND subscribed to the task bus,
   *  i.e. safe to POST the task without missing the `started` frame. */
  connected: Promise<void>;
}

// Open the single /api/events SSE filtered by ?task=<id>. Collects `task`
// frames until one of `terminalKinds` arrives (or `timeoutMs` elapses).
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
      path: `/api/events?session=${encodeURIComponent(
        token
      )}&task=${encodeURIComponent(taskId)}`,
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

async function captureToken(page: import("@playwright/test").Page): Promise<string> {
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

async function bindFolder(
  token: string,
  folder: string
): Promise<void> {
  const res = await rawPost(
    "/api/project/bind",
    { path: folder },
    { host: `localhost:${port}`, "x-ikran-session": token }
  );
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body).ok).toBe(true);
}

// POST a task and return { taskId, status } from the 201 response.
async function postTask(
  token: string,
  body: {
    family: string;
    payload: { input?: unknown; mock?: unknown };
    timeoutMs?: number;
  }
): Promise<{ taskId: string; status: string }> {
  const res = await rawPost(
    "/api/tasks",
    body,
    { host: `localhost:${port}`, "x-ikran-session": token }
  );
  expect(res.status).toBe(201);
  const parsed = JSON.parse(res.body);
  expect(parsed.ok).toBe(true);
  return { taskId: parsed.taskId, status: parsed.status };
}

// ---- file/db inspection helpers ----

function readEvents(folder: string): { type: string; payload: Record<string, unknown> }[] {
  const file = `${folder}/.ikran/events.jsonl`;
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function getTaskRow(folder: string, taskId: string): { status: string; error_code: string | null } | null {
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

function insertFakeRunningTask(folder: string, id: string, family: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const db = new Database(`${folder}/.ikran/ikran.db`);
  try {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tasks (id, family, payload_json, status, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?)`
    ).run(id, family, JSON.stringify({ family, input: {} }), now, now);
  } finally {
    db.close();
  }
}

// ---- test suite ----

test.describe("Ikran Issue 03 — mocked AgentAdapter task loop", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ runtime }) => {
    port = runtime.port;
    baseURL = runtime.baseURL;
    testFolder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-03-"));
  });

  test.afterEach(() => {
    if (testFolder) {
      rmSync(testFolder, { recursive: true, force: true });
      testFolder = "";
    }
  });

  test("happy path: full Browser UI -> Runtime -> mock adapter -> SSE -> persisted", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    // Post a slow mock, then subscribe to the live SSE for that task. `started`
    // is emitted by createTask before the 201 response returns, so it is
    // asserted durably via events.jsonl below; the live stream carries the
    // progress/output/completed sequence.
    const { taskId } = await postTask(token, {
      family: "draft_design_system",
      payload: { input: {}, mock: { progressTicks: 6, delayMs: 80 } }
    });

    const real = startTaskSSE(token, taskId, ["completed"], 8000);
    await real.connected;
    const frames = await real.promise;

    const kinds = frames.map((f) => f.kind);
    expect(kinds).toContain("progress");
    expect(kinds).toContain("completed");
    const completed = frames.find((f) => f.kind === "completed");
    expect(completed?.output).toMatchObject({ designSystemId: "ds-mock-0001" });

    // GET /api/tasks/[id] -> done + validated output.
    await bindFolder(token, testFolder);
    const detail = await rawGet(`/api/tasks/${taskId}`, {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    expect(detail.status).toBe(200);
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.task.status).toBe("done");
    expect(detailBody.task.result).toMatchObject({ designSystemId: "ds-mock-0001" });

    // 3-layer persistence: SQLite tasks row is done; events.jsonl has the
    // started + completed milestones.
    expect(getTaskRow(testFolder, taskId)?.status).toBe("done");
    const types = readEvents(testFolder).map((e) => e.type);
    expect(types).toContain("agent_task_started");
    expect(types).toContain("agent_task_completed");
  });

  test("V1a: mid-run refresh rebuilds from the 3 layers (live handle + SQLite + JSONL)", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    // Slow mock: ~10 * 150ms = 1.5s of progress, enough window to inspect mid-run.
    const { taskId } = await postTask(token, {
      family: "draft_design_system",
      payload: { input: {}, mock: { progressTicks: 10, delayMs: 150 } }
    });

    // Mid-run: SQLite row is 'running', live handle exists.
    expect(getTaskRow(testFolder, taskId)?.status).toBe("running");

    // Simulate a browser refresh: re-issue GET /api/tasks (the rebuild source)
    // while the task is still running. Re-bind first so the active-project
    // pointer is this folder even under parallel test pressure.
    await bindFolder(token, testFolder);
    const midList = await rawGet("/api/tasks", {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    expect(midList.status).toBe(200);
    const midTask = JSON.parse(midList.body).tasks.find(
      (t: { id: string }) => t.id === taskId
    );
    expect(midTask.status).toBe("running");
    expect(midTask.live).toBe(true);

    // "Refresh" again: still running, still live.
    await bindFolder(token, testFolder);
    const midList2 = await rawGet("/api/tasks", {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    const midTask2 = JSON.parse(midList2.body).tasks.find(
      (t: { id: string }) => t.id === taskId
    );
    expect(midTask2.status).toBe("running");
    expect(midTask2.live).toBe(true);

    // Re-open the SSE stream (as a refresh would) and collect until completed.
    const real = startTaskSSE(token, taskId, ["completed"], 8000);
    await real.connected;
    const frames = await real.promise;
    expect(frames.map((f) => f.kind)).toContain("completed");

    // After completion: SQLite row is done.
    expect(getTaskRow(testFolder, taskId)?.status).toBe("done");

    const types = readEvents(testFolder).map((e) => e.type);
    expect(types).toContain("agent_task_started");
    expect(types).toContain("agent_task_completed");
  });

  test("V1b: stale-running row with no live handle is reconciled to abandoned on read", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    // Directly insert a fake `running` task row with NO live handle (simulates
    // a process restart where the in-process handle map was lost).
    const fakeId = "fake-stale-task-0001";
    insertFakeRunningTask(testFolder, fakeId, "rule_update");
    expect(getTaskRow(testFolder, fakeId)?.status).toBe("running");

    // GET /api/tasks triggers reconcileStaleTasks on read.
    await bindFolder(token, testFolder);
    const list = await rawGet("/api/tasks", {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    expect(list.status).toBe(200);
    const task = JSON.parse(list.body).tasks.find(
      (t: { id: string }) => t.id === fakeId
    );
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe("abandoned");

    // SQLite row is now failed/abandoned.
    const row = getTaskRow(testFolder, fakeId);
    expect(row?.status).toBe("failed");
    expect(row?.error_code).toBe("abandoned");

    // events.jsonl gained an agent_task_failed with errorCode abandoned.
    const failed = readEvents(testFolder).filter(
      (e) => e.type === "agent_task_failed"
    );
    expect(
      failed.some((e) => (e.payload as { errorCode?: string }).errorCode === "abandoned")
    ).toBe(true);
  });

  test("V2: two concurrent tasks do not cross-talk (per-task isolation)", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    // Open both SSE subscriptions before posting so we capture everything.
    // We don't know ids yet, so: post both first (fast mocks, but we make them
    // slow enough), then subscribe per id and collect the terminal `completed`.
    const { taskId: aId } = await postTask(token, {
      family: "draft_design_system",
      payload: { input: { who: "A" }, mock: { progressTicks: 6, delayMs: 90 } }
    });
    const { taskId: bId } = await postTask(token, {
      family: "rule_update",
      payload: { input: { who: "B" }, mock: { progressTicks: 6, delayMs: 90 } }
    });
    expect(aId).not.toBe(bId);

    const aSSE = startTaskSSE(token, aId, ["completed"], 8000);
    const bSSE = startTaskSSE(token, bId, ["completed"], 8000);
    await Promise.all([aSSE.connected, bSSE.connected]);
    const [aFrames, bFrames] = await Promise.all([aSSE.promise, bSSE.promise]);

    const aCompleted = aFrames.find((f) => f.kind === "completed");
    const bCompleted = bFrames.find((f) => f.kind === "completed");
    // Each carries ONLY its own family's deterministic output shape.
    expect(aCompleted?.family).toBe("draft_design_system");
    expect(aCompleted?.output).toMatchObject({ designSystemId: "ds-mock-0001" });
    expect(aCompleted?.output).not.toHaveProperty("proposalId");
    expect(bCompleted?.family).toBe("rule_update");
    expect(bCompleted?.output).toMatchObject({ proposalId: "ru-mock-0001" });
    expect(bCompleted?.output).not.toHaveProperty("designSystemId");

    // GET /api/tasks lists both with non-interleaved results.
    await bindFolder(token, testFolder);
    const list = await rawGet("/api/tasks", {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    const tasks = JSON.parse(list.body).tasks as {
      id: string;
      family: string;
      status: string;
      result: Record<string, unknown> | null;
    }[];
    const aRow = tasks.find((t) => t.id === aId);
    const bRow = tasks.find((t) => t.id === bId);
    expect(aRow?.status).toBe("done");
    expect(bRow?.status).toBe("done");
    expect(aRow?.result).toMatchObject({ designSystemId: "ds-mock-0001" });
    expect(bRow?.result).toMatchObject({ proposalId: "ru-mock-0001" });
  });

  test("V3: a hung mock triggers the per-task timeout -> failed/timeout", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    const { taskId } = await postTask(token, {
      family: "project_setup",
      payload: { input: {}, mock: { mode: "hang" } },
      timeoutMs: 300
    });

    // Subscribe after post; the hang mode emits progress then never resolves,
    // so the runner's 300ms timeout fires -> failed/timeout on the bus.
    const real = startTaskSSE(token, taskId, ["failed"], 5000);
    await real.connected;
    const frames = await real.promise;
    const failed = frames.find((f) => f.kind === "failed");
    expect(failed).toBeTruthy();
    expect(failed?.errorCode).toBe("timeout");

    // GET /api/tasks/[id] -> failed/timeout.
    await bindFolder(token, testFolder);
    const detail = await rawGet(`/api/tasks/${taskId}`, {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    expect(detail.status).toBe(200);
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.task.status).toBe("failed");
    expect(detailBody.task.errorCode).toBe("timeout");

    // 3-layer: SQLite failed/timeout; events.jsonl has agent_task_failed
    // (timeout) and NO agent_task_completed.
    const row = getTaskRow(testFolder, taskId);
    expect(row?.status).toBe("failed");
    expect(row?.error_code).toBe("timeout");
    const types = readEvents(testFolder).map((e) => e.type);
    expect(types).toContain("agent_task_failed");
    expect(types).not.toContain("agent_task_completed");
    const failedEv = readEvents(testFolder).filter((e) => e.type === "agent_task_failed");
    expect(
      failedEv.some(
        (e) => (e.payload as { errorCode?: string }).errorCode === "timeout"
      )
    ).toBe(true);
  });

  test("V4: invalid output is NOT repaired (fail-closed at the intake point)", async ({
    page
  }) => {
    const token = await captureToken(page);
    await bindFolder(token, testFolder);

    const { taskId } = await postTask(token, {
      family: "draft_design_system",
      payload: { input: {}, mock: { mode: "invalid" } }
    });

    const sse = startTaskSSE(token, taskId, ["failed"], 5000);
    await sse.connected;
    const frames = await sse.promise;
    const failed = frames.find((f) => f.kind === "failed");
    expect(failed).toBeTruthy();
    expect(failed?.errorCode).toBe("invalid_output");

    // Exactly one adapter run: `started` fires once (pre-201). The SSE stream
    // opened right after the post may or may not catch `started`; we assert the
    // durable signal instead — exactly one agent_task_started in events.jsonl.
    const events = readEvents(testFolder);
    const startedCount = events.filter((e) => e.type === "agent_task_started").length;
    expect(startedCount).toBe(1);
    // No repair re-feed: invalid_output present, repaired_output absent.
    const types = events.map((e) => e.type);
    expect(types).toContain("invalid_output");
    expect(types).not.toContain("repaired_output");

    // GET /api/tasks/[id] -> failed/invalid_output.
    await bindFolder(token, testFolder);
    const detail = await rawGet(`/api/tasks/${taskId}`, {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    expect(detail.status).toBe(200);
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.task.status).toBe("failed");
    expect(detailBody.task.errorCode).toBe("invalid_output");
  });

  test("unknown family / invalid payload / no active project + authorize() boundary", async ({
    page
  }) => {
    const token = await captureToken(page);

    // unknown_family (validation happens before the active-project check, so
    // this works even with no project bound).
    const unknown = await rawPost(
      "/api/tasks",
      { family: "not_a_real_family", payload: { input: {} } },
      { host: `localhost:${port}`, "x-ikran-session": token }
    );
    expect(unknown.status).toBe(400);
    expect(JSON.parse(unknown.body).error).toBe("unknown_family");

    // invalid_payload (missing payload object).
    const badPayload = await rawPost(
      "/api/tasks",
      { family: "draft_design_system" },
      { host: `localhost:${port}`, "x-ikran-session": token }
    );
    expect(badPayload.status).toBe(400);
    expect(JSON.parse(badPayload.body).error).toBe("invalid_payload");

    // no_active_project: bind then invalidate the folder so getActiveProject()
    // returns null (isProjectFolder false), then a valid task is rejected.
    await bindFolder(token, testFolder);
    rmSync(`${testFolder}/.ikran/config.json`, { force: true });
    const noProject = await rawPost(
      "/api/tasks",
      { family: "draft_design_system", payload: { input: {} } },
      { host: `localhost:${port}`, "x-ikran-session": token }
    );
    expect(noProject.status).toBe(400);
    expect(JSON.parse(noProject.body).error).toBe("no_active_project");

    // authorize() boundary on the new routes (mirrors the health route checks).
    const noToken = await rawPost(
      "/api/tasks",
      { family: "draft_design_system", payload: { input: {} } },
      { host: `localhost:${port}` }
    );
    expect(noToken.status).toBe(403);
    const badToken = await rawPost(
      "/api/tasks",
      { family: "draft_design_system", payload: { input: {} } },
      { host: `localhost:${port}`, "x-ikran-session": "not-the-real-token" }
    );
    expect(badToken.status).toBe(403);
    const crossOrigin = await rawPost(
      "/api/tasks",
      { family: "draft_design_system", payload: { input: {} } },
      { host: `localhost:${port}`, origin: "https://evil.example", "x-ikran-session": token }
    );
    expect(crossOrigin.status).toBe(403);
    const nonlocalHost = await rawPost(
      "/api/tasks",
      { family: "draft_design_system", payload: { input: {} } },
      { host: "evil.example", "x-ikran-session": token }
    );
    expect(nonlocalHost.status).toBe(403);

    // GET /api/tasks inherits authorize() too.
    const getNoToken = await rawGet("/api/tasks", { host: `localhost:${port}` });
    expect(getNoToken.status).toBe(403);
  });
});