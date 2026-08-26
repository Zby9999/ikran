import { createHash, randomUUID } from "node:crypto";

import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import {
  defaultLiveHeroVerifyDeps,
  verifyComponentLiveHeroes,
  type LiveHeroVerifyDeps,
  type LiveHeroVerifyUrlResult
} from "./live-hero-verify";
import { componentPreviewVerificationIdentity } from "./component-preview-identity";

export interface StartComponentPreviewVerificationInput {
  entryIds?: readonly string[];
  timeoutMs?: number;
  concurrency?: number;
  priorityEntryIds?: readonly string[];
}

export interface ComponentPreviewVerificationOptions {
  deps?: LiveHeroVerifyDeps;
  schedule?: (work: () => Promise<void>) => void;
}

export type StartComponentPreviewVerificationResult =
  | {
      ok: true;
      default_all_passed: boolean;
      default_cache_hits: number;
      cache_hits: number;
      concurrency: number;
      batch_id: string;
      background_queued: boolean;
      entry_ids: string[];
    }
  | { ok: false; reason: string; details?: unknown };

type Registration = {
  id: string;
  entry_id: string;
  module_path: string;
  registration_digest: string;
  verification_identity: string | null;
  state_args_json: string;
  provider_recipe_json: string | null;
  prototype_root: string;
  adapter_artifact_path: string;
  manifest_artifact_path: string;
  value_json: string;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stateNames(registration: Registration): string[] {
  const names = new Set<string>();
  try {
    const args = JSON.parse(registration.state_args_json) as unknown;
    if (args && typeof args === "object" && !Array.isArray(args)) {
      for (const name of Object.keys(args)) {
        if (name.trim() && name.toLowerCase() !== "default") names.add(name);
      }
    }
  } catch {
    // Registration validation already guards JSON; degrade to spec states.
  }
  try {
    const value = JSON.parse(registration.value_json) as {
      stateMatrix?: Array<{ state?: unknown }>;
    };
    for (const row of value.stateMatrix ?? []) {
      if (typeof row.state !== "string") continue;
      const name = row.state.trim();
      if (name && name.toLowerCase() !== "default") names.add(name);
    }
  } catch {
    // A malformed value will fail through the underlying verifier.
  }
  return [...names];
}

function registrations(
  projectPath: string,
  entryIds?: readonly string[]
): Registration[] {
  const db = openProjectDb(projectPath);
  try {
    const rows = db.prepare(
      `SELECT r.id, r.entry_id, r.module_path, r.registration_digest,
              r.verification_identity, r.state_args_json,
              r.provider_recipe_json, r.prototype_root,
              r.adapter_artifact_path, r.manifest_artifact_path, e.value_json
       FROM component_preview_registrations r
       JOIN design_system_entries e ON e.entry_id = r.entry_id
       ORDER BY r.created_at, r.entry_id`
    ).all() as Registration[];
    if (!entryIds?.length) return rows;
    const requested = new Set(entryIds);
    return rows.filter((row) => requested.has(row.entry_id));
  } finally {
    closeProjectDb(db);
  }
}

function ensureIdentity(projectPath: string, registration: Registration): string {
  const identity = componentPreviewVerificationIdentity(projectPath, {
    modulePath: registration.module_path,
    registrationDigest: registration.registration_digest,
    providerRecipeJson: registration.provider_recipe_json,
    prototypeRoot: registration.prototype_root,
    adapterArtifactPath: registration.adapter_artifact_path,
    manifestArtifactPath: registration.manifest_artifact_path
  });
  if (registration.verification_identity === identity) return identity;
  withProjectTransaction(projectPath, (db) => {
    db.prepare(
      `UPDATE component_preview_registrations
       SET verification_identity = ?, verification_status = 'queued', updated_at = ?
       WHERE id = ?`
    ).run(identity, new Date().toISOString(), registration.id);
  });
  registration.verification_identity = identity;
  return identity;
}

type VerificationTask = {
  registration: Registration;
  identity: string;
  state: string;
  priority: number;
  queuePosition: number;
  cached: boolean;
  workId: string;
};

function createBatch(
  projectPath: string,
  concurrency: number,
  tasks: VerificationTask[]
): { id: string; startedAt: string; cacheHits: number } {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const cacheHits = tasks.filter((task) => task.cached).length;
  withProjectTransaction(projectPath, (db) => {
    db.prepare(
      `INSERT INTO component_preview_verification_batches
       (id, status, concurrency, cache_hits, work_count, started_at, created_at)
       VALUES (?, 'running', ?, ?, ?, ?, ?)`
    ).run(id, concurrency, cacheHits, tasks.length, startedAt, startedAt);
    const insert = db.prepare(
      `INSERT INTO component_preview_verification_work
       (id, batch_id, registration_id, entry_id, state,
        verification_identity, priority, queue_position, status, cache_hit,
        created_at, started_at, ended_at, queue_wait_ms, browser_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const task of tasks) {
      insert.run(
        task.workId,
        id,
        task.registration.id,
        task.registration.entry_id,
        task.state,
        task.identity,
        task.priority,
        task.queuePosition,
        task.cached ? "cache_hit" : "queued",
        task.cached ? 1 : 0,
        startedAt,
        task.cached ? startedAt : null,
        task.cached ? startedAt : null,
        task.cached ? 0 : null,
        task.cached ? 0 : null
      );
    }
  });
  return { id, startedAt, cacheHits };
}

function completeBatch(projectPath: string, batchId: string, startedAt: string): void {
  const endedAt = new Date().toISOString();
  withProjectTransaction(projectPath, (db) => {
    db.prepare(
      `UPDATE component_preview_verification_batches
       SET status = 'completed', ended_at = ?, total_ms = ? WHERE id = ?`
    ).run(
      endedAt,
      Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      batchId
    );
  });
}

function failBatch(
  projectPath: string,
  batchId: string,
  startedAt: string,
  failureReason: string
): void {
  const endedAt = new Date().toISOString();
  withProjectTransaction(projectPath, (db) => {
    db.prepare(
      `UPDATE component_preview_verification_work
       SET status = 'interrupted', failure_reason = ?, ended_at = ?,
           browser_ms = CASE WHEN started_at IS NULL THEN browser_ms ELSE ? END
       WHERE batch_id = ? AND status IN ('queued', 'running')`
    ).run(
      failureReason,
      endedAt,
      Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      batchId
    );
    db.prepare(
      `UPDATE component_preview_verification_batches
       SET status = 'failed', ended_at = ?, total_ms = ? WHERE id = ?`
    ).run(
      endedAt,
      Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      batchId
    );
  });
}

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await work(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
}

async function executeTask(
  projectPath: string,
  batchStartedAt: string,
  task: VerificationTask,
  timeoutMs: number | undefined,
  deps: LiveHeroVerifyDeps
): Promise<boolean> {
  const startedAt = new Date().toISOString();
  withProjectTransaction(projectPath, (db) => {
    db.prepare(
      `UPDATE component_preview_verification_work
       SET status = 'running', started_at = ?, queue_wait_ms = ? WHERE id = ?`
    ).run(
      startedAt,
      Math.max(0, Date.parse(startedAt) - Date.parse(batchStartedAt)),
      task.workId
    );
  });
  const result = await verifyStates(
    projectPath,
    task.registration,
    task.identity,
    [task.state],
    timeoutMs,
    deps
  );
  const endedAt = new Date().toISOString();
  withProjectTransaction(projectPath, (db) => {
    db.prepare(
      `UPDATE component_preview_verification_work
       SET status = ?, failure_reason = ?, ended_at = ?, browser_ms = ?
       WHERE id = ?`
    ).run(
      result.ok ? "passed" : "failed",
      result.infrastructureFailure ?? null,
      endedAt,
      Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      task.workId
    );
  });
  return result.ok;
}

function passed(
  projectPath: string,
  registrationId: string,
  identity: string,
  state: string
): boolean {
  const db = openProjectDb(projectPath);
  try {
    return Boolean(
      db.prepare(
        `SELECT 1 FROM component_preview_verification_results
         WHERE registration_id = ? AND verification_identity = ?
           AND state = ? AND status = 'passed'`
      ).get(registrationId, identity, state)
    );
  } finally {
    closeProjectDb(db);
  }
}

function persistResult(
  projectPath: string,
  registration: Registration,
  identity: string,
  result: LiveHeroVerifyUrlResult
): void {
  const now = new Date().toISOString();
  const id = hash(`${registration.id}:${identity}:${result.state}`);
  withProjectTransaction(projectPath, (db) => {
    db.prepare(
      `INSERT INTO component_preview_verification_results
       (id, registration_id, verification_identity, state, status,
        failure_reason, bounds_json, attempt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(registration_id, verification_identity, state) DO UPDATE SET
         status = excluded.status,
         failure_reason = excluded.failure_reason,
         bounds_json = excluded.bounds_json,
         attempt = component_preview_verification_results.attempt + 1,
         updated_at = excluded.updated_at`
    ).run(
      id,
      registration.id,
      identity,
      result.state,
      result.ok ? "passed" : "failed",
      result.ok ? null : result.reason,
      result.ok ? JSON.stringify(result.bounds) : null,
      now,
      now
    );
  });
}

async function verifyStates(
  projectPath: string,
  registration: Registration,
  identity: string,
  states: string[],
  timeoutMs: number | undefined,
  deps: LiveHeroVerifyDeps
): Promise<{ ok: boolean; infrastructureFailure?: string }> {
  if (states.length === 0) return { ok: true };
  const result = await verifyComponentLiveHeroes(
    projectPath,
    { entryIds: [registration.entry_id], timeoutMs, states },
    deps
  );
  if (!result.ok) return { ok: false, infrastructureFailure: result.reason };
  const entry = result.entries.find(
    (candidate) => candidate.entry_id === registration.entry_id
  );
  if (!entry || entry.skipped) {
    return {
      ok: false,
      infrastructureFailure: entry?.skipped ?? "entry_not_found"
    };
  }
  for (const stateResult of entry.results) {
    persistResult(projectPath, registration, identity, stateResult);
  }
  return { ok: entry.results.length === states.length && entry.results.every((item) => item.ok) };
}

function setRegistrationStatus(
  projectPath: string,
  registrationId: string,
  expectedIdentity: string,
  values: { availability?: "available" | "unavailable"; verification: "queued" | "verifying" | "verified" | "failed" }
): boolean {
  return withProjectTransaction(projectPath, (db) => {
    const result = db.prepare(
      `UPDATE component_preview_registrations
       SET availability_status = COALESCE(?, availability_status),
           verification_status = ?, updated_at = ?
       WHERE id = ? AND verification_identity = ?`
    ).run(
      values.availability ?? null,
      values.verification,
      new Date().toISOString(),
      registrationId,
      expectedIdentity
    );
    return result.changes === 1;
  });
}

function defaultSchedule(work: () => Promise<void>): void {
  queueMicrotask(() => {
    void work().catch(() => undefined);
  });
}

export async function startComponentPreviewVerification(
  projectPath: string,
  input: StartComponentPreviewVerificationInput = {},
  options: ComponentPreviewVerificationOptions = {}
): Promise<StartComponentPreviewVerificationResult> {
  const deps = options.deps ?? defaultLiveHeroVerifyDeps;
  const schedule = options.schedule ?? defaultSchedule;
  const concurrency =
    Number.isInteger(input.concurrency) &&
    Number(input.concurrency) >= 1 &&
    Number(input.concurrency) <= 8
      ? Number(input.concurrency)
      : input.concurrency === undefined
        ? 2
        : -1;
  if (concurrency === -1) {
    return { ok: false, reason: "invalid_concurrency", details: { min: 1, max: 8 } };
  }
  let rows: Registration[];
  try {
    rows = registrations(projectPath, input.entryIds);
  } catch {
    return { ok: false, reason: "db_error" };
  }
  if (rows.length === 0) return { ok: false, reason: "registration_not_found" };
  const priority = new Map(
    (input.priorityEntryIds ?? []).map((entryId, index) => [entryId, index])
  );
  rows = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const ap = priority.get(a.row.entry_id);
      const bp = priority.get(b.row.entry_id);
      if (ap !== undefined || bp !== undefined) {
        if (ap === undefined) return 1;
        if (bp === undefined) return -1;
        if (ap !== bp) return ap - bp;
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
  const tasks: VerificationTask[] = [];
  for (const registration of rows) {
    const identity = ensureIdentity(projectPath, registration);
    for (const state of ["default", ...stateNames(registration)]) {
      tasks.push({
        registration,
        identity,
        state,
        priority: priority.has(registration.entry_id) ? 1 : 0,
        queuePosition: tasks.length,
        cached: passed(projectPath, registration.id, identity, state),
        workId: randomUUID()
      });
    }
  }
  const batch = createBatch(projectPath, concurrency, tasks);
  const defaultTasks = tasks.filter(
    (task) => task.state === "default" && !task.cached
  );
  const defaultPassed = new Map<string, boolean>();
  for (const task of tasks.filter((candidate) => candidate.state === "default" && candidate.cached)) {
    defaultPassed.set(task.registration.id, true);
  }
  try {
    await runPool(defaultTasks, concurrency, async (task) => {
      defaultPassed.set(
        task.registration.id,
        await executeTask(
          projectPath,
          batch.startedAt,
          task,
          input.timeoutMs,
          deps
        )
      );
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "verification_interrupted";
    failBatch(projectPath, batch.id, batch.startedAt, reason);
    for (const task of defaultTasks) {
      setRegistrationStatus(projectPath, task.registration.id, task.identity, {
        verification: "failed"
      });
    }
    return { ok: false, reason: "verification_interrupted", details: { reason } };
  }
  let defaultAllPassed = true;
  for (const registration of rows) {
    if (!defaultPassed.get(registration.id)) {
      defaultAllPassed = false;
      const identity = tasks.find((task) => task.registration.id === registration.id)!.identity;
      setRegistrationStatus(projectPath, registration.id, identity, {
        availability: "unavailable",
        verification: "failed"
      });
    }
  }
  const background = tasks.filter(
    (task) =>
      task.state !== "default" &&
      !task.cached &&
      defaultPassed.get(task.registration.id) === true
  );
  for (const registration of rows.filter((row) => defaultPassed.get(row.id))) {
    const hasBackground = background.some(
      (task) => task.registration.id === registration.id
    );
    const identity = tasks.find((task) => task.registration.id === registration.id)!.identity;
    setRegistrationStatus(projectPath, registration.id, identity, {
      availability: "available",
      verification: hasBackground ? "queued" : "verified"
    });
  }
  if (background.length > 0) {
    schedule(async () => {
      try {
        for (const registration of rows.filter((row) =>
          background.some((task) => task.registration.id === row.id)
        )) {
          const identity = tasks.find(
            (task) => task.registration.id === registration.id
          )!.identity;
          setRegistrationStatus(projectPath, registration.id, identity, {
            verification: "verifying"
          });
        }
        await runPool(background, concurrency, async (task) => {
          await executeTask(
            projectPath,
            batch.startedAt,
            task,
            input.timeoutMs,
            deps
          );
        });
        for (const registration of rows.filter((row) => defaultPassed.get(row.id))) {
          const identity = tasks.find(
            (task) => task.registration.id === registration.id
          )!.identity;
          const allPassed = ["default", ...stateNames(registration)].every((state) =>
            passed(projectPath, registration.id, identity, state)
          );
          setRegistrationStatus(projectPath, registration.id, identity, {
            availability: "available",
            verification: allPassed ? "verified" : "failed"
          });
        }
        completeBatch(projectPath, batch.id, batch.startedAt);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "verification_interrupted";
        failBatch(projectPath, batch.id, batch.startedAt, reason);
        for (const task of background) {
          setRegistrationStatus(projectPath, task.registration.id, task.identity, {
            verification: "failed"
          });
        }
        throw error;
      }
    });
  } else {
    completeBatch(projectPath, batch.id, batch.startedAt);
  }
  return {
    ok: true,
    default_all_passed: defaultAllPassed,
    default_cache_hits: tasks.filter(
      (task) => task.state === "default" && task.cached
    ).length,
    cache_hits: batch.cacheHits,
    concurrency,
    batch_id: batch.id,
    background_queued: background.length > 0,
    entry_ids: rows.map((row) => row.entry_id)
  };
}
