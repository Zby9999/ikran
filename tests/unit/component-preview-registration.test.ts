import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import {
  registerComponentPreview,
  SHARED_COMPONENT_PREVIEW_ROUTE
} from "../../lib/runtime/component-preview-registration";
import { getDesignSystemView } from "../../lib/runtime/design-system-view";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { recordArtifactWrittenCommand } from "../../lib/runtime/commands";
import { planComponentHero } from "../../components/workbench/design-system-view-model";
import {
  startComponentPreviewVerification
} from "../../lib/runtime/component-preview-verification";
import type { LiveHeroVerifyDeps } from "../../lib/runtime/live-hero-verify";
import {
  beginAutomaticComponentPreviewOrchestration,
  componentPreviewSemanticContract,
  resetAutomaticComponentPreviewOrchestrationHostForTests,
  setAutomaticComponentPreviewOrchestrationHostForTests
} from "../../lib/runtime/component-preview-orchestration";
import { resolveComponentPreviewException } from "../../lib/runtime/component-preview-exception";
import { applyDesignSystemIngestOnDb } from "../../lib/runtime/design-system-ingest";

const projects: string[] = [];

function write(dir: string, relative: string, body: string): void {
  const absolute = path.join(dir, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
}

function fixture(options: { linked?: boolean } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-preview-registration-"));
  projects.push(dir);
  initializeProjectDb(dir);
  write(
    dir,
    "prototype/package.json",
    JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } })
  );
  write(dir, "prototype/app/page.tsx", "export default function Page() { return null; }");
  write(
    dir,
    "prototype/components/TextLink.tsx",
    "export function TextLink({ label = 'Open' }) { return <a href='#'>{label}</a>; }"
  );
  write(
    dir,
    "prototype/components/IconButton.tsx",
    "export default function IconButton({ label = 'Menu' }) { return <button>{label}</button>; }"
  );
  const makeSpec = (id: string, name: string, codeLink: string) => ({
    id,
    name,
    meaning: name,
    status: "candidate",
    links: ["card-1"],
    value: {
      description: name,
      props: [],
      variants: [],
      stateMatrix: [],
      guidelines: [],
      tokenLinks: [],
      codeLinks: options.linked === false ? [] : [codeLink],
      sourceCaptures: []
    }
  });
  write(
    dir,
    "design-system/components/text-link.json",
    `${JSON.stringify(makeSpec("component.text-link", "Text Link", "prototype/components/TextLink.tsx"))}\n`
  );
  write(
    dir,
    "design-system/components/icon-button.json",
    `${JSON.stringify(makeSpec("component.icon-button", "Icon Button", "prototype/components/IconButton.tsx"))}\n`
  );
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    const now = "2026-08-27T00:00:00.000Z";
    const addEntry = db.prepare(
      `INSERT INTO design_system_entries
       (id, source_artifact_path, file_kind, section, entry_id, name,
        value_json, meaning, status, links_json, source_captures_json,
        position, created_at, updated_at)
       VALUES (?, ?, 'component-spec', 'components.spec', ?, ?, ?, ?,
               'candidate', '["card-1"]', '[]', 0, ?, ?)`
    );
    for (const item of [
      ["row-text", "design-system/components/text-link.json", "component.text-link", "Text Link", "prototype/components/TextLink.tsx"],
      ["row-icon", "design-system/components/icon-button.json", "component.icon-button", "Icon Button", "prototype/components/IconButton.tsx"]
    ] as const) {
      addEntry.run(
        item[0],
        item[1],
        item[2],
        item[3],
        JSON.stringify({
          description: item[3], props: [], variants: [], stateMatrix: [],
          guidelines: [], tokenLinks: [],
          codeLinks: options.linked === false ? [] : [item[4]]
        }),
        item[3],
        now,
        now
      );
    }
    const addArtifact = db.prepare(
      `INSERT INTO source_artifacts
       (id, path, artifact_type, semantic_purpose, related_record_ids_json,
        readiness, declaration_version, status, created_at, updated_at)
       VALUES (?, ?, 'code', 'component implementation', '[]', 'ready', 1,
               'ingested', ?, ?)`
    );
    addArtifact.run("artifact-text", "prototype/components/TextLink.tsx", now, now);
    addArtifact.run("artifact-icon", "prototype/components/IconButton.tsx", now, now);
    db.prepare(
      `INSERT INTO prototype_runs
       (id, run_id, source_artifact_path, prototype_root, dev_command,
        seed_reference_ids_json, evidence_version_ids_json,
        design_system_version, created_at, updated_at, kind, intent,
        used_candidate_ids_json)
       VALUES ('prototype-run', 'run-1', 'prototype/components/TextLink.tsx',
               'prototype', 'npm run dev', '[]', '[]', 'ds-v1', ?, ?,
               'seed_reconstruction', NULL, '[]')`
    ).run(now, now);
    db.prepare(
      `INSERT INTO prototype_surfaces
       (id, prototype_run_id, surface_key, name, preview_url, preview_port,
        readiness, readiness_reason, stale, stale_reason, created_at, updated_at)
       VALUES ('surface-1', 'prototype-run', 'default', 'Default',
               'http://127.0.0.1:4300', 4300, 'ready', NULL, 0, NULL, ?, ?)`
    ).run(now, now);
  } finally {
    db.close();
  }
  return dir;
}

