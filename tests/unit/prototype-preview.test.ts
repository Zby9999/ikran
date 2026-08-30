// Issue 30 — record_preview, the Runtime-owned dev-server lifecycle, and the
// stale semantics that keep a preview from lying about what it shows.
//
// The supervisor is fully injected (PreviewSupervisorDeps), so these tests
// exercise every terminal path — install failure, port conflict, probe timeout,
// dev server exit — without spawning a process or binding a port.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import {
  confirmDraftDesignSystem,
  confirmPrototype
} from "../../lib/runtime/project-phase";
import { recordDesignerFeedback } from "../../lib/runtime/designer-feedback";
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import { resetRecordBusForTests } from "../../lib/runtime/record-bus";
import {
  PREVIEW_ALLOWED_PHASES,
  bumpPrototypeSurfaceSourceGenerationForIds,
  getPrototypeSurface,
  listPrototypeSurfaces,
  markPrototypeSurfaceStale,
  recordPreview,
  setPrototypeSurfaceScreenshot,
  type RecordPreviewInput
} from "../../lib/runtime/prototype-surface";
import {
  setPrototypePreviewRefreshTestHost,
  stopAllPrototypePreviewRefresh,
  stopPrototypePreviewRefresh,
  waitForPrototypePreviewRefreshIdleForTests
} from "../../lib/runtime/prototype-preview-refresh";
import {
  PREVIEW_PORT_BASE,
  PREVIEW_DEPENDENCY_FINGERPRINT_FILE,
  PREVIEW_STABLE_WINDOW_MS,
  allocatePreviewPort,
  defaultPreviewSupervisorDeps,
  isAllowedDevCommand,
  killAllPreviewServers,
  previewDependencyInstallPlan,
  previewDevServerPlan,
  previewUrlForPort,
  prototypeDependencyFingerprint,
  startPreviewServer,
  type PreviewSupervisorDeps
} from "../../lib/runtime/preview-server";

beforeEach(() => {
  setPrototypePreviewRefreshTestHost({
    watch: () => ({ close() {} }),
    capture: async () => ({ ok: true, artifact_path: "x.png" }),
    fetchStatus: async () => ({ ok: true, status: 200 })
  });
});

afterEach(() => {
  killAllPreviewServers();
  stopAllPrototypePreviewRefresh();
  setPrototypePreviewRefreshTestHost(null);
  resetRecordBusForTests();
});

const SEED_ID = "seed-30";
const SURFACE_ID = "surface-30";
const PROTOTYPE_RELATIVE = "prototype/landing.tsx";

type SupervisorOverrides = Partial<PreviewSupervisorDeps> & {
  /** Resolve the dev server's `exited` promise on demand. */
  exit?: () => void;
};

/**
 * Deterministic supervisor: dependencies installed, port free, URL answers on
 * the first probe, process stays alive. Each test overrides only what it is
 * about.
 */
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
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-prototype-"));
  return (async () => {
    try {
      initializeProjectDb(projectPath);
      seedEvidence(projectPath);
      writePrototypeFile(projectPath);
      await run(projectPath);
    } finally {
      stopAllPrototypePreviewRefresh();
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
    runId: "run-30",
    sourceArtifactPath: PROTOTYPE_RELATIVE,
    prototypeRoot: "prototype",
    surfaceKey: "landing",
    name: "Landing",
    seedReferenceIds: [SEED_ID],
    evidenceVersionIds: [SURFACE_ID],
    ...overrides
  };
}

/** Move the project to the first phase where a preview is allowed. */
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
  const confirmed = confirmDraftDesignSystem(projectPath, "I reviewed the Draft.");
  if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
}

test("record_preview is rejected before confirm_draft_design_system", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);

    expect(
      await recordPreview(projectPath, previewInput(), {
        supervisor: supervisor()
      })
    ).toEqual({ ok: false, reason: "phase_gate", phase: "seed" });
    expect(listPrototypeSurfaces(projectPath)).toEqual([]);
    expect(listEvents(projectPath, "preview_started")).toEqual([]);
  });
});

