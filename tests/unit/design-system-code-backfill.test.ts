// Unit tests for the Prototype → Design System code backfill channel
// (Issue 31): the Agent declares entryId ↔ code-path mappings and Runtime
// writes codeLinks back into the source spec JSON (file + DB in step, with
// the formalize Phase-2 write-back pattern), fail-closed on undeclared or
// missing code files.

import {
  chmodSync,
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
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import { designSystemEntryContentDigest } from "../../lib/runtime/design-system-entry-provenance";
import { backfillComponentCodeLinks } from "../../lib/runtime/design-system-code-backfill";
import { resetRecordBusForTests } from "../../lib/runtime/record-bus";

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-code-backfill-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
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

type SpecCapture = {
  nodeName: string;
  artifactPath: string;
  capturedAt: string;
};

const CAPTURE: SpecCapture = {
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
    captures?: SpecCapture[];
  }
): { rel: string; entryId: string } {
  const entryId = opts.entryId ?? `${opts.name.toLowerCase()}-spec`;
  const rel = `design-system/components/${opts.name.toLowerCase()}.json`;
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
       VALUES (?, ?, 'component-spec', 'components.spec', ?, ?,
               ?, ?, ?, '["card-1"]', ?, 0, ?, ?)`
    ).run(
      `row-${entryId}`,
      rel,
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

/** A real code file on disk, declared through the artifact channel. */
function declareCodeFile(dir: string, rel: string): void {
  writeProjectFile(dir, rel, `export const x = 1;\n`);
  const declared = recordSourceArtifact(dir, {
    path: rel,
    artifactType: "code",
    semanticPurpose: "Prototype component source"
  });
  if (!declared.ok) throw new Error(`declare failed: ${declared.reason}`);
}

/** Answered card backing a design-system declaration's link gate. */
function insertAnsweredCard(dir: string, id: string): void {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, final_answer, answer_source,
        anchor_json, created_at, updated_at)
       VALUES (?, 'layout', 'obs', 'ques', ?,
               'agent-proposed-designer-accepted', '{}',
               '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z')`
    ).run(id, `answer-${id}`);
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