afterEach(() => {
  resetAutomaticComponentPreviewOrchestrationHostForTests();
  for (const dir of projects.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registers exact exports into one shared Storybook-free adapter", () => {
  const dir = fixture();
  const first = registerComponentPreview(dir, {
    runId: "run-1",
    surfaceId: "surface-1",
    entryId: "component.text-link",
    modulePath: "prototype/components/TextLink.tsx",
    exportName: "TextLink",
    defaultArgs: { label: "Read details" }
  });
  expect(first.ok, JSON.stringify(first)).toBe(true);
  expect(first).toMatchObject({
    ok: true,
    adapter: { created: true, reused: false },
    registration: {
      entry_id: "component.text-link",
      module_path: "prototype/components/TextLink.tsx",
      export_name: "TextLink"
    }
  });

  const second = registerComponentPreview(dir, {
    runId: "run-1",
    surfaceId: "surface-1",
    entryId: "component.icon-button",
    modulePath: "prototype/components/IconButton.tsx",
    exportName: "default",
    defaultArgs: { label: "Open menu" }
  });
  expect(second).toMatchObject({
    ok: true,
    adapter: { created: false, reused: true }
  });

  const adapterRoot = path.join(
    dir,
    "prototype/app/ikran/component-preview"
  );
  expect(readdirSync(adapterRoot).sort()).toEqual(["[registrationId]", "registry.tsx"]);
  expect(readdirSync(path.join(adapterRoot, "[registrationId]"))).toEqual(["page.tsx"]);
  const registry = readFileSync(path.join(adapterRoot, "registry.tsx"), "utf8");
  expect(registry).toContain("TextLink as IkranComponent");
  expect(registry).toMatch(/import IkranComponent\d from/);
  expect(registry).not.toContain("@storybook");
  expect(readFileSync(path.join(dir, "prototype/package.json"), "utf8")).not.toContain("storybook");

  if (!first.ok || !second.ok) throw new Error("registration failed");
  const view = getDesignSystemView(dir);
  expect(view.ok).toBe(true);
  if (!view.ok) return;
  const text = view.view.components.specs.find(
    (entry) => entry.entry_id === "component.text-link"
  );
  const icon = view.view.components.specs.find(
    (entry) => entry.entry_id === "component.icon-button"
  );
  expect(text?.liveHero).toMatchObject({
    surfaceId: "surface-1",
    harnessPath: `${SHARED_COMPONENT_PREVIEW_ROUTE}/${first.registration.id}`,
    surfaceReadiness: "ready",
    surfaceStale: false
  });
  expect(icon?.liveHero).toMatchObject({
    harnessPath: `${SHARED_COMPONENT_PREVIEW_ROUTE}/${second.registration.id}`
  });
});

test("fails closed for an undeclared module, wrong export, stale surface, or path escape", () => {
  const dir = fixture();
  const base = {
    runId: "run-1",
    surfaceId: "surface-1",
    entryId: "component.text-link",
    defaultArgs: {}
  };
  expect(registerComponentPreview(dir, {
    ...base,
    modulePath: "prototype/components/Missing.tsx",
    exportName: "TextLink"
  })).toMatchObject({ ok: false, reason: "module_not_declared" });
  expect(registerComponentPreview(dir, {
    ...base,
    modulePath: "prototype/components/TextLink.tsx",
    exportName: "MissingExport"
  })).toMatchObject({ ok: false, reason: "export_not_found" });
  expect(registerComponentPreview(dir, {
    ...base,
    modulePath: "../outside.tsx",
    exportName: "default"
  })).toMatchObject({ ok: false, reason: "artifact_path_escape" });

  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare("UPDATE prototype_surfaces SET stale = 1 WHERE id = 'surface-1'").run();
  } finally {
    db.close();
  }
  expect(registerComponentPreview(dir, {
    ...base,
    modulePath: "prototype/components/TextLink.tsx",
    exportName: "TextLink"
  })).toMatchObject({ ok: false, reason: "preview_unavailable" });
});

test("one same-run artifact declaration auto-links code and shared preview idempotently", () => {
  const dir = fixture({ linked: false });
  setAutomaticComponentPreviewOrchestrationHostForTests({ schedule: () => undefined });
  const declaration = {
    path: "prototype/components/TextLink.tsx",
    artifactType: "code",
    semanticPurpose: "Text Link implementation",
    relatedRecordIds: [],
    readiness: "ready",
    componentPreview: {
      runId: "run-1",
      surfaceId: "surface-1",
      entryId: "component.text-link",
      modulePath: "prototype/components/TextLink.tsx",
      exportName: "TextLink",
      semanticImpact: "none",
      defaultArgs: { label: "Read details" },
      stateArgs: {}
    }
  };
  const first = recordArtifactWrittenCommand(dir, declaration) as Record<string, unknown>;
  expect(first, JSON.stringify(first)).toMatchObject({
    ok: true,
    component_preview: {
      ok: true,
      automatic: true,
      registration: { entry_id: "component.text-link" },
      next_action: "automatic_verification_queued"
    }
  });
  const specPath = path.join(dir, "design-system/components/text-link.json");
  const afterFirst = JSON.parse(readFileSync(specPath, "utf8"));
  expect(afterFirst.value.codeLinks).toEqual(["prototype/components/TextLink.tsx"]);
  expect(afterFirst.value.liveHero.harnessPath).toMatch(/^\/ikran\/component-preview\/preview-/);

  const second = recordArtifactWrittenCommand(dir, declaration) as Record<string, unknown>;
  expect(second).toMatchObject({
    ok: true,
    component_preview: {
      ok: true,
      automatic: true,
      idempotent: true,
      registration: {
        registration_digest:
          (first.component_preview as { registration: { registration_digest: string } })
            .registration.registration_digest
      }
    }
  });
  expect(
    readdirSync(path.join(dir, "prototype/app/ikran/component-preview")).sort()
  ).toEqual(["[registrationId]", "registry.tsx"]);
});