test("the preview phase gate covers every phase past confirm_draft_design_system", () => {
  expect([...PREVIEW_ALLOWED_PHASES]).toEqual([
    "prototype_validation",
    "design_system_formal",
    "ready_for_new_design"
  ]);
});

test("record_preview creates the run and surface it froze its inputs from", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    const result = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    expect(result).toMatchObject({
      ok: true,
      readiness: "ready",
      run: {
        run_id: "run-30",
        source_artifact_path: PROTOTYPE_RELATIVE,
        prototype_root: "prototype",
        dev_command: "npm run dev",
        seed_reference_ids: [SEED_ID],
        evidence_version_ids: [SURFACE_ID]
      }
    });
    if (!result.ok) return;
    // Design-system version is derived from Runtime's own ingested index, not
    // from anything the Agent declared.
    expect(result.run.design_system_version).toBe("unversioned");
    expect(result.preview_url).toBe(previewUrlForPort(PREVIEW_PORT_BASE));

    const surfaces = listPrototypeSurfaces(projectPath);
    expect(surfaces).toMatchObject([
      {
        run_id: "run-30",
        surface_key: "landing",
        name: "Landing",
        preview_url: previewUrlForPort(PREVIEW_PORT_BASE),
        preview_port: PREVIEW_PORT_BASE,
        readiness: "ready",
        stale: false
      }
    ]);

    expect(listEvents(projectPath, "preview_started")).toEqual([
      expect.objectContaining({
        event_id: result.event_id,
        payload: expect.objectContaining({
          prototype_surface_id: surfaces[0].id,
          run_id: "run-30",
          surface_key: "landing",
          readiness: "ready"
        })
      })
    ]);
    expect(listEvents(projectPath, "preview_failed")).toEqual([]);

    // Record + event in one transaction: the run/surface creation is in the
    // canonical event log, not just the record tables.
    expect(listEvents(projectPath, "prototype_preview_declared")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          run_id: "run-30",
          prototype_run_id: result.run.id,
          prototype_surface_id: surfaces[0].id,
          surface_key: "landing",
          action: "created",
          run_created: true,
          source_artifact_path: PROTOTYPE_RELATIVE,
          seed_reference_ids: [SEED_ID],
          evidence_version_ids: [SURFACE_ID]
        })
      })
    ]);
  });
});

test("record_preview keeps the server origin separate and opens the explicit page route", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    const probed: string[] = [];

    const result = await recordPreview(
      projectPath,
      previewInput({
        surfaceKey: "atlas",
        name: "Atlas Case Study",
        routePath: "/projects/atlas"
      }),
      {
        supervisor: supervisor({
          probeUrl: async (url) => {
            probed.push(url);
            return true;
          }
        })
      }
    );

    expect(result).toMatchObject({
      ok: true,
      preview_url: "http://127.0.0.1:4300/projects/atlas",
      surface: {
        preview_url: "http://127.0.0.1:4300",
        route_path: "/projects/atlas",
        surface_url: "http://127.0.0.1:4300/projects/atlas"
      }
    });
    expect(probed).toContain("http://127.0.0.1:4300/projects/atlas");
  });
});

