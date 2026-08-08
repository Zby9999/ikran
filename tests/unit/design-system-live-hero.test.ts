import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { declareComponentLiveHeroes } from "../../lib/runtime/design-system-live-hero";
import { getDesignSystemView } from "../../lib/runtime/design-system-view";
import { listEvents } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { resetRecordBusForTests } from "../../lib/runtime/record-bus";

const SOURCE_CAPTURE = {
  nodeName: "Button / source",
  artifactPath: "design-system/captures/button-source.png",
  capturedAt: "2026-08-01T00:00:00.000Z"
};

function withProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-live-hero-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeProjectFile(dir: string, relative: string, content: string) {
  const absolute = path.join(dir, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function seed(dir: string, stale = false) {
  const specPath = "design-system/components/button.json";
  const codePath = "prototype/components/Button.tsx";
  const harnessArtifactPath =
    "prototype/app/__ikran/component/button/page.tsx";
  const value = {
    description: "Button",
    props: [],
    variants: [],
    stateMatrix: [{ state: "hover" }],
    guidelines: [],
    tokenLinks: [],
    codeLinks: [codePath],
    sourceCaptures: [SOURCE_CAPTURE]
  };
  writeProjectFile(dir, codePath, "export const Button = () => <button />;");
  writeProjectFile(dir, harnessArtifactPath, "export default function Page() { return null; }");
  writeProjectFile(
    dir,
    specPath,
    `${JSON.stringify({
      id: "component.button",
      name: "Button",
      meaning: "Button",
      status: "formalized",
      links: ["card-1"],
      value
    })}\n`
  );

  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    const now = "2026-08-08T00:00:00.000Z";
    db.prepare(
      `INSERT INTO design_system_entries
       (id, source_artifact_path, file_kind, section, entry_id, name,
        value_json, meaning, status, links_json, source_captures_json,
        position, created_at, updated_at)
       VALUES ('row-button', ?, 'component-spec', 'components.spec',
               'component.button', 'Button', ?, 'Button', 'formalized',
               '["card-1"]', ?, 0, ?, ?)`
    ).run(
      specPath,
      JSON.stringify({ ...value, sourceCaptures: undefined }),
      JSON.stringify([SOURCE_CAPTURE]),
      now,
      now
    );
    const artifact = db.prepare(
      `INSERT INTO source_artifacts
       (id, path, artifact_type, semantic_purpose, related_record_ids_json,
        readiness, declaration_version, status, created_at, updated_at)
       VALUES (?, ?, ?, 'fixture', '[]', 'ready', 1, 'ingested', ?, ?)`
    );
    artifact.run("artifact-code", codePath, "code", now, now);
    artifact.run("artifact-harness", harnessArtifactPath, "prototype", now, now);
    db.prepare(
      `INSERT INTO prototype_runs
       (id, run_id, source_artifact_path, prototype_root, dev_command,
        seed_reference_ids_json, evidence_version_ids_json,
        design_system_version, created_at, updated_at,
        kind, intent, used_candidate_ids_json)
       VALUES ('run-row', 'run-1', ?, 'prototype', 'npm run dev', '[]', '[]',
               'ds-v1', ?, ?, 'seed_reconstruction', NULL, '[]')`
    ).run(codePath, now, now);
    db.prepare(
      `INSERT INTO prototype_surfaces
       (id, prototype_run_id, surface_key, name, preview_url, preview_port,
        readiness, readiness_reason, stale, stale_reason, created_at, updated_at)
       VALUES ('surface-1', 'run-row', 'landing', 'Landing',
               'http://127.0.0.1:4300', 4300, 'ready', NULL, ?, ?, ?, ?)`
    ).run(stale ? 1 : 0, stale ? "code_changed" : null, now, now);
  } finally {
    db.close();
  }
  return { specPath, harnessArtifactPath };
}

afterEach(() => resetRecordBusForTests());

test("declares a batch live iframe hero without generating a code screenshot", () => {
  withProject((dir) => {
    const { specPath, harnessArtifactPath } = seed(dir);
    const result = declareComponentLiveHeroes(dir, [
      {
        entryId: "component.button",
        surfaceId: "surface-1",
        harnessPath: "/__ikran/component/button",
        harnessArtifactPath
      }
    ]);

    expect(result).toMatchObject({
      ok: true,
      entries: [
        {
          entry_id: "component.button",
          surface_id: "surface-1",
          harness_path: "/__ikran/component/button"
        }
      ]
    });
    const spec = JSON.parse(readFileSync(path.join(dir, specPath), "utf8"));
    expect(spec.value.liveHero).toEqual({
      surfaceId: "surface-1",
      harnessPath: "/__ikran/component/button",
      harnessArtifactPath
    });
    expect(spec.value.sourceCaptures).toEqual([SOURCE_CAPTURE]);
    const db = new DatabaseSync(getProjectDbPath(dir));
    try {
      const row = db.prepare(
        `SELECT value_json, source_captures_json
         FROM design_system_entries WHERE id = 'row-button'`
      ).get() as { value_json: string; source_captures_json: string };
      expect(JSON.parse(row.value_json)).toMatchObject({
        liveHero: {
          surfaceId: "surface-1",
          harnessPath: "/__ikran/component/button",
          harnessArtifactPath
        }
      });
      expect(JSON.parse(row.source_captures_json)).toEqual([SOURCE_CAPTURE]);
    } finally {
      db.close();
    }
    const viewResult = getDesignSystemView(dir);
    expect(viewResult.ok).toBe(true);
    if (!viewResult.ok) throw new Error(viewResult.reason);
    const entry = viewResult.view.components.specs.find(
      (candidate) => candidate.entry_id === "component.button"
    );
    expect(entry?.captures).toHaveLength(1);
    expect(entry?.liveHero).toMatchObject({
      surfaceId: "surface-1",
      harnessPath: "/__ikran/component/button",
      harnessArtifactPath,
      previewUrl: "http://127.0.0.1:4300",
      surfaceReadiness: "ready",
      surfaceStale: false
    });
    expect(listEvents(dir, "design_system_live_heroes_declared")).toHaveLength(1);
    expect(listEvents(dir, "design_system_code_capture_recorded")).toEqual([]);
  });
});

test("requires record_preview after harness code made the surface stale", () => {
  withProject((dir) => {
    const { harnessArtifactPath } = seed(dir, true);
    expect(
      declareComponentLiveHeroes(dir, [
        {
          entryId: "component.button",
          surfaceId: "surface-1",
          harnessPath: "/__ikran/component/button",
          harnessArtifactPath
        }
      ])
    ).toMatchObject({ ok: false, reason: "preview_unavailable" });
  });
});