test("same-run declaration rejects identity mismatch before changing the component spec", () => {
  const dir = fixture({ linked: false });
  const specPath = path.join(dir, "design-system/components/text-link.json");
  const before = readFileSync(specPath, "utf8");
  const result = recordArtifactWrittenCommand(dir, {
    path: "prototype/components/TextLink.tsx",
    artifactType: "code",
    semanticPurpose: "Text Link implementation",
    componentPreview: {
      runId: "run-1",
      surfaceId: "surface-1",
      entryId: "component.text-link",
      modulePath: "prototype/components/IconButton.tsx",
      exportName: "default",
      semanticImpact: "none",
      defaultArgs: {}
    }
  }) as Record<string, unknown>;
  expect(result).toMatchObject({
    ok: false,
    reason: "component_preview_identity_mismatch"
  });
  expect(readFileSync(specPath, "utf8")).toBe(before);
});

test("same-run declaration preflights the export before any artifact or spec mutation", () => {
  const dir = fixture({ linked: false });
  const specPath = path.join(dir, "design-system/components/text-link.json");
  const beforeSpec = readFileSync(specPath, "utf8");
  const before = new DatabaseSync(getProjectDbPath(dir));
  let version = 0;
  let events = 0;
  try {
    version = (before.prepare(
      `SELECT declaration_version AS version FROM source_artifacts
       WHERE path = 'prototype/components/TextLink.tsx'`
    ).get() as { version: number }).version;
    events = (before.prepare("SELECT COUNT(*) AS count FROM events").get() as { count: number }).count;
  } finally {
    before.close();
  }
  const result = recordArtifactWrittenCommand(dir, {
    path: "prototype/components/TextLink.tsx",
    artifactType: "code",
    semanticPurpose: "Invalid export must be read-only",
    componentPreview: {
      runId: "run-1",
      surfaceId: "surface-1",
      entryId: "component.text-link",
      modulePath: "prototype/components/TextLink.tsx",
      exportName: "MissingExport",
      semanticImpact: "none"
    }
  });
  expect(result).toMatchObject({
    ok: false,
    reason: "component_preview_identity_invalid",
    details: { reason: "export_not_found" }
  });
  expect(readFileSync(specPath, "utf8")).toBe(beforeSpec);
  const after = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(after.prepare(
      `SELECT declaration_version AS version FROM source_artifacts
       WHERE path = 'prototype/components/TextLink.tsx'`
    ).get()).toEqual({ version });
    expect(after.prepare("SELECT COUNT(*) AS count FROM events").get()).toEqual({ count: events });
    expect(after.prepare("SELECT COUNT(*) AS count FROM component_preview_registrations").get())
      .toEqual({ count: 0 });
  } finally {
    after.close();
  }
});

