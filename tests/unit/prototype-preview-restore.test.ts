// Runtime restart session restore — prototype previews across ikran relaunch.
//
// The dev server a Prototype Evidence Surface points at is a child of one
// Runtime process. A clean shutdown kills it and marks every live surface
// stale with `runtime_shutdown`; the next launch restores those surfaces —
// adopting a URL that still answers, respawning from the persisted run record
// when it does not. Surfaces stale for `code_changed` / `dev_server_exited`
// keep the Issue 30 "never auto-restart" semantics and are left alone.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { confirmDraftDesignSystem } from "../../lib/runtime/project-phase";
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import { resetRecordBusForTests } from "../../lib/runtime/record-bus";
import {
  RUNTIME_SHUTDOWN_STALE_REASON,
  getPrototypeSurface,
  listPrototypeSurfaces,
  markPrototypeSurfaceStale,
  markPrototypeSurfacesStaleForShutdown,
  recordPreview,
  resetPrototypePreviewRestoreForTests,
  restorePrototypePreviews,
  restorePrototypePreviewsOnce,
  type RecordPreviewInput
} from "../../lib/runtime/prototype-surface";
import {
  killAllPreviewServers,
  startPreviewServer,
  type PreviewSupervisorDeps
} from "../../lib/runtime/preview-server";

afterEach(() => {
  resetRecordBusForTests();
  resetPrototypePreviewRestoreForTests();
  killAllPreviewServers();
});

const SEED_ID = "seed-restore";
const SURFACE_ID = "surface-restore";
const PROTOTYPE_RELATIVE = "prototype/landing.tsx";

type SupervisorOverrides = Partial<PreviewSupervisorDeps>;

function supervisor(overrides: SupervisorOverrides = {}): PreviewSupervisorDeps {
  let clock = 0;
  return {
    dependenciesInstalled: () => true,
    installDependencies: async () => true,
    startDevServer: () => ({
      exited: new Promise(() => {}),
      kill: () => {}
    }),
    probeUrl: async () => true,
    isPortFree: async () => true,
    sleep: async () => {
      clock += 250;
    },
    now: () => clock,
    ...overrides
  };
}