describe("backfillComponentCodeLinks", () => {
  test("writes codeLinks back to the source spec and syncs the DB row", () => {
    withTempProject((dir) => {
      const spec = seedSpecEntry(dir, {
        name: "Button",
        captures: [CAPTURE]
      });
      declareCodeFile(dir, "prototypes/components/Button.tsx");
      declareCodeFile(dir, "prototypes/components/button.styles.ts");

      const result = backfillComponentCodeLinks(dir, [
        {
          entryId: spec.entryId,
          codeLinks: [
            "prototypes/components/Button.tsx",
            "prototypes/components/button.styles.ts"
          ]
        }
      ]);
      expect(result).toMatchObject({ ok: true });

      // Source file persists the code links; the rest of the spec is intact.
      const value = readSpecValue(dir, spec.rel);
      expect(value.codeLinks).toEqual([
        "prototypes/components/Button.tsx",
        "prototypes/components/button.styles.ts"
      ]);
      expect(value.sourceCaptures).toEqual([CAPTURE]);

      // DB row stays in step: codeLinks inside value_json, captures still
      // only in the source_captures column.
      const row = specEntryRow(dir, spec.entryId);
      const dbValue = JSON.parse(row!.value_json) as Record<string, unknown>;
      expect(dbValue.codeLinks).toEqual([
        "prototypes/components/Button.tsx",
        "prototypes/components/button.styles.ts"
      ]);
      expect("sourceCaptures" in dbValue).toBe(false);
      expect(JSON.parse(row!.source_captures_json)).toEqual([CAPTURE]);

      // The backfill event records the exact mapping written.
      const events = listEvents(dir, "design_system_code_links_backfilled");
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        command: "backfill_component_code_links",
        entries: [
          {
            entry_id: spec.entryId,
            source_artifact_path: spec.rel,
            code_links: [
              "prototypes/components/Button.tsx",
              "prototypes/components/button.styles.ts"
            ]
          }
        ]
      });
    });
  });

  test("a formalized entry gets approval-grade provenance for the new content", () => {
    withTempProject((dir) => {
      const spec = seedSpecEntry(dir, { name: "Button", status: "formalized" });
      declareCodeFile(dir, "prototypes/components/Button.tsx");

      const result = backfillComponentCodeLinks(dir, [
        { entryId: spec.entryId, codeLinks: ["prototypes/components/Button.tsx"] }
      ]);
      expect(result).toMatchObject({ ok: true });

      // Without a fresh approval-grade digest the next re-ingest's status
      // gate would reject the formalized claim Runtime itself just rewrote.
      const written = JSON.parse(
        readFileSync(path.join(dir, spec.rel), "utf8")
      ) as Record<string, unknown>;
      const approved = listEvents(dir, "design_system_entry_approved");
      expect(approved).toHaveLength(1);
      expect(approved[0].payload).toMatchObject({
        source_artifact_path: spec.rel,
        entry_id: spec.entryId,
        content_digest: designSystemEntryContentDigest(written),
        via: "backfill_component_code_links"
      });
    });
  });

  test("rejects an unknown entryId without side effects", () => {
    withTempProject((dir) => {
      const spec = seedSpecEntry(dir, { name: "Button" });
      declareCodeFile(dir, "prototypes/components/Button.tsx");
      const before = readFileSync(path.join(dir, spec.rel), "utf8");

      const result = backfillComponentCodeLinks(dir, [
        { entryId: "missing-entry", codeLinks: ["prototypes/components/Button.tsx"] }
      ]);
      expect(result).toEqual({
        ok: false,
        reason: "entry_not_found",
        details: { entryId: "missing-entry" }
      });
      expect(readFileSync(path.join(dir, spec.rel), "utf8")).toBe(before);
      expect(listEvents(dir, "design_system_code_links_backfilled")).toEqual([]);
    });
  });

  test("rejects entries that are not component specs", () => {
    withTempProject((dir) => {
      writeProjectFile(dir, "design-system/layout-rules.json", {
        rules: [
          {
            id: "layout-1",
            value: "使用 12 列主栅格。",
            meaning: "主栅格",
            status: "candidate",
            links: ["card-1"]
          }
        ]
      });
      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        db.prepare(
          `INSERT INTO design_system_entries
           (id, source_artifact_path, file_kind, section, entry_id, name,
            value_json, meaning, status, links_json, position, created_at, updated_at)
           VALUES ('row-layout-1', 'design-system/layout-rules.json',
                   'layout-rules.json', 'layout', 'layout-1', NULL, '"v"',
                   '主栅格', 'candidate', '["card-1"]', 0,
                   '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z')`
        ).run();
      } finally {
        db.close();
      }
      declareCodeFile(dir, "prototypes/components/Grid.tsx");

      const result = backfillComponentCodeLinks(dir, [
        { entryId: "layout-1", codeLinks: ["prototypes/components/Grid.tsx"] }
      ]);
      expect(result).toEqual({
        ok: false,
        reason: "entry_not_component_spec",
        details: { entryId: "layout-1", file_kind: "layout-rules.json" }
      });
      expect(listEvents(dir, "design_system_code_links_backfilled")).toEqual([]);
    });
  });

  test("rejects a code path that was never declared as an artifact", () => {
    withTempProject((dir) => {
      const spec = seedSpecEntry(dir, { name: "Button" });
      // File exists on disk but no record_artifact_written declaration.
      writeProjectFile(dir, "prototypes/components/Button.tsx", "export {};\n");
      const before = readFileSync(path.join(dir, spec.rel), "utf8");

      const result = backfillComponentCodeLinks(dir, [
        { entryId: spec.entryId, codeLinks: ["prototypes/components/Button.tsx"] }
      ]);
      expect(result).toEqual({
        ok: false,
        reason: "code_path_not_declared",
        details: { path: "prototypes/components/Button.tsx" }
      });
      expect(readFileSync(path.join(dir, spec.rel), "utf8")).toBe(before);
      expect(specEntryRow(dir, spec.entryId)!.value_json).not.toContain(
        "Button.tsx"
      );
      expect(listEvents(dir, "design_system_code_links_backfilled")).toEqual([]);
    });
  });

  test("rejects a path declared as a design-system (non-code) artifact type", () => {
    withTempProject((dir) => {
      const spec = seedSpecEntry(dir, { name: "Button" });
      // Declared in the registry, but as a design-system artifact — evidence,
      // not code. The registry has no capture type; design-system types are
      // the non-code declarations that actually reach source_artifacts.
      insertAnsweredCard(dir, "card-ds");
      writeProjectFile(dir, "design-system/layout-rules.json", {
        rules: [
          {
            id: "layout-1",
            value: "使用 12 列主栅格。",
            meaning: "主栅格",
            status: "candidate",
            links: ["card-ds"]
          }
        ]
      });
      const declared = recordSourceArtifact(dir, {
        path: "design-system/layout-rules.json",
        artifactType: "layout-rules.json",
        semanticPurpose: "Layout rules",
        relatedRecordIds: ["card-ds"]
      });
      if (!declared.ok) throw new Error(`declare failed: ${declared.reason}`);
      const before = readFileSync(path.join(dir, spec.rel), "utf8");

      const result = backfillComponentCodeLinks(dir, [
        { entryId: spec.entryId, codeLinks: ["design-system/layout-rules.json"] }
      ]);
      expect(result).toEqual({
        ok: false,
        reason: "code_path_not_code_artifact",
        details: {
          path: "design-system/layout-rules.json",
          artifact_type: "layout-rules.json"
        }
      });
      expect(readFileSync(path.join(dir, spec.rel), "utf8")).toBe(before);
      expect(specEntryRow(dir, spec.entryId)!.value_json).not.toContain(
        "layout-rules"
      );
      expect(listEvents(dir, "design_system_code_links_backfilled")).toEqual([]);
    });
  });

  test("rejects a declared path whose file does not exist on disk", () => {
    withTempProject((dir) => {
      const spec = seedSpecEntry(dir, { name: "Button" });

      const result = backfillComponentCodeLinks(dir, [
        { entryId: spec.entryId, codeLinks: ["prototypes/components/Ghost.tsx"] }
      ]);
      expect(result).toEqual({
        ok: false,
        reason: "code_file_missing",
        details: { path: "prototypes/components/Ghost.tsx" }
      });
      expect(listEvents(dir, "design_system_code_links_backfilled")).toEqual([]);
    });
  });

  test("rejects an out-of-project code path", () => {
    withTempProject((dir) => {
      const spec = seedSpecEntry(dir, { name: "Button" });

      const result = backfillComponentCodeLinks(dir, [
        { entryId: spec.entryId, codeLinks: ["../outside/Button.tsx"] }
      ]);
      expect(result).toEqual({
        ok: false,
        reason: "artifact_path_escape",
        details: { path: "../outside/Button.tsx" }
      });
      expect(listEvents(dir, "design_system_code_links_backfilled")).toEqual([]);
    });
  });

  test("restores every written file and commits nothing when a later write fails", () => {
    withTempProject((dir) => {
      const first = seedSpecEntry(dir, { name: "Button" });
      const second = seedSpecEntry(dir, { name: "Card" });
      declareCodeFile(dir, "prototypes/components/Button.tsx");
      declareCodeFile(dir, "prototypes/components/Card.tsx");
      const firstBefore = readFileSync(path.join(dir, first.rel), "utf8");
      const secondBefore = readFileSync(path.join(dir, second.rel), "utf8");
      const firstRowBefore = specEntryRow(dir, first.entryId)!.value_json;
      const secondRowBefore = specEntryRow(dir, second.entryId)!.value_json;

      // The second file is read-only: phase 2 writes the first file, then
      // fails on the second — the whole backfill must roll back.
      chmodSync(path.join(dir, second.rel), 0o444);
      try {
        const result = backfillComponentCodeLinks(dir, [
          { entryId: first.entryId, codeLinks: ["prototypes/components/Button.tsx"] },
          { entryId: second.entryId, codeLinks: ["prototypes/components/Card.tsx"] }
        ]);
        expect(result).toMatchObject({ ok: false, reason: "write_failed" });
      } finally {
        chmodSync(path.join(dir, second.rel), 0o644);
      }

      expect(readFileSync(path.join(dir, first.rel), "utf8")).toBe(firstBefore);
      expect(readFileSync(path.join(dir, second.rel), "utf8")).toBe(secondBefore);
      expect(specEntryRow(dir, first.entryId)!.value_json).toBe(firstRowBefore);
      expect(specEntryRow(dir, second.entryId)!.value_json).toBe(secondRowBefore);
      expect(listEvents(dir, "design_system_code_links_backfilled")).toEqual([]);
      expect(listEvents(dir, "design_system_entry_approved")).toEqual([]);
    });
  });
});