test("code edits keep a reachable hero live while queuing fresh verification", () => {
  const dir = fixture();
  const registered = registerComponentPreview(dir, {
    runId: "run-1",
    surfaceId: "surface-1",
    entryId: "component.text-link",
    modulePath: "prototype/components/TextLink.tsx",
    exportName: "TextLink",
    defaultArgs: { label: "Read details" }
  });
  expect(registered.ok).toBe(true);
  const beforeVerification = getDesignSystemView(dir);
  if (!beforeVerification.ok) throw new Error(beforeVerification.reason);
  const unverifiedHero = beforeVerification.view.components.specs.find(
    (entry) => entry.entry_id === "component.text-link"
  )?.liveHero ?? null;
  expect(unverifiedHero).toMatchObject({ liveAvailability: "unavailable" });
  expect(planComponentHero(unverifiedHero, [], null).kind).toBe("unavailable");
  const verified = new DatabaseSync(getProjectDbPath(dir));
  try {
    verified.prepare(
      `UPDATE component_preview_registrations
       SET availability_status = 'available', verification_status = 'verified'
       WHERE entry_id = 'component.text-link'`
    ).run();
  } finally {
    verified.close();
  }
  write(
    dir,
    "prototype/components/TextLink.tsx",
    "export function TextLink({ label = 'Open' }) { return <a className='updated' href='#'>{label}</a>; }"
  );
  const declared = recordArtifactWrittenCommand(dir, {
    path: "prototype/components/TextLink.tsx",
    artifactType: "code",
    semanticPurpose: "Text Link visual update",
    relatedRecordIds: [],
    readiness: "ready"
  });
  expect(declared.ok).toBe(true);

  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(
      db.prepare(
        `SELECT stale, stale_reason FROM prototype_surfaces WHERE id = 'surface-1'`
      ).get()
    ).toEqual({ stale: 0, stale_reason: null });
    expect(
      db.prepare(
        `SELECT availability_status, verification_status, verification_identity
         FROM component_preview_registrations WHERE entry_id = 'component.text-link'`
      ).get()
    ).toMatchObject({
      availability_status: "available",
      verification_status: "queued",
      verification_identity: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  } finally {
    db.close();
  }

  const readHero = () => {
    const result = getDesignSystemView(dir);
    if (!result.ok) throw new Error(result.reason);
    return result.view.components.specs.find(
      (entry) => entry.entry_id === "component.text-link"
    )?.liveHero ?? null;
  };
  const firstClient = readHero();
  const secondClient = readHero();
  expect(firstClient).toMatchObject({
    liveAvailability: "available",
    verificationFreshness: "queued",
    surfaceStale: false
  });
  expect(secondClient).toEqual(firstClient);
  expect(planComponentHero(firstClient, [], null).kind).toBe("live");

  const stopped = new DatabaseSync(getProjectDbPath(dir));
  try {
    stopped.prepare(
      `UPDATE prototype_surfaces SET readiness = 'failed', readiness_reason = 'server_exit'
       WHERE id = 'surface-1'`
    ).run();
  } finally {
    stopped.close();
  }
  const unavailable = readHero();
  expect(unavailable).toMatchObject({ liveAvailability: "unavailable" });
  expect(planComponentHero(unavailable, [], null)).toMatchObject({
    kind: "unavailable",
    liveFallback: "surface_not_ready"
  });

  const recovered = new DatabaseSync(getProjectDbPath(dir));
  try {
    recovered.prepare(
      `UPDATE prototype_surfaces SET readiness = 'ready', readiness_reason = NULL
       WHERE id = 'surface-1'`
    ).run();
  } finally {
    recovered.close();
  }
  expect(planComponentHero(readHero(), [], null).kind).toBe("live");
});

test("component re-ingest updates the stable entry row without breaking its registration", () => {
  const dir = fixture();
  const registered = registerComponentPreview(dir, {
    runId: "run-1",
    surfaceId: "surface-1",
    entryId: "component.text-link",
    modulePath: "prototype/components/TextLink.tsx",
    exportName: "TextLink"
  });
  if (!registered.ok) throw new Error(JSON.stringify(registered));
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    const before = db.prepare(
      `SELECT e.id AS row_id, r.entry_row_id
       FROM design_system_entries e
       JOIN component_preview_registrations r ON r.entry_id = e.entry_id
       WHERE e.entry_id = 'component.text-link'`
    ).get() as { row_id: string; entry_row_id: string };
    applyDesignSystemIngestOnDb(db, {
      fileKind: "component-spec",
      sourcePath: "design-system/components/text-link.json",
      rows: [{
        entry_id: "component.text-link",
        section: "components.spec",
        name: "Text Link",
        kind: null,
        domain: null,
        value: {
          description: "Updated without replacing identity",
          props: [], variants: [], stateMatrix: [], guidelines: [], tokenLinks: [],
          codeLinks: ["prototype/components/TextLink.tsx"]
        },
        source_captures: [],
        meaning: "Text Link",
        status: "candidate",
        links: ["card-1"],
        position: 0
      }],
      firstIngest: false,
      systemName: null,
      now: "2026-08-27T01:00:00.000Z"
    });
    expect(db.prepare(
      `SELECT e.id AS row_id, r.entry_row_id,
              json_extract(e.value_json, '$.description') AS description
       FROM design_system_entries e
       JOIN component_preview_registrations r ON r.entry_id = e.entry_id
       WHERE e.entry_id = 'component.text-link'`
    ).get()).toEqual({
      row_id: before.row_id,
      entry_row_id: before.entry_row_id,
      description: "Updated without replacing identity"
    });
  } finally {
    db.close();
  }
});