test("record_preview requires a declared prototype artifact and real linkage ids", async () => {
  await withProject(async (projectPath) => {
    enterPrototypeValidation(projectPath);

    expect(
      await recordPreview(projectPath, previewInput(), {
        supervisor: supervisor()
      })
    ).toEqual({ ok: false, reason: "prototype_artifact_not_declared" });

    declarePrototypeArtifact(projectPath);
    expect(
      await recordPreview(
        projectPath,
        previewInput({ seedReferenceIds: ["forged-seed"] }),
        { supervisor: supervisor() }
      )
    ).toEqual({ ok: false, reason: "linkage_record_not_found" });
    expect(
      await recordPreview(
        projectPath,
        previewInput({ evidenceVersionIds: ["forged-surface"] }),
        { supervisor: supervisor() }
      )
    ).toEqual({ ok: false, reason: "linkage_record_not_found" });

    // Seed reconstruction must say which evidence it reconstructs.
    expect(
      await recordPreview(
        projectPath,
        previewInput({ seedReferenceIds: [], evidenceVersionIds: [] }),
        { supervisor: supervisor() }
      )
    ).toEqual({ ok: false, reason: "missing_seed_evidence" });

    expect(
      await recordPreview(
        projectPath,
        previewInput({ prototypeRoot: "../outside" }),
        { supervisor: supervisor() }
      )
    ).toEqual({ ok: false, reason: "artifact_path_escape" });

    for (const routePath of [
      "projects/atlas",
      "//example.com/atlas",
      "/projects/../admin",
      "/projects/atlas?mode=1",
      "/projects/atlas#hero",
      "/projects\\atlas"
    ]) {
      expect(
        await recordPreview(projectPath, previewInput({ routePath }), {
          supervisor: supervisor()
        })
      ).toEqual({ ok: false, reason: "invalid_preview" });
    }

    expect(listPrototypeSurfaces(projectPath)).toEqual([]);
  });
});

test("a failed dependency install fails the surface instead of hanging", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    const result = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor({
        dependenciesInstalled: () => false,
        installDependencies: async () => false
      })
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "preview_not_ready",
      preview_reason: "install_failed"
    });
    if (result.ok || result.reason !== "preview_not_ready") return;
    expect(result.surface).toMatchObject({
      readiness: "failed",
      readiness_reason: "install_failed"
    });

    expect(listEvents(projectPath, "preview_failed")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          readiness: "failed",
          reason: "install_failed"
        })
      })
    ]);
    expect(listEvents(projectPath, "preview_started")).toEqual([]);
  });
});

test("an occupied port that is not this preview fails as a conflict", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    const result = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor({
        // Every port is taken, and nothing there answers as our preview.
        isPortFree: async () => false,
        probeUrl: async () => false
      })
    });
    expect(result).toEqual({ ok: false, reason: "no_available_preview_port" });
    expect(listPrototypeSurfaces(projectPath)).toEqual([]);
  });
});

test("a preview URL that never answers fails on the readiness budget", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    const result = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor({ probeUrl: async () => false }),
      timeoutMs: 1000
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "preview_not_ready",
      preview_reason: "preview_timeout"
    });
    if (result.ok || result.reason !== "preview_not_ready") return;
    expect(result.surface.readiness_reason).toBe("preview_timeout");
  });
});

test("a transient first response is not reported ready when the process exits", async () => {
  let exitProcess: ((value: { code: number | null; signal: string | null }) => void) | null = null;
  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) => {
      exitProcess = resolve;
    }
  );
  let probes = 0;
  const transitions: Array<[string, string | null]> = [];

  const outcome = await startPreviewServer(
    {
      root: "/tmp/prototype",
      command: "npm run dev",
      port: PREVIEW_PORT_BASE,
      url: previewUrlForPort(PREVIEW_PORT_BASE),
      onReadiness: (readiness, reason) => transitions.push([readiness, reason]),
      onExit: () => {}
    },
    supervisor({
      startDevServer: () => ({ exited, kill: () => {} }),
      probeUrl: async () => {
        probes += 1;
        if (probes === 1) exitProcess!({ code: 1, signal: null });
        return true;
      }
    })
  );

  expect(outcome).toMatchObject({
    readiness: "failed",
    reason: "dev_server_exited"
  });
  expect(transitions).toEqual([
    ["starting", null],
    ["failed", "dev_server_exited"]
  ]);
});

test("record_preview does not succeed when the surface turns stale at handoff", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    let exitProcess: ((value: { code: number | null; signal: string | null }) => void) | null = null;
    const exited = new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        exitProcess = resolve;
      }
    );
    let probes = 0;

    const result = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor({
        startDevServer: () => ({ exited, kill: () => {} }),
        probeUrl: async () => {
          probes += 1;
          if (probes === 4) exitProcess!({ code: 1, signal: null });
          return true;
        }
      })
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "preview_not_ready",
      preview_reason: "dev_server_exited",
      surface: { readiness: "ready", stale: true }
    });
  });
});