function withProject(run: (projectPath: string) => Promise<void> | void) {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-restore-"));
  return (async () => {
    try {
      initializeProjectDb(projectPath);
      seedEvidence(projectPath);
      writePrototypeFile(projectPath);
      await run(projectPath);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  })();
}

function seedEvidence(projectPath: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO seed_references
       (id, figma_seed_reference, original_design_intent, created_at,
        registered_via, file_key, node_id)
       VALUES (?, ?, ?, ?, 'agent', ?, ?)`
    ).run(
      SEED_ID,
      "https://www.figma.com/design/PrototypeSeed/Frame?node-id=1-1",
      "Landing page reconstruction",
      "2026-08-06T00:00:00.000Z",
      "PrototypeSeed",
      "1:1"
    );
    db.prepare(
      `INSERT INTO figma_evidence_surfaces
       (id, seed_reference_id, figma_seed_reference, frame_node_id, frame_name,
        evidence_views_json, created_at)
       VALUES (?, ?, ?, '1:1', 'Landing', '{}', ?)`
    ).run(
      SURFACE_ID,
      SEED_ID,
      "https://www.figma.com/design/PrototypeSeed/Frame?node-id=1-1",
      "2026-08-06T00:00:00.000Z"
    );
  } finally {
    db.close();
  }
}

function writePrototypeFile(projectPath: string, body = "export default 1;\n") {
  const absolute = path.join(projectPath, PROTOTYPE_RELATIVE);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, "utf8");
}

function declarePrototypeArtifact(projectPath: string): void {
  const declared = recordSourceArtifact(projectPath, {
    path: PROTOTYPE_RELATIVE,
    artifactType: "prototype",
    semanticPurpose: "Landing page reconstruction from the seed evidence."
  });
  if (!declared.ok) throw new Error(JSON.stringify(declared));
}

function previewInput(
  overrides: Partial<RecordPreviewInput> = {}
): RecordPreviewInput {
  return {
    runId: "run-restore",
    sourceArtifactPath: PROTOTYPE_RELATIVE,
    prototypeRoot: "prototype",
    surfaceKey: "landing",
    name: "Landing",
    seedReferenceIds: [SEED_ID],
    evidenceVersionIds: [SURFACE_ID],
    ...overrides
  };
}

function enterPrototypeValidation(projectPath: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `UPDATE project_phase SET phase = 'draft_design_system', updated_at = ?
       WHERE singleton = 1`
    ).run(new Date().toISOString());
  } finally {
    db.close();
  }
  const confirmed = confirmDraftDesignSystem(projectPath);
  if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
}

/** Build one ready surface, then simulate a clean Runtime shutdown. */
async function readyThenShutdown(projectPath: string) {
  declarePrototypeArtifact(projectPath);
  enterPrototypeValidation(projectPath);
  const preview = await recordPreview(projectPath, previewInput(), {
    supervisor: supervisor()
  });
  if (!preview.ok) throw new Error(JSON.stringify(preview));
  markPrototypeSurfacesStaleForShutdown(projectPath);
  return preview;
}

test("shutdown marks every live surface stale with runtime_shutdown", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));

    const marked = markPrototypeSurfacesStaleForShutdown(projectPath);
    expect(marked).toEqual({ ok: true, stale_ids: [preview.surface.id] });

    const surface = getPrototypeSurface(projectPath, preview.surface.id);
    expect(surface).toMatchObject({
      stale: true,
      stale_reason: RUNTIME_SHUTDOWN_STALE_REASON
    });
    expect(listEvents(projectPath, "preview_stale")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          prototype_surface_id: preview.surface.id,
          reason: RUNTIME_SHUTDOWN_STALE_REASON
        })
      })
    ]);
  });
});

test("shutdown marking is idempotent and never touches code_changed staleness", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    markPrototypeSurfaceStale(projectPath, preview.surface.id, "code_changed");

    const marked = markPrototypeSurfacesStaleForShutdown(projectPath);
    expect(marked).toEqual({ ok: true, stale_ids: [] });

    const surface = getPrototypeSurface(projectPath, preview.surface.id);
    expect(surface?.stale_reason).toBe("code_changed");
    expect(listEvents(projectPath, "preview_stale")).toHaveLength(1);
  });
});

test("an intentional shutdown remains restorable when the initial park write is busy", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    let resolveExit!: (value: {
      code: number | null;
      signal: string | null;
    }) => void;
    const exited = new Promise<{
      code: number | null;
      signal: string | null;
    }>((resolve) => {
      resolveExit = resolve;
    });
    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor({
        startDevServer: () => ({
          exited,
          kill: () => resolveExit({ code: null, signal: "SIGTERM" })
        })
      })
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));

    // Reproduce the real shutdown race: another short transaction owns the
    // writer lock, so the best-effort runtime_shutdown park cannot commit.
    const lock = new DatabaseSync(getProjectDbPath(projectPath));
    lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
    try {
      expect(markPrototypeSurfacesStaleForShutdown(projectPath)).toEqual({
        ok: false,
        reason: "db_error"
      });
    } finally {
      lock.exec("ROLLBACK");
      lock.close();
    }

    // Runtime intentionally kills its owned child after the failed park. That
    // exit must not become terminal `dev_server_exited`; an honest ready row
    // is recoverable on the next launch as an unclean-shutdown candidate.
    killAllPreviewServers();
    await new Promise((resolve) => setTimeout(resolve, 0));

    let spawned = 0;
    const restored = await restorePrototypePreviews(projectPath, {
      supervisor: supervisor({
        probeUrl: async () => spawned > 0,
        startDevServer: () => {
          spawned += 1;
          return { exited: new Promise(() => {}), kill: () => {} };
        }
      })
    });

    expect(restored.restarted).toEqual([preview.surface.id]);
    expect(spawned).toBe(1);
    expect(getPrototypeSurface(projectPath, preview.surface.id)).toMatchObject({
      readiness: "ready",
      stale: false,
      stale_reason: null
    });
  });
});

test("a failed readiness is terminal: no shutdown parking, no restore retry", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor({
        dependenciesInstalled: () => false,
        installDependencies: async () => false
      })
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    expect(preview.surface.readiness).toBe("failed");

    // Shutdown parks nothing: the failure stays the surface's honest state.
    const marked = markPrototypeSurfacesStaleForShutdown(projectPath);
    expect(marked).toEqual({ ok: true, stale_ids: [] });

    // Restore neither adopts nor respawns a terminal failure.
    let spawned = 0;
    const result = await restorePrototypePreviews(projectPath, {
      supervisor: supervisor({
        startDevServer: () => {
          spawned += 1;
          return { exited: new Promise(() => {}), kill: () => {} };
        }
      })
    });
    expect(result).toMatchObject({ ok: true, adopted: [], restarted: [] });
    expect(spawned).toBe(0);
    expect(getPrototypeSurface(projectPath, preview.surface.id)).toMatchObject({
      readiness: "failed",
      stale: false
    });
  });
});

test("restore adopts the surface when its preview URL still answers", async () => {
  await withProject(async (projectPath) => {
    const preview = await readyThenShutdown(projectPath);
    let spawned = 0;

    const result = await restorePrototypePreviews(projectPath, {
      supervisor: supervisor({
        startDevServer: () => {
          spawned += 1;
          return { exited: new Promise(() => {}), kill: () => {} };
        }
      })
    });

    expect(result).toMatchObject({
      ok: true,
      adopted: [preview.surface.id],
      restarted: [],
      failed: []
    });
    expect(spawned).toBe(0);
    const surface = getPrototypeSurface(projectPath, preview.surface.id);
    expect(surface).toMatchObject({
      readiness: "ready",
      stale: false,
      stale_reason: null
    });
    // preview_started fires once for the original start and once for the adopt.
    expect(listEvents(projectPath, "preview_started")).toHaveLength(2);
  });
});

test("restore respawns the dev server from the persisted run when the URL is dead", async () => {
  await withProject(async (projectPath) => {
    const preview = await readyThenShutdown(projectPath);
    const starts: Array<{ root: string; command: string; port: number }> = [];
    let probes = 0;

    const result = await restorePrototypePreviews(projectPath, {
      supervisor: supervisor({
        probeUrl: async () => {
          probes += 1;
          // The adoption probe fails (nothing serving); probes after the
          // respawn succeed.
          return probes > 1;
        },
        startDevServer: (input) => {
          starts.push(input);
          return { exited: new Promise(() => {}), kill: () => {} };
        }
      })
    });

    expect(result).toMatchObject({
      ok: true,
      adopted: [],
      restarted: [preview.surface.id],
      failed: []
    });
    expect(starts).toEqual([
      {
        root: path.join(path.resolve(projectPath), "prototype"),
        command: "npm run dev",
        port: preview.surface.preview_port
      }
    ]);
    const surface = getPrototypeSurface(projectPath, preview.surface.id);
    expect(surface).toMatchObject({
      readiness: "ready",
      stale: false,
      stale_reason: null,
      preview_url: preview.surface.preview_url
    });
  });
});

test("restore reports a respawn that never becomes ready as failed", async () => {
  await withProject(async (projectPath) => {
    const preview = await readyThenShutdown(projectPath);

    const result = await restorePrototypePreviews(projectPath, {
      supervisor: supervisor({ probeUrl: async () => false }),
      timeoutMs: 1000
    });

    expect(result).toMatchObject({
      ok: true,
      adopted: [],
      restarted: [],
      failed: [preview.surface.id]
    });
    const surface = getPrototypeSurface(projectPath, preview.surface.id);
    expect(surface?.readiness).toBe("failed");
  });
});

test("restore never auto-restarts code_changed / dev_server_exited staleness", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    markPrototypeSurfaceStale(projectPath, preview.surface.id, "code_changed");

    let spawned = 0;
    const result = await restorePrototypePreviews(projectPath, {
      supervisor: supervisor({
        startDevServer: () => {
          spawned += 1;
          return { exited: new Promise(() => {}), kill: () => {} };
        }
      })
    });

    expect(result).toMatchObject({
      ok: true,
      adopted: [],
      restarted: [],
      failed: []
    });
    expect(spawned).toBe(0);
    const surface = getPrototypeSurface(projectPath, preview.surface.id);
    expect(surface).toMatchObject({ stale: true, stale_reason: "code_changed" });
  });
});

test("restore recovers a surface left ready by an unclean Runtime exit", async () => {
  await withProject(async (projectPath) => {
    // No shutdown marking: the Runtime died without cleanup, so the row still
    // claims ready while nothing serves the URL.
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));

    let spawned = 0;
    const result = await restorePrototypePreviews(projectPath, {
      supervisor: supervisor({
        probeUrl: async () => spawned > 0,
        startDevServer: () => {
          spawned += 1;
          return { exited: new Promise(() => {}), kill: () => {} };
        }
      })
    });

    expect(result).toMatchObject({
      ok: true,
      adopted: [],
      restarted: [preview.surface.id],
      failed: []
    });
    expect(spawned).toBe(1);
    expect(getPrototypeSurface(projectPath, preview.surface.id)?.readiness).toBe(
      "ready"
    );
  });
});

test("restore runs at most once per project per Runtime process", async () => {
  await withProject(async (projectPath) => {
    await readyThenShutdown(projectPath);

    const first = restorePrototypePreviewsOnce(projectPath, {
      supervisor: supervisor()
    });
    const second = restorePrototypePreviewsOnce(projectPath, {
      supervisor: supervisor()
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await first;
    expect(listPrototypeSurfaces(projectPath)).toHaveLength(1);
  });
});

test("killAllPreviewServers kills registered dev servers and forgets them", async () => {
  let killed = 0;
  const deps = supervisor({
    startDevServer: () => ({
      exited: new Promise(() => {}),
      kill: () => {
        killed += 1;
      }
    })
  });

  const outcome = await startPreviewServer(
    {
      root: "/tmp/prototype",
      command: "npm run dev",
      port: 4300,
      url: "http://127.0.0.1:4300",
      onReadiness: () => {},
      onExit: () => {}
    },
    deps
  );
  expect(outcome.readiness).toBe("ready");

  killAllPreviewServers();
  expect(killed).toBe(1);
  // The registry is cleared: a second sweep does not kill again.
  killAllPreviewServers();
  expect(killed).toBe(1);
});