test("verifies default first, persists background state failure, and resumes unchanged work", async () => {
  const dir = fixture();
  const specPath = "design-system/components/text-link.json";
  const spec = JSON.parse(readFileSync(path.join(dir, specPath), "utf8"));
  spec.value.stateMatrix = [{ state: "hover" }, { state: "focus" }];
  write(dir, specPath, `${JSON.stringify(spec)}\n`);
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `UPDATE design_system_entries SET value_json = ?
       WHERE entry_id = 'component.text-link'`
    ).run(JSON.stringify(spec.value));
  } finally {
    db.close();
  }
  const registered = registerComponentPreview(dir, {
    runId: "run-1",
    surfaceId: "surface-1",
    entryId: "component.text-link",
    modulePath: "prototype/components/TextLink.tsx",
    exportName: "TextLink",
    defaultArgs: { label: "Read details" },
    stateArgs: { hover: { hovered: true }, focus: { focused: true } }
  });
  expect(registered.ok).toBe(true);

  const visited: string[] = [];
  const deps = (failState: string | null): LiveHeroVerifyDeps => ({
    launchBrowser: async () => ({
      newPage: async () => ({
        setContent: async () => undefined,
        loadHarnessAndAwaitReport: async (url) => {
          const state = new URL(url).searchParams.get("state") ?? "default";
          visited.push(state);
          return state === failState
            ? null
            : { x: 0, y: 0, width: 120, height: 32 };
        }
      }),
      close: async () => undefined
    }),
    fetchStatus: async () => ({ ok: true, status: 200 })
  });
  const scheduled: Array<() => Promise<void>> = [];
  const first = await startComponentPreviewVerification(
    dir,
    { entryIds: ["component.text-link"], timeoutMs: 1000 },
    {
      deps: deps("hover"),
      schedule: (work) => scheduled.push(work)
    }
  );
  expect(first).toMatchObject({
    ok: true,
    default_all_passed: true,
    background_queued: true
  });
  expect(visited).toEqual(["default"]);
  expect(scheduled).toHaveLength(1);
  await scheduled[0]();
  expect(visited[0]).toBe("default");
  expect(new Set(visited.slice(1))).toEqual(new Set(["hover", "focus"]));

  const failed = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(
      failed.prepare(
        `SELECT state, status, failure_reason
         FROM component_preview_verification_results
         ORDER BY CASE state WHEN 'default' THEN 0 WHEN 'hover' THEN 1 ELSE 2 END`
      ).all()
    ).toEqual([
      { state: "default", status: "passed", failure_reason: null },
      { state: "hover", status: "failed", failure_reason: "geometry_timeout" },
      { state: "focus", status: "passed", failure_reason: null }
    ]);
    expect(
      failed.prepare(
        `SELECT availability_status, verification_status
         FROM component_preview_registrations WHERE entry_id = 'component.text-link'`
      ).get()
    ).toEqual({ availability_status: "available", verification_status: "failed" });
  } finally {
    failed.close();
  }
  const failedHero = getDesignSystemView(dir);
  if (!failedHero.ok) throw new Error(failedHero.reason);
  const hero = failedHero.view.components.specs.find(
    (entry) => entry.entry_id === "component.text-link"
  )?.liveHero ?? null;
  expect(hero).toMatchObject({
    liveAvailability: "available",
    verificationFreshness: "failed"
  });
  expect(planComponentHero(hero, [], null).kind).toBe("live");

  visited.length = 0;
  scheduled.length = 0;
  const resumed = await startComponentPreviewVerification(
    dir,
    { entryIds: ["component.text-link"], timeoutMs: 1000 },
    { deps: deps(null), schedule: (work) => scheduled.push(work) }
  );
  expect(resumed).toMatchObject({ ok: true, default_cache_hits: 1 });
  expect(visited).toEqual([]);
  await scheduled[0]();
  expect(visited).toEqual(["hover"]);
  const verified = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(
      verified.prepare(
        `SELECT verification_status FROM component_preview_registrations
         WHERE entry_id = 'component.text-link'`
      ).get()
    ).toEqual({ verification_status: "verified" });
  } finally {
    verified.close();
  }
});

test("uses digest cache and priority-ordered bounded parallel verification", async () => {
  const dir = fixture();
  const setStates = (entryId: string, specPath: string) => {
    const spec = JSON.parse(readFileSync(path.join(dir, specPath), "utf8"));
    spec.value.stateMatrix = [{ state: "hover" }];
    write(dir, specPath, `${JSON.stringify(spec)}\n`);
    const db = new DatabaseSync(getProjectDbPath(dir));
    try {
      db.prepare("UPDATE design_system_entries SET value_json = ? WHERE entry_id = ?")
        .run(JSON.stringify(spec.value), entryId);
    } finally {
      db.close();
    }
  };
  setStates("component.text-link", "design-system/components/text-link.json");
  setStates("component.icon-button", "design-system/components/icon-button.json");
  const textRegistration = registerComponentPreview(dir, {
    runId: "run-1", surfaceId: "surface-1", entryId: "component.text-link",
    modulePath: "prototype/components/TextLink.tsx", exportName: "TextLink",
    defaultArgs: {}, stateArgs: { hover: { hovered: true } }
  });
  const iconRegistration = registerComponentPreview(dir, {
    runId: "run-1", surfaceId: "surface-1", entryId: "component.icon-button",
    modulePath: "prototype/components/IconButton.tsx", exportName: "default",
    defaultArgs: {}, stateArgs: { hover: { hovered: true } }
  });
  if (!textRegistration.ok || !iconRegistration.ok) throw new Error("registration failed");

  let active = 0;
  let maxActive = 0;
  const visited: string[] = [];
  const deps: LiveHeroVerifyDeps = {
    launchBrowser: async () => ({
      newPage: async () => ({
        setContent: async () => undefined,
        loadHarnessAndAwaitReport: async (url) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          visited.push(url);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { x: 0, y: 0, width: 100, height: 30 };
        }
      }),
      close: async () => undefined
    }),
    fetchStatus: async () => ({ ok: true, status: 200 })
  };
  const scheduled: Array<() => Promise<void>> = [];
  const first = await startComponentPreviewVerification(
    dir,
    { concurrency: 2, priorityEntryIds: ["component.icon-button"], timeoutMs: 1000 },
    { deps, schedule: (work) => scheduled.push(work) }
  );
  expect(first).toMatchObject({ ok: true, concurrency: 2, cache_hits: 0 });
  expect(visited[0]).toContain(iconRegistration.registration.id);
  await scheduled[0]();
  expect(maxActive).toBe(2);
  expect(visited).toHaveLength(4);

  visited.length = 0;
  maxActive = 0;
  scheduled.length = 0;
  const second = await startComponentPreviewVerification(
    dir,
    { concurrency: 2, priorityEntryIds: ["component.icon-button"], timeoutMs: 1000 },
    { deps, schedule: (work) => scheduled.push(work) }
  );
  expect(second).toMatchObject({
    ok: true,
    cache_hits: 4,
    background_queued: false
  });
  expect(visited).toEqual([]);
  expect(scheduled).toEqual([]);

  const changedSibling = registerComponentPreview(dir, {
    runId: "run-1", surfaceId: "surface-1", entryId: "component.icon-button",
    modulePath: "prototype/components/IconButton.tsx", exportName: "default",
    defaultArgs: { label: "Changed sibling" }, stateArgs: { hover: { hovered: true } }
  });
  expect(changedSibling.ok).toBe(true);
  visited.length = 0;
  scheduled.length = 0;
  const siblingRun = await startComponentPreviewVerification(
    dir,
    { concurrency: 2, timeoutMs: 1000 },
    { deps, schedule: (work) => scheduled.push(work) }
  );
  expect(siblingRun).toMatchObject({ ok: true, cache_hits: 2 });
  await scheduled[0]();
  expect(visited).toHaveLength(2);
  expect(visited.every((url) => url.includes(iconRegistration.registration.id))).toBe(true);

  write(
    dir,
    "prototype/components/TextLink.tsx",
    "export function TextLink() { return <a className='v2'>Updated</a>; }"
  );
  expect(recordArtifactWrittenCommand(dir, {
    path: "prototype/components/TextLink.tsx",
    artifactType: "code",
    semanticPurpose: "Text Link update",
    relatedRecordIds: []
  }).ok).toBe(true);
  visited.length = 0;
  scheduled.length = 0;
  const fourth = await startComponentPreviewVerification(
    dir,
    { concurrency: 2, timeoutMs: 1000 },
    { deps, schedule: (work) => scheduled.push(work) }
  );
  expect(fourth).toMatchObject({ ok: true, cache_hits: 2 });
  await scheduled[0]();
  expect(visited).toHaveLength(2);
  expect(visited.every((url) => url.includes(textRegistration.registration.id))).toBe(true);

  const timing = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(
      timing.prepare(
        `SELECT concurrency, cache_hits, work_count, status
         FROM component_preview_verification_batches ORDER BY created_at DESC, rowid DESC LIMIT 1`
      ).get()
    ).toMatchObject({ concurrency: 2, cache_hits: 2, work_count: 4, status: "completed" });
    expect(
      timing.prepare(
        `SELECT COUNT(*) AS count FROM component_preview_verification_work
         WHERE cache_hit = 0 AND browser_ms >= 0`
      ).get()
    ).toMatchObject({ count: expect.any(Number) });
  } finally {
    timing.close();
  }
});

