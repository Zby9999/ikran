// Unit tests for the code-backed capture channel (Issue 32):
// capture_component_code_hero screenshots the component's code rendering and
// writes the capture back into the spec's sourceCaptures with origin "code"
// (file + DB in step, formalize/backfill Phase-2 write-back pattern). The
// screenshot itself is injected (CodeCaptureDeps.capture) so these tests run
// without Playwright; every failure path writes nothing.

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
import { afterEach, describe, expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { getDesignSystemView } from "../../lib/runtime/design-system-view";
import { codeCaptureDigest } from "../../lib/runtime/code-capture-digest";
import {
  captureComponentCodeHero,
  type CodeCaptureDeps
} from "../../lib/runtime/design-system-code-capture";
import { resetRecordBusForTests } from "../../lib/runtime/record-bus";

const NOW_ISO = "2026-08-07T14:00:00.000Z";
const CODE_LINKS = ["prototypes/components/Button.tsx"];
const CODE_BODY = "export const Button = () => <button>OK</button>;";

/** Temp project harness; async because the capture flow awaits a screenshot. */
async function withTempProjectAsync(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-code-capture-"));
  try {
    initializeProjectDb(dir);
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  resetRecordBusForTests();
});

function writeProjectFile(dir: string, rel: string, content: unknown) {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    typeof content === "string" ? content : JSON.stringify(content)
  );
}

const SOURCE_CAPTURE = {
  nodeName: "Button / Primary",
  artifactPath: "design-system/captures/button-primary.png",
  capturedAt: "2026-08-03T12:00:00.000Z"
};

/**
 * A component-spec source file + the DB row its ingest would have produced
 * (sourceCaptures stripped from value_json into the source_captures column).
 */
function seedSpecEntry(
  dir: string,
  opts: {
    name: string;
    entryId?: string;
    status?: "candidate" | "formalized";
    codeLinks?: string[];
    captures?: Array<Record<string, unknown>>;
    fileKind?: "component-spec" | "layout-rules.json";
  }
): { rel: string; entryId: string } {
  const entryId = opts.entryId ?? `${opts.name.toLowerCase()}-spec`;
  const fileKind = opts.fileKind ?? "component-spec";
  const rel =
    fileKind === "component-spec"
      ? `design-system/components/${opts.name.toLowerCase()}.json`
      : "design-system/layout-rules.json";
  const value: Record<string, unknown> = {
    description: `${opts.name} spec.`,
    props: [],
    variants: [],
    stateMatrix: [],
    guidelines: [],
    tokenLinks: [],
    codeLinks: opts.codeLinks ?? []
  };
  if (opts.captures !== undefined) value.sourceCaptures = opts.captures;
  const section =
    fileKind === "component-spec" ? "components.spec" : "layout";
  writeProjectFile(dir, rel, {
    id: entryId,
    name: opts.name,
    meaning: `${opts.name} meaning`,
    status: opts.status ?? "candidate",
    links: ["card-1"],
    value
  });

  const { sourceCaptures: _stripped, ...dbValue } = value;
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `INSERT INTO design_system_entries
       (id, source_artifact_path, file_kind, section, entry_id, name,
        value_json, meaning, status, links_json, source_captures_json,
        position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '["card-1"]', ?, 0, ?, ?)`
    ).run(
      `row-${entryId}`,
      rel,
      fileKind,
      section,
      entryId,
      opts.name,
      JSON.stringify(dbValue),
      `${opts.name} meaning`,
      opts.status ?? "candidate",
      JSON.stringify(opts.captures ?? []),
      "2026-08-06T00:00:00.000Z",
      "2026-08-06T00:00:00.000Z"
    );
  } finally {
    db.close();
  }
  return { rel, entryId };
}

function specEntryRow(dir: string, entryId: string) {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    return db
      .prepare(
        `SELECT value_json, source_captures_json, status
         FROM design_system_entries WHERE entry_id = ?`
      )
      .get(entryId) as
      | { value_json: string; source_captures_json: string; status: string }
      | undefined;
  } finally {
    db.close();
  }
}

/** Seed the prototype run + surface a code capture links to, so the view's
 * live-surface decoration (Issue 33) has a row to join. */
