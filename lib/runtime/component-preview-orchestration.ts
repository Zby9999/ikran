import { createHash, randomUUID } from "node:crypto";

import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { buildLoggedEvent, insertEvent } from "./events";
import {
  startComponentPreviewVerification
} from "./component-preview-verification";
import type { LiveHeroVerifyDeps } from "./live-hero-verify";
import { runComponentFormalizationStageAsync } from "./component-formalization-timing";
import { createComponentPreviewException } from "./component-preview-exception";

export interface AutomaticOrchestrationHost {
  deps?: LiveHeroVerifyDeps;
  schedule: (work: () => Promise<void>) => void;
}

const defaultHost: AutomaticOrchestrationHost = {
  schedule(work) {
    queueMicrotask(() => void work().catch(() => undefined));
  }
};

let orchestrationHost: AutomaticOrchestrationHost = defaultHost;

export function setAutomaticComponentPreviewOrchestrationHostForTests(
  host: AutomaticOrchestrationHost
): void {
  orchestrationHost = host;
}

export function resetAutomaticComponentPreviewOrchestrationHostForTests(): void {
  orchestrationHost = defaultHost;
}

export function scheduleAutomaticComponentPreviewOrchestrations(
  projectPath: string,
  registrationIds: readonly string[]
): void {
  const ids = [...new Set(registrationIds)];
  if (ids.length === 0) return;
  orchestrationHost.schedule(async () => {
    await Promise.allSettled(
      ids.map((registrationId) =>
        runAutomaticComponentPreviewOrchestration(projectPath, registrationId)
      )
    );
  });
}

export interface AutomaticComponentPreviewOrchestration {
  id: string;
  registration_id: string;
  status:
    | "pending"
    | "verifying"
    | "verified_candidate"
    | "exception_required"
    | "failed"
    | "interrupted";
  semantic_status: "no_delta" | "uncertain" | "delta";
  checkpoint: string;
  failure_stage: string | null;
  failure_code: string | null;
}

type OrchestrationRow = AutomaticComponentPreviewOrchestration & {
  registration_digest: string;
  semantic_digest: string;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function componentPreviewSemanticContract(value: unknown): {
  digest: string;
  states: string[];
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid component semantic contract");
  }
  const semantic = { ...(value as Record<string, unknown>) };
  delete semantic.codeLinks;
  delete semantic.liveHero;
  delete semantic.sourceCaptures;
  const states = Array.isArray(semantic.stateMatrix)
    ? semantic.stateMatrix.flatMap((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return [];
        const state = (row as { state?: unknown }).state;
        return typeof state === "string" && state.trim()
          ? [state.trim()]
          : [];
      })
    : [];
  return { digest: hash(semantic), states };
}

function semanticContract(valueJson: string): { digest: string; states: string[] } {
  return componentPreviewSemanticContract(JSON.parse(valueJson));
}

function publicRow(row: OrchestrationRow): AutomaticComponentPreviewOrchestration {
  return {
    id: row.id,
    registration_id: row.registration_id,
    status: row.status,
    semantic_status: row.semantic_status,
    checkpoint: row.checkpoint,
    failure_stage: row.failure_stage,
    failure_code: row.failure_code
  };
}

function readOrchestration(
  projectPath: string,
  registrationId: string
): OrchestrationRow | null {
  const db = openProjectDb(projectPath);
  try {
    return (db.prepare(
      `SELECT id, registration_id, registration_digest, semantic_digest,
              semantic_status, status, checkpoint, failure_stage, failure_code
       FROM component_preview_orchestrations WHERE registration_id = ?`
    ).get(registrationId) as OrchestrationRow | undefined) ?? null;
  } finally {
    closeProjectDb(db);
  }
}