test("an old verification identity cannot revive availability or sign a newer source edit", async () => {
  const dir = fixture();
  const registered = registerComponentPreview(dir, {
    runId: "run-1",
    surfaceId: "surface-1",
    entryId: "component.text-link",
    modulePath: "prototype/components/TextLink.tsx",
    exportName: "TextLink"
  });
  if (!registered.ok) throw new Error(JSON.stringify(registered));
  let release!: (bounds: { x: number; y: number; width: number; height: number }) => void;
  let announce!: () => void;
  const browserStarted = new Promise<void>((resolve) => { announce = resolve; });
  const resultGate = new Promise<{ x: number; y: number; width: number; height: number }>(
    (resolve) => { release = resolve; }
  );
  const deps: LiveHeroVerifyDeps = {
    launchBrowser: async () => ({
      newPage: async () => ({
        setContent: async () => undefined,
        loadHarnessAndAwaitReport: async () => {
          announce();
          return resultGate;
        }
      }),
      close: async () => undefined
    }),
    fetchStatus: async () => ({ ok: true, status: 200 })
  };
  const verification = startComponentPreviewVerification(
    dir,
    { entryIds: ["component.text-link"] },
    { deps, schedule: () => undefined }
  );
  await browserStarted;
  const beforeEdit = new DatabaseSync(getProjectDbPath(dir));
  let oldIdentity = "";
  try {
    oldIdentity = (beforeEdit.prepare(
      `SELECT verification_identity AS identity
       FROM component_preview_registrations WHERE entry_id = 'component.text-link'`
    ).get() as { identity: string }).identity;
  } finally {
    beforeEdit.close();
  }
  write(
    dir,
    "prototype/components/TextLink.tsx",
    "export function TextLink() { return <a className='new-identity'>New</a>; }"
  );
  expect(recordArtifactWrittenCommand(dir, {
    path: "prototype/components/TextLink.tsx",
    artifactType: "code",
    semanticPurpose: "Concurrent source edit",
    relatedRecordIds: []
  }).ok).toBe(true);
  release({ x: 0, y: 0, width: 100, height: 24 });
  expect(await verification).toMatchObject({ ok: true, default_all_passed: true });
  const afterEdit = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(afterEdit.prepare(
      `SELECT availability_status, verification_status,
              verification_identity AS identity
       FROM component_preview_registrations WHERE entry_id = 'component.text-link'`
    ).get()).toMatchObject({
      availability_status: "registered",
      verification_status: "queued",
      identity: expect.not.stringMatching(oldIdentity)
    });
    expect(afterEdit.prepare(
      `SELECT COUNT(*) AS count FROM component_preview_orchestrations
       WHERE status = 'verified_candidate'`
    ).get()).toEqual({ count: 0 });
  } finally {
    afterEdit.close();
  }
});