test("readiness requires successful probes across the stability window", async () => {
  let probes = 0;
  const outcome = await startPreviewServer(
    {
      root: "/tmp/prototype",
      command: "npm run dev",
      port: PREVIEW_PORT_BASE,
      url: previewUrlForPort(PREVIEW_PORT_BASE),
      onReadiness: () => {},
      onExit: () => {}
    },
    supervisor({ probeUrl: async () => (++probes > 0) })
  );

  expect(PREVIEW_STABLE_WINDOW_MS).toBe(750);
  expect(outcome.readiness).toBe("ready");
  expect(probes).toBeGreaterThanOrEqual(4);
});

test("dependency readiness follows package and lockfile content, not node_modules existence", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ikran-preview-deps-"));
  try {
    mkdirSync(path.join(root, "node_modules"));
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "1.0.0" } })
    );
    writeFileSync(path.join(root, "package-lock.json"), "{\"lockfileVersion\":3}\n");

    expect(defaultPreviewSupervisorDeps.dependenciesInstalled(root)).toBe(false);
    const fingerprint = prototypeDependencyFingerprint(root);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(
      path.join(root, "node_modules", PREVIEW_DEPENDENCY_FINGERPRINT_FILE),
      `${fingerprint}\n`
    );
    expect(defaultPreviewSupervisorDeps.dependenciesInstalled(root)).toBe(true);

    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "2.0.0" } })
    );
    expect(defaultPreviewSupervisorDeps.dependenciesInstalled(root)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dependency installs include dev packages without generating a source lockfile", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ikran-preview-plan-"));
  try {
    writeFileSync(path.join(root, "package.json"), "{}\n");
    const install = previewDependencyInstallPlan(root);
    expect(install.command).toBe(process.execPath);
    expect(install.args[0]).toMatch(
      /node_modules[/\\]npm[/\\]bin[/\\]npm-cli\.js$/
    );
    expect(install.args.slice(1)).toEqual([
      "install",
      "--include=dev",
      "--no-package-lock"
    ]);
    writeFileSync(path.join(root, "package-lock.json"), "{}\n");
    const cleanInstall = previewDependencyInstallPlan(root);
    expect(cleanInstall.command).toBe(process.execPath);
    expect(cleanInstall.args[0]).toBe(install.args[0]);
    expect(cleanInstall.args.slice(1)).toEqual(["ci", "--include=dev"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preview scripts use the Node-adjacent npm CLI instead of PATH package managers", () => {
  for (const command of ["npm run dev", "pnpm dev", "yarn dev", "bun run dev"]) {
    const plan = previewDevServerPlan(command);
    expect(plan.command).toBe(process.execPath);
    expect(plan.args[0]).toMatch(
      /node_modules[/\\]npm[/\\]bin[/\\]npm-cli\.js$/
    );
    expect(plan.args.slice(1)).toEqual(["run", "dev"]);
  }

  expect(previewDevServerPlan("npx vite").args.slice(1)).toEqual([
    "exec",
    "--",
    "vite"
  ]);
});

test("the packaged Runtime installs prototype dependencies without npm on PATH", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ikran-preview-bundled-npm-"));
  const previousPath = process.env.PATH;
  try {
    mkdirSync(path.join(root, "preview-dependency"));
    writeFileSync(
      path.join(root, "preview-dependency", "package.json"),
      `${JSON.stringify({ name: "preview-dependency", version: "1.0.0" })}\n`
    );
    writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify({
        name: "preview-fixture",
        private: true,
        devDependencies: { "preview-dependency": "file:preview-dependency" }
      })}\n`
    );
    process.env.PATH = "/usr/bin:/bin";

    await expect(
      defaultPreviewSupervisorDeps.installDependencies(root, 10_000)
    ).resolves.toEqual({ ok: true });
  } finally {
    process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a dependency install that never settles consumes the readiness budget", async () => {
  const outcome = await startPreviewServer(
    {
      root: "/tmp/prototype",
      command: "npm run dev",
      port: PREVIEW_PORT_BASE,
      url: previewUrlForPort(PREVIEW_PORT_BASE),
      timeoutMs: 500,
      onReadiness: () => {},
      onExit: () => {}
    },
    supervisor({
      dependenciesInstalled: () => false,
      installDependencies: async () => new Promise(() => {})
    })
  );

  expect(outcome).toMatchObject({
    readiness: "failed",
    reason: "preview_timeout",
    diagnosis: { kind: "preview_timeout" }
  });
});

test("process failures return a bounded sanitized command diagnosis", async () => {
  const secret = "do-not-return-this-secret";
  const secondSecret = "another-plain-secret";
  const outcome = await startPreviewServer(
    {
      root: "/tmp/prototype",
      command: "npm run dev",
      port: PREVIEW_PORT_BASE,
      url: previewUrlForPort(PREVIEW_PORT_BASE),
      onReadiness: () => {},
      onExit: () => {}
    },
    supervisor({
      startDevServer: () => ({
        exited: Promise.resolve({
          code: 127,
          signal: null,
          stderrTail: `OPENAI_API_KEY=${secret}\nVITE_API_TOKEN=${secondSecret}\nsh: vite: command not found\n${"x".repeat(10_000)}`
        }),
        kill: () => {}
      }),
      probeUrl: async () => false
    })
  );

  expect(outcome).toMatchObject({
    readiness: "failed",
    reason: "command_not_found",
    diagnosis: { kind: "command_not_found", exitCode: 127 }
  });
  expect(outcome.diagnosis?.stderrTail).toContain("[redacted]");
  expect(outcome.diagnosis?.stderrTail).not.toContain(secret);
  expect(outcome.diagnosis?.stderrTail).not.toContain(secondSecret);
  expect(outcome.diagnosis?.stderrTail).toBeDefined();
  expect(outcome.diagnosis?.stderrTail?.length ?? Infinity).toBeLessThanOrEqual(
    2_000
  );
});

test("a real dev script that ignores PORT cannot pass readiness", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ikran-preview-ignore-port-"));
  try {
    mkdirSync(path.join(root, "node_modules"));
    writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify({ scripts: { dev: "node server.mjs" } })}\n`
    );
    writeFileSync(
      path.join(root, "server.mjs"),
      "setTimeout(() => process.exit(0), 150);\n"
    );
    const fingerprint = prototypeDependencyFingerprint(root);
    writeFileSync(
      path.join(root, "node_modules", PREVIEW_DEPENDENCY_FINGERPRINT_FILE),
      `${fingerprint}\n`
    );

    const outcome = await startPreviewServer(
      {
        root,
        command: "npm run dev",
        port: 49_999,
        url: "http://127.0.0.1:49999",
        timeoutMs: 3_000,
        onReadiness: () => {},
        onExit: () => {}
      },
      { ...defaultPreviewSupervisorDeps, isPortFree: async () => true }
    );

    expect(outcome.readiness).toBe("failed");
    expect(outcome.reason).toBe("dev_server_exited");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preview timeout terminates the Runtime-owned process tree", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ikran-preview-process-tree-"));
  const leakedMarker = path.join(root, "leaked.txt");
  try {
    mkdirSync(path.join(root, "node_modules"));
    writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify({ scripts: { dev: "node parent.mjs" } })}\n`
    );
    writeFileSync(
      path.join(root, "parent.mjs"),
      `import { spawn } from "node:child_process";