export function beginAutomaticComponentPreviewOrchestration(
  projectPath: string,
  registrationId: string,
  expectedSemanticDigest: string
): AutomaticComponentPreviewOrchestration {
  const db = openProjectDb(projectPath);
  let registration: {
    id: string;
    run_id: string;
    entry_id: string;
    registration_digest: string;
    state_args_json: string;
    provider_recipe_json: string | null;
    value_json: string;
    prototype_surface_id: string;
    module_path: string;
    export_name: string;
  };
  try {
    const row = db.prepare(
      `SELECT r.id, r.run_id, r.entry_id, r.registration_digest, r.state_args_json,
              r.provider_recipe_json, r.prototype_surface_id, r.module_path,
              r.export_name, e.value_json
       FROM component_preview_registrations r
       JOIN design_system_entries e ON e.entry_id = r.entry_id
       WHERE r.id = ?`
    ).get(registrationId) as typeof registration | undefined;
    if (!row) throw new Error(`Unknown component preview registration: ${registrationId}`);
    registration = row;
  } finally {
    closeProjectDb(db);
  }
  const contract = semanticContract(registration.value_json);
  const recipeStates = Object.keys(
    JSON.parse(registration.state_args_json) as Record<string, unknown>
  );
  const uncertain =
    registration.provider_recipe_json !== null ||
    expectedSemanticDigest !== contract.digest ||
    recipeStates.some((state) => !contract.states.includes(state));
  const semanticStatus = uncertain ? "uncertain" : "no_delta";
  const existing = readOrchestration(projectPath, registrationId);
  const retryableInfrastructureFailure =
    existing?.status === "failed" &&
    new Set([
      "browser_unavailable",
      "surface_not_ready",
      "surface_stale",
      "preview_unavailable",
      "verification_interrupted"
    ]).has(existing.failure_code ?? "");
  if (
    (existing?.status === "verified_candidate" ||
      (existing?.status === "failed" && !retryableInfrastructureFailure)) &&
    existing.registration_digest === registration.registration_digest &&
    existing.semantic_digest === contract.digest
  ) {
    return publicRow(existing);
  }
  const id = existing?.id ?? randomUUID();
  const now = new Date().toISOString();
  withProjectTransaction(projectPath, (writeDb) => {
    writeDb.prepare(
      `INSERT INTO component_preview_orchestrations
       (id, registration_id, registration_digest, semantic_digest,
        semantic_status, status, checkpoint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(registration_id) DO UPDATE SET
         registration_digest = excluded.registration_digest,
         semantic_digest = excluded.semantic_digest,
         semantic_status = excluded.semantic_status,
         status = excluded.status,
         checkpoint = excluded.checkpoint,
         failure_stage = NULL, failure_code = NULL,
         verified_candidate_event_id = NULL, completed_at = NULL,
         updated_at = excluded.updated_at`
    ).run(
      id,
      registrationId,
      registration.registration_digest,
      contract.digest,
      semanticStatus,
      uncertain ? "exception_required" : "pending",
      uncertain ? "semantic_exception_required" : "registration_complete",
      now,
      now
    );
  });
  const created = readOrchestration(projectPath, registrationId)!;
  if (uncertain) {
    createComponentPreviewException(projectPath, {
      runId: registration.run_id,
      surfaceId: registration.prototype_surface_id,
      entryId: registration.entry_id,
      modulePath: registration.module_path,
      exportName: registration.export_name,
      kind: "semantic_delta",
      implementationDelta: {
        expected_semantic_digest: expectedSemanticDigest,
        current_semantic_digest: contract.digest,
        undeclared_states: recipeStates.filter(
          (state) => !contract.states.includes(state)
        )
      },
      detectedConflicts: [
        ...(expectedSemanticDigest !== contract.digest
          ? ["component_contract_changed_since_declaration"]
          : []),
        ...recipeStates
          .filter((state) => !contract.states.includes(state))
          .map((state) => `state_not_in_component_contract:${state}`)
      ]
    });
  } else {
    scheduleAutomaticComponentPreviewOrchestrations(projectPath, [registrationId]);
  }
  return publicRow(created);
}