test("ordinary declaration autonomously reaches internal Verified Candidate exactly once", async () => {
  const dir = fixture({ linked: false });
  const scheduled: Array<() => Promise<void>> = [];
  const deps: LiveHeroVerifyDeps = {
    launchBrowser: async () => ({
      newPage: async () => ({
        setContent: async () => undefined,
        loadHarnessAndAwaitReport: async () => ({
          x: 0, y: 0, width: 120, height: 32
        })
      }),
      close: async () => undefined
    }),
    fetchStatus: async () => ({ ok: true, status: 200 })
  };
  setAutomaticComponentPreviewOrchestrationHostForTests({
    deps,
    schedule: (work) => scheduled.push(work)
  });
  const declaration = {
    path: "prototype/components/TextLink.tsx",
    artifactType: "code",
    semanticPurpose: "Text Link implementation",
    relatedRecordIds: [],
    componentPreview: {
      runId: "run-1",
      surfaceId: "surface-1",
      entryId: "component.text-link",
      modulePath: "prototype/components/TextLink.tsx",
      exportName: "TextLink",
      semanticImpact: "none",
      defaultArgs: { label: "Read details" },
      stateArgs: {}
    }
  };
  const result = recordArtifactWrittenCommand(dir, declaration);
  expect(result).toMatchObject({
    ok: true,
    component_preview: {
      automatic: true,
      next_action: "automatic_verification_queued",
      orchestration: { status: "pending", semantic_status: "no_delta" }
    }
  });
  expect(scheduled).toHaveLength(1);
  await scheduled[0]();

  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(
      db.prepare(
        `SELECT status, semantic_status, checkpoint, failure_stage
         FROM component_preview_orchestrations`
      ).get()
    ).toEqual({
      status: "verified_candidate",
      semantic_status: "no_delta",
      checkpoint: "verified_candidate_recorded",
      failure_stage: null
    });
    expect(
      db.prepare(
        `SELECT status FROM design_system_entries
         WHERE entry_id = 'component.text-link'`
      ).get()
    ).toEqual({ status: "candidate" });
    expect(
      db.prepare(
        `SELECT COUNT(*) AS count FROM events
         WHERE type = 'component_preview_verified_candidate'`
      ).get()
    ).toEqual({ count: 1 });
    expect(
      db.prepare(
        `SELECT COUNT(*) AS count FROM events
         WHERE type = 'design_system_entry_approved'`
      ).get()
    ).toEqual({ count: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM component_preview_exceptions").get()
    ).toEqual({ count: 0 });
  } finally {
    db.close();
  }

  scheduled.length = 0;
  const repeated = recordArtifactWrittenCommand(dir, declaration);
  expect(repeated, JSON.stringify(repeated)).toMatchObject({
    ok: true,
    component_preview: {
      idempotent: true,
      orchestration: { status: "verified_candidate" }
    }
  });
  expect(scheduled).toEqual([]);
  const after = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(
      after.prepare(
        `SELECT COUNT(*) AS count FROM events
         WHERE type = 'component_preview_verified_candidate'`
      ).get()
    ).toEqual({ count: 1 });
  } finally {
    after.close();
  }
});

test("direct orchestration uncertainty produces one bounded semantic exception", () => {
  const dir = fixture();
  const registered = registerComponentPreview(dir, {
    runId: "run-1",
    surfaceId: "surface-1",
    entryId: "component.text-link",
    modulePath: "prototype/components/TextLink.tsx",
    exportName: "TextLink",
    stateArgs: { undeclared: { active: true } }
  });
  if (!registered.ok) throw new Error(JSON.stringify(registered));
  const db = new DatabaseSync(getProjectDbPath(dir));
  let contract: unknown;
  try {
    contract = JSON.parse((db.prepare(
      `SELECT value_json FROM design_system_entries
       WHERE entry_id = 'component.text-link'`
    ).get() as { value_json: string }).value_json);
  } finally {
    db.close();
  }
  const orchestration = beginAutomaticComponentPreviewOrchestration(
    dir,
    registered.registration.id,
    componentPreviewSemanticContract(contract).digest
  );
  expect(orchestration).toMatchObject({
    status: "exception_required",
    semantic_status: "uncertain",
    checkpoint: "semantic_exception_required"
  });
  const after = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(after.prepare(
      `SELECT kind, status,
              json_extract(packet_json, '$.detected_conflicts[0]') AS conflict
       FROM component_preview_exceptions`
    ).get()).toEqual({
      kind: "semantic_delta",
      status: "pending",
      conflict: "state_not_in_component_contract:undeclared"
    });
  } finally {
    after.close();
  }
});