function seedPrototypeSurface(
  dir: string,
  opts: {
    surfaceId: string;
    readiness?: "installing" | "starting" | "ready" | "failed";
    stale?: boolean;
    previewUrl?: string;
  }
): void {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    const now = "2026-08-07T00:00:00.000Z";
    db.prepare(
      `INSERT INTO prototype_runs
       (id, run_id, source_artifact_path, prototype_root, dev_command,
        seed_reference_ids_json, evidence_version_ids_json,
        design_system_version, created_at, updated_at,
        kind, intent, used_candidate_ids_json)
       VALUES (?, ?, 'prototype/app.tsx', '', 'npm run dev', '[]', '[]',
               'ds-v1', ?, ?, 'seed_reconstruction', NULL, '[]')`
    ).run(`run-${opts.surfaceId}`, `run-${opts.surfaceId}`, now, now);
    db.prepare(
      `INSERT INTO prototype_surfaces
       (id, prototype_run_id, surface_key, name, preview_url, preview_port,
        readiness, readiness_reason, stale, stale_reason,
        created_at, updated_at)
       VALUES (?, ?, 'page', 'Page', ?, 4401, ?, NULL, ?, NULL, ?, ?)`
    ).run(
      opts.surfaceId,
      `run-${opts.surfaceId}`,
      opts.previewUrl ?? "http://127.0.0.1:4401",
      opts.readiness ?? "ready",
      opts.stale === true ? 1 : 0,
      now,
      now
    );
  } finally {
    db.close();
  }
}

function readSpecValue(dir: string, rel: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path.join(dir, rel), "utf8")) as {
    value: Record<string, unknown>;
  };
  return parsed.value;
}

function deps(
  overrides: Partial<CodeCaptureDeps> = {}
): CodeCaptureDeps {
  return {
    capture: async () => ({
      ok: true,
      artifactPath: "design-system/captures/code-capture-button.png"
    }),
    now: () => NOW_ISO,
    ...overrides
  };
}