export async function runAutomaticComponentPreviewOrchestration(
  projectPath: string,
  registrationId: string
): Promise<AutomaticComponentPreviewOrchestration> {
  const existing = readOrchestration(projectPath, registrationId);
  if (!existing) throw new Error(`Unknown component preview orchestration: ${registrationId}`);
  if (existing.status === "verified_candidate" || existing.status === "exception_required") {
    return publicRow(existing);
  }
  const claimed = withProjectTransaction(projectPath, (db) => {
    const result = db.prepare(
      `UPDATE component_preview_orchestrations
       SET status = 'verifying', checkpoint = 'verification_started',
           updated_at = ?
       WHERE registration_id = ? AND registration_digest = ?
         AND semantic_digest = ? AND status IN ('pending', 'failed', 'interrupted')`
    ).run(
      new Date().toISOString(),
      registrationId,
      existing.registration_digest,
      existing.semantic_digest
    );
    return result.changes === 1;
  });
  if (!claimed) return publicRow(readOrchestration(projectPath, registrationId)!);
  const registrationIdentity = (() => {
    const db = openProjectDb(projectPath);
    try {
      return db.prepare(
        `SELECT entry_id, run_id FROM component_preview_registrations WHERE id = ?`
      ).get(registrationId) as { entry_id: string; run_id: string };
    } finally {
      closeProjectDb(db);
    }
  })();
  const scheduled: { background?: () => Promise<void> } = {};
  let result: Awaited<ReturnType<typeof startComponentPreviewVerification>>;
  try {
    result = await runComponentFormalizationStageAsync(
      projectPath,
      "live_hero_declaration",
      { componentCount: 1, stateCount: 1 },
      async () => {
        const started = await startComponentPreviewVerification(
          projectPath,
          { entryIds: [registrationIdentity.entry_id] },
          {
            deps: orchestrationHost.deps,
            schedule(work) {
              scheduled.background = work;
            }
          }
        );
        return started.ok && !started.default_all_passed
          ? { ...started, ok: false as const, reason: "default_verification_failed" }
          : started;
      },
      { runId: registrationIdentity.run_id }
    );
    if (scheduled.background) {
      const runBackground = scheduled.background;
      await runComponentFormalizationStageAsync(
        projectPath,
        "verification",
        { componentCount: 1 },
        () => runBackground(),
        { runId: registrationIdentity.run_id }
      );
    } else if (result.ok) {
      await runComponentFormalizationStageAsync(
        projectPath,
        "verification",
        { componentCount: 1, cacheStatus: result.cache_hits > 0 ? "hit" : "miss" },
        async () => ({ ok: true }),
        { runId: registrationIdentity.run_id }
      );
    }
  } catch (error) {
    result = {
      ok: false,
      reason: "verification_interrupted",
      details: { reason: error instanceof Error ? error.message : String(error) }
    };
  }
  const verification = (() => {
    const db = openProjectDb(projectPath);
    try {
      return db.prepare(
        `SELECT verification_status, registration_digest
         FROM component_preview_registrations WHERE id = ?`
      ).get(registrationId) as {
        verification_status: string;
        registration_digest: string;
      };
    } finally {
      closeProjectDb(db);
    }
  })();
  if (
    !result.ok ||
    verification.verification_status !== "verified" ||
    verification.registration_digest !== existing.registration_digest
  ) {
    withProjectTransaction(projectPath, (db) => {
      db.prepare(
        `UPDATE component_preview_orchestrations
         SET status = 'failed', checkpoint = 'verification_failed',
             failure_stage = 'verification', failure_code = ?, updated_at = ?
         WHERE registration_id = ? AND registration_digest = ?
           AND semantic_digest = ? AND status = 'verifying'`
      ).run(
        result.ok
          ? verification.registration_digest === existing.registration_digest
            ? verification.verification_status
            : "registration_identity_changed"
          : result.reason,
        new Date().toISOString(),
        registrationId,
        existing.registration_digest,
        existing.semantic_digest
      );
    });
    return publicRow(readOrchestration(projectPath, registrationId)!);
  }
  const now = new Date().toISOString();
  withProjectTransaction(projectPath, (db) => {
    const current = db.prepare(
      `SELECT status, registration_digest, semantic_digest
       FROM component_preview_orchestrations WHERE registration_id = ?`
    ).get(registrationId) as {
      status: string;
      registration_digest: string;
      semantic_digest: string;
    };
    if (current.status === "verified_candidate") return;
    if (
      current.status !== "verifying" ||
      current.registration_digest !== existing.registration_digest ||
      current.semantic_digest !== existing.semantic_digest
    ) return;
    const event = buildLoggedEvent("component_preview_verified_candidate", {
      registration_id: registrationId,
      orchestration_id: existing.id,
      registration_digest: existing.registration_digest,
      semantic_digest: existing.semantic_digest,
      semantic_status: "no_delta"
    });
    insertEvent(db, event);
    db.prepare(
      `UPDATE component_preview_orchestrations
       SET status = 'verified_candidate',
           checkpoint = 'verified_candidate_recorded',
           verified_candidate_event_id = ?, failure_stage = NULL,
           failure_code = NULL, completed_at = ?, updated_at = ?
       WHERE registration_id = ? AND registration_digest = ?
         AND semantic_digest = ? AND status = 'verifying'`
    ).run(
      event.event_id,
      now,
      now,
      registrationId,
      existing.registration_digest,
      existing.semantic_digest
    );
  });
  return publicRow(readOrchestration(projectPath, registrationId)!);
}