test("provider ambiguity emits one bounded resumable exception and validates disposition", () => {
  const dir = fixture();
  const sibling = registerComponentPreview(dir, {
    runId: "run-1",
    surfaceId: "surface-1",
    entryId: "component.icon-button",
    modulePath: "prototype/components/IconButton.tsx",
    exportName: "default"
  });
  if (!sibling.ok) throw new Error(JSON.stringify(sibling));
  const declaration = {
    path: "prototype/components/TextLink.tsx",
    artifactType: "code",
    semanticPurpose: "Text Link with theme provider",
    relatedRecordIds: ["card-1"],
    componentPreview: {
      runId: "run-1",
      surfaceId: "surface-1",
      entryId: "component.text-link",
      modulePath: "prototype/components/TextLink.tsx",
      exportName: "TextLink",
      semanticImpact: "possible",
      defaultArgs: {},
      providerRecipe: {
        modulePath: "prototype/providers/ThemeProvider.tsx",
        exportName: "ThemeProvider",
        props: { theme: "dark" }
      }
    }
  };
  const first = recordArtifactWrittenCommand(dir, declaration);
  expect(first).toMatchObject({
    ok: true,
    component_preview: {
      automatic: false,
      next_action: "resolve_component_preview_exception",
      exception: {
        kind: "provider_recipe",
        identity: {
          run_id: "run-1",
          entry_id: "component.text-link",
          module_path: "prototype/components/TextLink.tsx",
          export_name: "TextLink"
        },
        evidence_record_ids: ["card-1"],
        detected_conflicts: ["provider_recipe_requires_judgment"]
      }
    }
  });
  if (
    !first.ok ||
    !("component_preview" in first) ||
    !first.component_preview ||
    first.component_preview.automatic
  ) {
    throw new Error("exception missing");
  }
  const packet = first.component_preview.exception;
  expect(JSON.stringify(packet)).not.toContain("conversation");
  expect(JSON.stringify(packet)).not.toContain("transcript");

  const repeated = recordArtifactWrittenCommand(dir, declaration);
  expect(repeated, JSON.stringify(repeated)).toMatchObject({
    ok: true,
    component_preview: {
      automatic: false,
      exception: { exception_id: packet.exception_id }
    }
  });
  const pending = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(
      pending.prepare("SELECT COUNT(*) AS count FROM component_preview_exceptions").get()
    ).toEqual({ count: 1 });
    expect(pending.prepare(
      `SELECT stale, stale_reason FROM prototype_surfaces WHERE id = 'surface-1'`
    ).get()).toEqual({ stale: 0, stale_reason: null });
  } finally {
    pending.close();
  }

  expect(resolveComponentPreviewException(dir, {
    exceptionId: packet.exception_id,
    expectedDigest: packet.exception_digest,
    disposition: "retain_open_gap",
    rationale: "Keep the provider requirement explicit until theme ownership is resolved.",
    evidenceRecordIds: ["unrelated-evidence"],
    targetCategory: "open_gap"
  })).toMatchObject({ ok: false, reason: "evidence_not_in_exception" });

  const resolved = resolveComponentPreviewException(dir, {
    exceptionId: packet.exception_id,
    expectedDigest: packet.exception_digest,
    disposition: "retain_open_gap",
    rationale: "Keep the provider requirement explicit until theme ownership is resolved.",
    evidenceRecordIds: ["card-1"],
    targetCategory: "open_gap"
  });
  expect(resolved).toMatchObject({
    ok: true,
    disposition: "retain_open_gap",
    next_action: "existing_rule_update_review"
  });
  const resolvedAgain = resolveComponentPreviewException(dir, {
    exceptionId: packet.exception_id,
    expectedDigest: packet.exception_digest,
    disposition: "retain_open_gap",
    rationale: "A repeated delivery must return the original resolution.",
    evidenceRecordIds: ["card-1"],
    targetCategory: "open_gap"
  });
  expect(resolvedAgain).toEqual(resolved);
  const final = new DatabaseSync(getProjectDbPath(dir));
  try {
    expect(
      final.prepare(
        `SELECT status, disposition_event_id FROM component_preview_exceptions`
      ).get()
    ).toMatchObject({ status: "resolved", disposition_event_id: expect.any(String) });
    expect(
      final.prepare(
        `SELECT COUNT(*) AS count FROM events
         WHERE type = 'component_preview_exception_resolved'`
      ).get()
    ).toEqual({ count: 1 });
    expect(
      final.prepare(
        `SELECT status FROM design_system_entries WHERE entry_id = 'component.text-link'`
      ).get()
    ).toEqual({ status: "candidate" });
  } finally {
    final.close();
  }
});

test("exception resolution fails closed when current identity or target ownership changed", () => {
  const dir = fixture({ linked: false });
  const declaration = recordArtifactWrittenCommand(dir, {
    path: "prototype/components/TextLink.tsx",
    artifactType: "code",
    semanticPurpose: "Potential semantic change",
    relatedRecordIds: ["card-1"],
    componentPreview: {
      runId: "run-1",
      surfaceId: "surface-1",
      entryId: "component.text-link",
      modulePath: "prototype/components/TextLink.tsx",
      exportName: "TextLink",
      semanticImpact: "possible"
    }
  });
  if (
    !declaration.ok || !("component_preview" in declaration) ||
    !declaration.component_preview || declaration.component_preview.automatic
  ) throw new Error(JSON.stringify(declaration));
  const packet = declaration.component_preview.exception;
  expect(resolveComponentPreviewException(dir, {
    exceptionId: packet.exception_id,
    expectedDigest: packet.exception_digest,
    disposition: "update_existing_rule",
    rationale: "The declared target must exist.",
    evidenceRecordIds: ["card-1"],
    targetEntryId: "missing.rule",
    targetCategory: "interaction"
  })).toMatchObject({ ok: false, reason: "target_entry_not_found" });
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    const value = db.prepare(
      `SELECT value_json FROM design_system_entries
       WHERE entry_id = 'component.text-link'`
    ).get() as { value_json: string };
    const changed = { ...JSON.parse(value.value_json), description: "Changed contract" };
    db.prepare(
      `UPDATE design_system_entries SET value_json = ?
       WHERE entry_id = 'component.text-link'`
    ).run(JSON.stringify(changed));
  } finally {
    db.close();
  }
  expect(resolveComponentPreviewException(dir, {
    exceptionId: packet.exception_id,
    expectedDigest: packet.exception_digest,
    disposition: "retain_open_gap",
    rationale: "Stale packets may not resolve current state.",
    evidenceRecordIds: ["card-1"],
    targetCategory: "open_gap"
  })).toMatchObject({ ok: false, reason: "exception_identity_conflict" });
});