describe("captureComponentCodeHero", () => {
  test("writes a code-backed capture back to the spec and the DB row", async () => {
    await withTempProjectAsync(async (dir) => {
      writeProjectFile(dir, CODE_LINKS[0], CODE_BODY);
      const spec = seedSpecEntry(dir, {
        name: "Button",
        codeLinks: CODE_LINKS,
        captures: [SOURCE_CAPTURE]
      });

      const result = await captureComponentCodeHero(
        dir,
        { entryId: spec.entryId, surfaceId: "proto-surface-1" },
        deps()
      );
      expect(result).toMatchObject({
        ok: true,
        entry_id: spec.entryId,
        source_artifact_path: spec.rel,
        artifact_path: "design-system/captures/code-capture-button.png",
        surface_id: "proto-surface-1",
        code_links: CODE_LINKS
      });
      if (!result.ok) return;
      expect(result.code_digest).toBe(codeCaptureDigest(dir, CODE_LINKS));

      // Source file: the code capture joins the kept source capture.
      const captures = readSpecValue(dir, spec.rel)
        .sourceCaptures as Array<Record<string, unknown>>;
      expect(captures).toHaveLength(2);
      expect(captures[0]).toEqual(SOURCE_CAPTURE);
      expect(captures[1]).toEqual({
        nodeName: "Button",
        artifactPath: "design-system/captures/code-capture-button.png",
        capturedAt: NOW_ISO,
        surfaceId: "proto-surface-1",
        origin: "code",
        codeLinks: CODE_LINKS,
        codeDigest: result.code_digest
      });

      // DB row stays in step: captures only in the source_captures column.
      const row = specEntryRow(dir, spec.entryId);
      const dbValue = JSON.parse(row!.value_json) as Record<string, unknown>;
      expect("sourceCaptures" in dbValue).toBe(false);
      expect(JSON.parse(row!.source_captures_json)).toEqual(captures);

      // The view reads the code capture as fresh code-backed provenance.
      const view = getDesignSystemView(dir);
      expect(view.ok).toBe(true);
      if (view.ok) {
        const viewCaptures = view.view.components.specs[0]!.captures!;
        expect(viewCaptures.map((capture) => capture.origin)).toEqual([
          "source",
          "code"
        ]);
        expect(viewCaptures.map((capture) => capture.stale)).toEqual([
          false,
          false
        ]);
      }

      // The capture event records exactly what was frozen.
      const events = listEvents(dir, "design_system_code_capture_recorded");
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({
        command: "capture_component_code_hero",
        entry_id: spec.entryId,
        source_artifact_path: spec.rel,
        artifact_path: "design-system/captures/code-capture-button.png",
        surface_id: "proto-surface-1",
        code_links: CODE_LINKS,
        code_digest: result.code_digest
      });
      expect(result.event_id).toBe(events[0]!.event_id);
    });
  });

  test("re-capturing replaces the previous code capture, keeps source captures", async () => {
    await withTempProjectAsync(async (dir) => {
      writeProjectFile(dir, CODE_LINKS[0], CODE_BODY);
      const oldCodeCapture = {
        nodeName: "Button",
        artifactPath: "design-system/captures/code-old.png",
        capturedAt: "2026-08-05T12:00:00.000Z",
        surfaceId: "proto-surface-0",
        origin: "code",
        codeLinks: CODE_LINKS,
        codeDigest: "stale-digest"
      };
      const spec = seedSpecEntry(dir, {
        name: "Button",
        codeLinks: CODE_LINKS,
        captures: [SOURCE_CAPTURE, oldCodeCapture]
      });

      const result = await captureComponentCodeHero(
        dir,
        { entryId: spec.entryId, surfaceId: "proto-surface-1" },
        deps()
      );
      expect(result.ok).toBe(true);

      const captures = readSpecValue(dir, spec.rel)
        .sourceCaptures as Array<Record<string, unknown>>;
      expect(captures).toHaveLength(2);
      expect(captures[0]).toEqual(SOURCE_CAPTURE);
      expect(captures[1]!.origin).toBe("code");
      expect(captures[1]!.artifactPath).toBe(
        "design-system/captures/code-capture-button.png"
      );
    });
  });

  test("a formalized entry gets approval-grade provenance for the new content", async () => {
    await withTempProjectAsync(async (dir) => {
      writeProjectFile(dir, CODE_LINKS[0], CODE_BODY);
      const spec = seedSpecEntry(dir, {
        name: "Button",
        status: "formalized",
        codeLinks: CODE_LINKS
      });

      const result = await captureComponentCodeHero(
        dir,
        { entryId: spec.entryId, surfaceId: "proto-surface-1" },
        deps()
      );
      expect(result.ok).toBe(true);

      const approved = listEvents(dir, "design_system_entry_approved");
      expect(approved).toHaveLength(1);
      expect(approved[0]!.payload).toMatchObject({
        source_artifact_path: spec.rel,
        entry_id: spec.entryId,
        from: "formalized",
        to: "formalized",
        via: "capture_component_code_hero"
      });
    });
  });

  test("unknown entry and non-spec entries are rejected before any write", async () => {
    await withTempProjectAsync(async (dir) => {
      writeProjectFile(dir, CODE_LINKS[0], CODE_BODY);
      seedSpecEntry(dir, {
        name: "Grid",
        entryId: "grid-page",
        fileKind: "layout-rules.json"
      });

      const missing = await captureComponentCodeHero(
        dir,
        { entryId: "no-such-entry", surfaceId: "proto-surface-1" },
        deps()
      );
      expect(missing).toMatchObject({ ok: false, reason: "entry_not_found" });

      const layout = await captureComponentCodeHero(
        dir,
        { entryId: "grid-page", surfaceId: "proto-surface-1" },
        deps()
      );
      expect(layout).toMatchObject({
        ok: false,
        reason: "entry_not_component_spec"
      });
      expect(listEvents(dir, "design_system_code_capture_recorded")).toEqual(
        []
      );
    });
  });

  test("an entry without codeLinks cannot claim a code-backed capture", async () => {
    await withTempProjectAsync(async (dir) => {
      const spec = seedSpecEntry(dir, { name: "Button" });

      const result = await captureComponentCodeHero(
        dir,
        { entryId: spec.entryId, surfaceId: "proto-surface-1" },
        deps()
      );
      expect(result).toMatchObject({ ok: false, reason: "no_code_links" });
      expect(listEvents(dir, "design_system_code_capture_recorded")).toEqual(
        []
      );
    });
  });

  test("a missing code file is fail-closed before any write", async () => {
    await withTempProjectAsync(async (dir) => {
      const spec = seedSpecEntry(dir, {
        name: "Button",
        codeLinks: CODE_LINKS
      });

      const result = await captureComponentCodeHero(
        dir,
        { entryId: spec.entryId, surfaceId: "proto-surface-1" },
        deps()
      );
      expect(result).toMatchObject({ ok: false, reason: "code_file_missing" });
      expect(listEvents(dir, "design_system_code_capture_recorded")).toEqual(
        []
      );
    });
  });

  test("a failed render writes nothing — the entry keeps its captures", async () => {
    await withTempProjectAsync(async (dir) => {
      writeProjectFile(dir, CODE_LINKS[0], CODE_BODY);
      const spec = seedSpecEntry(dir, {
        name: "Button",
        codeLinks: CODE_LINKS,
        captures: [SOURCE_CAPTURE]
      });
      const fileBefore = readFileSync(path.join(dir, spec.rel), "utf8");

      const result = await captureComponentCodeHero(
        dir,
        { entryId: spec.entryId, surfaceId: "proto-surface-1" },
        deps({
          capture: async () => ({ ok: false, reason: "capture_failed" })
        })
      );
      expect(result).toMatchObject({ ok: false, reason: "capture_failed" });

      // Honest fallback: source file, DB row and event log all untouched.
      expect(readFileSync(path.join(dir, spec.rel), "utf8")).toBe(fileBefore);
      const row = specEntryRow(dir, spec.entryId);
      expect(JSON.parse(row!.source_captures_json)).toEqual([SOURCE_CAPTURE]);
      expect(listEvents(dir, "design_system_code_capture_recorded")).toEqual(
        []
      );
    });
  });

  test("a declared harnessPath rides the capture record into file, DB, event and view (Issue 33)", async () => {
    await withTempProjectAsync(async (dir) => {
      writeProjectFile(dir, CODE_LINKS[0], CODE_BODY);
      const spec = seedSpecEntry(dir, {
        name: "Button",
        codeLinks: CODE_LINKS,
        captures: [SOURCE_CAPTURE]
      });

      const result = await captureComponentCodeHero(
        dir,
        {
          entryId: spec.entryId,
          surfaceId: "proto-surface-1",
          harnessPath: "/__ikran/component/button"
        },
        deps()
      );
      expect(result).toMatchObject({
        ok: true,
        harness_path: "/__ikran/component/button"
      });

      // Source file + DB row carry the declaration on the code capture only.
      const captures = readSpecValue(dir, spec.rel)
        .sourceCaptures as Array<Record<string, unknown>>;
      expect(captures).toHaveLength(2);
      expect(captures[0]).toEqual(SOURCE_CAPTURE);
      expect(captures[1]).toMatchObject({
        origin: "code",
        harnessPath: "/__ikran/component/button"
      });
      const row = specEntryRow(dir, spec.entryId);
      expect(JSON.parse(row!.source_captures_json)).toEqual(captures);

      // The event records the declaration alongside what was frozen.
      const events = listEvents(dir, "design_system_code_capture_recorded");
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({
        harness_path: "/__ikran/component/button"
      });

      // The view exposes the declaration; without a surface row the live
      // decoration degrades to nulls (hero falls back to the static tier).
      const view = getDesignSystemView(dir);
      expect(view.ok).toBe(true);
      if (view.ok) {
        const codeCapture = view.view.components.specs[0]!.captures!.find(
          (capture) => capture.origin === "code"
        )!;
        expect(codeCapture.harnessPath).toBe("/__ikran/component/button");
        expect(codeCapture.previewUrl).toBeNull();
        expect(codeCapture.surfaceReadiness).toBeNull();
        expect(codeCapture.surfaceStale).toBe(false);
        const sourceCapture = view.view.components.specs[0]!.captures!.find(
          (capture) => capture.origin === "source"
        )!;
        expect(sourceCapture.harnessPath).toBeNull();
      }
    });
  });

  test("omitting harnessPath keeps the record exactly the Issue-32 shape", async () => {
    await withTempProjectAsync(async (dir) => {
      writeProjectFile(dir, CODE_LINKS[0], CODE_BODY);
      const spec = seedSpecEntry(dir, {
        name: "Button",
        codeLinks: CODE_LINKS
      });

      const result = await captureComponentCodeHero(
        dir,
        { entryId: spec.entryId, surfaceId: "proto-surface-1" },
        deps()
      );
      expect(result).toMatchObject({ ok: true, harness_path: null });

      const captures = readSpecValue(dir, spec.rel)
        .sourceCaptures as Array<Record<string, unknown>>;
      expect(captures).toHaveLength(1);
      expect("harnessPath" in captures[0]!).toBe(false);
      const events = listEvents(dir, "design_system_code_capture_recorded");
      expect("harness_path" in events[0]!.payload).toBe(false);
    });
  });

  test("an invalid harnessPath is rejected before any write", async () => {
    await withTempProjectAsync(async (dir) => {
      writeProjectFile(dir, CODE_LINKS[0], CODE_BODY);
      const spec = seedSpecEntry(dir, {
        name: "Button",
        codeLinks: CODE_LINKS,
        captures: [SOURCE_CAPTURE]
      });
      const fileBefore = readFileSync(path.join(dir, spec.rel), "utf8");

      for (const bad of [
        "components/button",
        "https://evil.com/x",
        "//evil.com/x",
        "/../secret",
        "/x?state=hover",
        ""
      ]) {
        const result = await captureComponentCodeHero(
          dir,
          { entryId: spec.entryId, surfaceId: "proto-surface-1", harnessPath: bad },
          deps()
        );
        expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
      }
      // Nothing was written by any of the rejected attempts.
      expect(readFileSync(path.join(dir, spec.rel), "utf8")).toBe(fileBefore);
      const row = specEntryRow(dir, spec.entryId);
      expect(JSON.parse(row!.source_captures_json)).toEqual([SOURCE_CAPTURE]);
      expect(listEvents(dir, "design_system_code_capture_recorded")).toEqual(
        []
      );
    });
  });

  test("the view decorates the linked prototype surface onto a code capture (Issue 33)", async () => {
    await withTempProjectAsync(async (dir) => {
      writeProjectFile(dir, CODE_LINKS[0], CODE_BODY);
      seedPrototypeSurface(dir, {
        surfaceId: "proto-surface-1",
        readiness: "ready",
        stale: false,
        previewUrl: "http://127.0.0.1:4401"
      });
      const spec = seedSpecEntry(dir, {
        name: "Button",
        codeLinks: CODE_LINKS
      });

      const result = await captureComponentCodeHero(
        dir,
        {
          entryId: spec.entryId,
          surfaceId: "proto-surface-1",
          harnessPath: "/__ikran/component/button"
        },
        deps()
      );
      expect(result.ok).toBe(true);

      const view = getDesignSystemView(dir);
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      const codeCapture = view.view.components.specs[0]!.captures![0]!;
      expect(codeCapture.previewUrl).toBe("http://127.0.0.1:4401");
      expect(codeCapture.surfaceReadiness).toBe("ready");
      expect(codeCapture.surfaceStale).toBe(false);
    });
  });

  test("a stale or not-ready surface decorates as not live (Issue 33)", async () => {
    await withTempProjectAsync(async (dir) => {
      writeProjectFile(dir, CODE_LINKS[0], CODE_BODY);
      seedPrototypeSurface(dir, {
        surfaceId: "proto-surface-1",
        readiness: "starting",
        stale: false
      });
      seedPrototypeSurface(dir, {
        surfaceId: "proto-surface-2",
        readiness: "ready",
        stale: true
      });
      const spec = seedSpecEntry(dir, {
        name: "Button",
        codeLinks: CODE_LINKS,
        captures: [
          {
            nodeName: "Button",
            artifactPath: "design-system/captures/code-starting.png",
            capturedAt: "2026-08-06T12:00:00.000Z",
            surfaceId: "proto-surface-1",
            origin: "code",
            codeLinks: CODE_LINKS,
            codeDigest: codeCaptureDigest(dir, CODE_LINKS),
            harnessPath: "/__ikran/component/button"
          },
          {
            nodeName: "Button",
            artifactPath: "design-system/captures/code-stale.png",
            capturedAt: "2026-08-06T12:01:00.000Z",
            surfaceId: "proto-surface-2",
            origin: "code",
            codeLinks: CODE_LINKS,
            codeDigest: codeCaptureDigest(dir, CODE_LINKS),
            harnessPath: "/__ikran/component/button"
          }
        ]
      });
      void spec;

      const view = getDesignSystemView(dir);
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      const captures = view.view.components.specs[0]!.captures!;
      expect(captures.map((capture) => capture.surfaceReadiness)).toEqual([
        "starting",
        "ready"
      ]);
      expect(captures.map((capture) => capture.surfaceStale)).toEqual([
        false,
        true
      ]);
    });
  });
});