spawn(process.execPath, ["-e", "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'leaked'), 1000)", ${JSON.stringify(leakedMarker)}], { stdio: "ignore" });
setInterval(() => {}, 1000);
`
    );
    const fingerprint = prototypeDependencyFingerprint(root);
    writeFileSync(
      path.join(root, "node_modules", PREVIEW_DEPENDENCY_FINGERPRINT_FILE),
      `${fingerprint}\n`
    );

    const outcome = await startPreviewServer(
      {
        root,
        command: "npm run dev",
        port: 49_998,
        url: "http://127.0.0.1:49998",
        timeoutMs: 300,
        onReadiness: () => {},
        onExit: () => {}
      },
      { ...defaultPreviewSupervisorDeps, isPortFree: async () => true }
    );
    expect(outcome.reason).toBe("preview_timeout");
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(() => readFileSync(leakedMarker, "utf8")).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("re-declaring a preview keeps the same surface and preview URL", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    const first = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await recordPreview(
      projectPath,
      previewInput({ name: "Landing v2" }),
      { supervisor: supervisor() }
    );
    expect(second).toMatchObject({
      ok: true,
      preview_url: first.preview_url,
      surface: { id: first.surface.id, name: "Landing v2" }
    });
    expect(listPrototypeSurfaces(projectPath)).toHaveLength(1);
  });
});

test("a second surface in the same run gets its own stable port", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    const first = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    const second = await recordPreview(
      projectPath,
      previewInput({ surfaceKey: "about", name: "About" }),
      { supervisor: supervisor() }
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.surface.preview_port).toBe(first.surface.preview_port + 1);
    expect(second.preview_url).not.toBe(first.preview_url);
  });
});

test("declaring changed prototype code with a live watcher refreshes instead of stale", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    writePrototypeFile(projectPath, "export default 2;\n");
    declarePrototypeArtifact(projectPath);
    await waitForPrototypePreviewRefreshIdleForTests();

    const surface = getPrototypeSurface(projectPath, preview.surface.id);
    expect(surface).toMatchObject({
      id: preview.surface.id,
      stale: false,
      stale_reason: null
    });
    expect(surface?.source_generation).toBeGreaterThan(0);
    expect(listEvents(projectPath, "preview_stale")).toEqual([]);
    expect(listEvents(projectPath, "preview_started")).toHaveLength(1);
  });
});

test("declaring changed prototype code marks surfaces stale without a watcher", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    stopPrototypePreviewRefresh({
      projectPath,
      prototypeRoot: "prototype",
      surfaceId: preview.surface.id
    });

    writePrototypeFile(projectPath, "export default 2;\n");
    declarePrototypeArtifact(projectPath);

    expect(listPrototypeSurfaces(projectPath)).toMatchObject([
      { id: preview.surface.id, stale: true, stale_reason: "code_changed" }
    ]);
    expect(listEvents(projectPath, "preview_stale")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          prototype_surface_id: preview.surface.id,
          reason: "code_changed"
        })
      })
    ]);
    expect(listEvents(projectPath, "preview_started")).toHaveLength(1);
  });
});

test("screenshot persist is a generation compare-and-set", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const first = setPrototypeSurfaceScreenshot(
      projectPath,
      preview.surface.id,
      ".ikran/artifacts/prototype-media/a.png",
      { expectedGeneration: 0 }
    );
    expect(first.ok).toBe(true);

    bumpPrototypeSurfaceSourceGenerationForIds(projectPath, [
      preview.surface.id
    ]);
    expect(
      setPrototypeSurfaceScreenshot(
        projectPath,
        preview.surface.id,
        ".ikran/artifacts/prototype-media/old.png",
        { expectedGeneration: 0 }
      )
    ).toEqual({ ok: false, reason: "generation_mismatch" });

    expect(
      setPrototypeSurfaceScreenshot(
        projectPath,
        preview.surface.id,
        ".ikran/artifacts/prototype-media/b.png",
        { expectedGeneration: 1 }
      ).ok
    ).toBe(true);
    const surface = getPrototypeSurface(projectPath, preview.surface.id);
    expect(surface?.screenshot_artifact_path).toBe(
      ".ikran/artifacts/prototype-media/b.png"
    );
    expect(surface?.screenshot_generation).toBe(1);
    expect(surface?.source_generation).toBe(1);
  });
});

test("code outside the prototype root leaves the surface alone", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    expect(preview.ok).toBe(true);

    const otherRelative = "scripts/build.ts";
    const absolute = path.join(projectPath, otherRelative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, "export default 3;\n", "utf8");
    const declared = recordSourceArtifact(projectPath, {
      path: otherRelative,
      artifactType: "code",
      semanticPurpose: "Unrelated build script."
    });
    expect(declared.ok).toBe(true);

    expect(listPrototypeSurfaces(projectPath)).toMatchObject([
      { stale: false, stale_reason: null }
    ]);
    expect(listEvents(projectPath, "preview_stale")).toEqual([]);
  });
});

test("a dev server that exits marks the surface stale exactly once", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    let exitProcess: (() => void) | null = null;
    const exited = new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        exitProcess = () => resolve({ code: 1, signal: null });
      }
    );
    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor({
        startDevServer: () => ({ exited, kill: () => {} })
      })
    });
    expect(preview).toMatchObject({ ok: true, readiness: "ready" });
    if (!preview.ok) return;

    exitProcess!();
    await exited;
    // The stale write is scheduled from the exit callback.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listPrototypeSurfaces(projectPath)).toMatchObject([
      { stale: true, stale_reason: "dev_server_exited" }
    ]);
    expect(
      markPrototypeSurfaceStale(
        projectPath,
        preview.surface.id,
        "dev_server_exited"
      )
    ).toEqual({ ok: true, already_stale: true });
    expect(listEvents(projectPath, "preview_stale")).toHaveLength(1);
  });
});

test("recording a preview clears a previous stale warning", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    const first = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(
      markPrototypeSurfaceStale(projectPath, first.surface.id, "code_changed")
    ).toEqual({ ok: true, already_stale: false });

    const second = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    expect(second).toMatchObject({
      ok: true,
      surface: { id: first.surface.id, stale: false, stale_reason: null }
    });
  });
});

test("prototype surfaces stay previewable in every post-confirm phase", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    expect(confirmPrototype(projectPath)).toMatchObject({
      ok: true,
      phase: "design_system_formal"
    });

    // Past prototype_validation the reconstruction builds on the formalized
    // system, so naming seed evidence is no longer required.
    const result = await recordPreview(
      projectPath,
      previewInput({ seedReferenceIds: [], evidenceVersionIds: [] }),
      { supervisor: supervisor() }
    );
    expect(result).toMatchObject({ ok: true, readiness: "ready" });
  });
});

test("Issue 27 feedback linkage accepts a real prototype surface id", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);
    const preview = await recordPreview(projectPath, previewInput(), {
      supervisor: supervisor()
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(
      recordDesignerFeedback(projectPath, {
        summary: "The hero spacing collapses under 900px.",
        runId: "run-30",
        sessionId: "session-30",
        prototypeSurfaceId: preview.surface.id
      })
    ).toMatchObject({
      ok: true,
      feedback: { prototype_surface_id: preview.surface.id }
    });

    expect(
      recordDesignerFeedback(projectPath, {
        summary: "Forged surface.",
        runId: "run-30",
        sessionId: "session-30",
        prototypeSurfaceId: "forged-prototype"
      })
    ).toEqual({ ok: false, reason: "linkage_record_not_found" });
  });
});

test("record_preview rejects a dev command outside the package-manager whitelist", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    const injected = await recordPreview(
      projectPath,
      previewInput({ devCommand: "npm run dev && touch /tmp/pwned" }),
      { supervisor: supervisor() }
    );
    expect(injected).toEqual({ ok: false, reason: "dev_command_not_allowed" });

    const shelled = await recordPreview(
      projectPath,
      previewInput({ devCommand: "sh -c 'echo hi'" }),
      { supervisor: supervisor() }
    );
    expect(shelled).toEqual({ ok: false, reason: "dev_command_not_allowed" });

    // Nothing reached the record tables or the event log.
    expect(listPrototypeSurfaces(projectPath)).toEqual([]);
    expect(listEvents(projectPath, "prototype_preview_declared")).toEqual([]);
    expect(listEvents(projectPath, "preview_started")).toEqual([]);
  });
});

test("record_preview accepts package-manager script commands", async () => {
  await withProject(async (projectPath) => {
    declarePrototypeArtifact(projectPath);
    enterPrototypeValidation(projectPath);

    for (const devCommand of [
      "npm run dev",
      "pnpm dev",
      "yarn dev",
      "bun run dev",
      "npx vite"
    ]) {
      expect(isAllowedDevCommand(devCommand)).toBe(true);
    }
    for (const devCommand of [
      "npm run dev; rm -rf /",
      "npm run dev $(whoami)",
      "npm run dev > /tmp/x",
      "npm run dev | cat",
      "./start.sh",
      "node server.js"
    ]) {
      expect(isAllowedDevCommand(devCommand)).toBe(false);
    }
  });
});

test("allocatePreviewPort skips claimed ports and reports exhaustion", async () => {
  const deps = supervisor();
  expect(await allocatePreviewPort([], deps)).toBe(PREVIEW_PORT_BASE);
  expect(await allocatePreviewPort([PREVIEW_PORT_BASE], deps)).toBe(
    PREVIEW_PORT_BASE + 1
  );
  expect(
    await allocatePreviewPort([], supervisor({ isPortFree: async () => false }))
  ).toBeNull();
});

test("an occupied port without a Runtime-owned process fails as a conflict", async () => {
  const transitions: Array<[string, string | null]> = [];
  const outcome = await startPreviewServer(
    {
      root: "/tmp/prototype",
      command: "npm run dev",
      port: PREVIEW_PORT_BASE,
      url: previewUrlForPort(PREVIEW_PORT_BASE),
      onReadiness: (readiness, reason) => transitions.push([readiness, reason]),
      onExit: () => {}
    },
    supervisor({ isPortFree: async () => false, probeUrl: async () => true })
  );
  expect(outcome).toMatchObject({
    readiness: "failed",
    reason: "port_conflict"
  });
  expect(transitions).toEqual([
    ["starting", null],
    ["failed", "port_conflict"]
  ]);
});

test("changed process declarations replace the old owner before reusing its port", async () => {
  let clock = 0;
  let running = false;
  let firstKilled = false;
  const starts: Array<{ root: string; command: string; port: number }> = [];
  const deps: PreviewSupervisorDeps = {
    dependenciesInstalled: () => true,
    installDependencies: async () => true,
    startDevServer: (input) => {
      starts.push(input);
      running = true;
      let resolveExit!: (value: { code: number | null; signal: string | null }) => void;
      const exited = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) => {
          resolveExit = resolve;
        }
      );
      return {
        exited,
        kill: () => {
          if (starts.length === 1) firstKilled = true;
          running = false;
          resolveExit({ code: 0, signal: "SIGTERM" });
        }
      };
    },
    probeUrl: async () => true,
    isPortFree: async () => !running,
    sleep: async () => {
      clock += 250;
    },
    now: () => clock
  };
  const base = {
    command: "npm run dev",
    port: PREVIEW_PORT_BASE,
    url: previewUrlForPort(PREVIEW_PORT_BASE),
    onReadiness: () => {},
    onExit: () => {}
  };

  expect((await startPreviewServer({ ...base, root: "/tmp/prototype-a" }, deps)).readiness)
    .toBe("ready");
  expect((await startPreviewServer({ ...base, root: "/tmp/prototype-b" }, deps)).readiness)
    .toBe("ready");
  expect(firstKilled).toBe(true);
  expect(starts.map(({ root }) => root)).toEqual([
    "/tmp/prototype-a",
    "/tmp/prototype-b"
  ]);
});

test("readiness transitions report installing before starting", async () => {
  const transitions: string[] = [];
  const outcome = await startPreviewServer(
    {
      root: "/tmp/prototype",
      command: "npm run dev",
      port: PREVIEW_PORT_BASE,
      url: previewUrlForPort(PREVIEW_PORT_BASE),
      onReadiness: (readiness) => transitions.push(readiness),
      onExit: () => {}
    },
    supervisor({
      dependenciesInstalled: () => false,
      installDependencies: async () => true
    })
  );
  expect(outcome.readiness).toBe("ready");
  expect(transitions).toEqual(["installing", "starting", "ready"]);
});
