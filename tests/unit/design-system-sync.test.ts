// Unit tests for the lazy file→DB sync (design-system-sync) and the
// single-storage capture column. The source JSON files are the authoring
// layer; syncDesignSystemSources (run inside getDesignSystemView) re-ingests
// declared artifacts whose bytes changed without a re-declaration, downgrades
// invalid files to warnings, and never breaks the view.

import { createHash } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";

import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import { approveDesignSystemEntry } from "../../lib/runtime/design-system-approval";
import { getDesignSystemView } from "../../lib/runtime/design-system-view";
import { initializeProjectDb } from "../../lib/runtime/db";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { resetRecordBusForTests } from "../../lib/runtime/record-bus";

const VALID_FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-ds-sync-"));
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

function sha256OfFile(dir: string, rel: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(dir, rel), "utf-8"))
    .digest("hex");
}

function artifactDigest(dir: string, rel: string): string | null {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    const row = db
      .prepare("SELECT content_digest FROM source_artifacts WHERE path = ?")
      .get(rel) as { content_digest: string | null } | undefined;
    return row?.content_digest ?? null;
  } finally {
    db.close();
  }
}

function entryRow(
  dir: string,
  sourcePath: string,
  entryId: string
): { value_json: string; updated_at: string } | undefined {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    return db
      .prepare(
        `SELECT value_json, updated_at FROM design_system_entries
         WHERE source_artifact_path = ? AND entry_id = ?`
      )
      .get(sourcePath, entryId) as
      | { value_json: string; updated_at: string }
      | undefined;
  } finally {
    db.close();
  }
}

function seedEvidence(dir: string) {
  const seed = registerSeedReference(dir, {
    figmaSeedReference: VALID_FIGMA,
    originalDesignIntent: "sync fixture"
  });
  if (!seed.ok) throw new Error(`seed failed: ${seed.reason}`);
  const pkg = recordEvidencePackage(dir, {
    figmaSeedReference: VALID_FIGMA,
    frame: { nodeId: "1:2", name: "Checkout" },
    evidenceViews: { rawData: "available", screenshot: "missing" }
  });
  if (!pkg.ok) throw new Error(`evidence failed: ${pkg.reason}`);
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, final_answer, answer_source,
        anchor_json, created_at, updated_at)
       VALUES ('card-edited', 'token', 'obs', 'ques', '设计师答案',
               'designer-edited', '{}',
               '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z')`
    ).run();
  } finally {
    db.close();
  }
}

function tokenJson(hex: string) {
  return {
    primitive: {
      "color.blue.500": {
        kind: "token",
        domain: "color",
        value: hex,
        status: "formalized",
        links: ["card-edited"]
      }
    },
    semantic: {
      "color.primary": {
        kind: "token",
        domain: "color",
        value: { alias: "primitive.color.blue.500", usage: "语义主色" },
        status: "candidate",
        links: ["card-edited"]
      }
    },
    component: {}
  };
}

function declareTokenJson(dir: string) {
  const res = recordSourceArtifact(dir, {
    path: "design-system/token.json",
    artifactType: "token.json",
    semanticPurpose: "sync fixture",
    relatedRecordIds: ["card-edited"]
  });
  expect(res.ok).toBe(true);
}

function seedDeclare(dir: string, hex = "#3b82f6") {
  seedEvidence(dir);
  writeProjectFile(dir, "design-system/token.json", tokenJson(hex));
  declareTokenJson(dir);
}

describe("design-system-sync (lazy file→DB re-ingest)", () => {
  test("declaration records the source content digest", () => {
    withTempProject((dir) => {
      seedDeclare(dir);
      expect(artifactDigest(dir, "design-system/token.json")).toBe(
        sha256OfFile(dir, "design-system/token.json")
      );
    });
  });

  test("undeclared source edits are re-ingested before the view is served", () => {
    withTempProject((dir) => {
      seedDeclare(dir, "#3b82f6");
      // Agent edits the file with host-native editing and forgets to declare.
      writeProjectFile(dir, "design-system/token.json", tokenJson("#ff0000"));

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const primitive = result.view.tokens.primitive.find(
        (entry) => entry.entry_id === "primitive.color.blue.500"
      );
      expect(primitive?.value).toBe("#ff0000");
      expect(result.view.sync_warnings).toBeUndefined();
      // The digest now matches the new bytes, so a second read does not
      // re-ingest again.
      expect(artifactDigest(dir, "design-system/token.json")).toBe(
        sha256OfFile(dir, "design-system/token.json")
      );
      const before = entryRow(
        dir,
        "design-system/token.json",
        "primitive.color.blue.500"
      );
      const second = getDesignSystemView(dir);
      expect(second.ok).toBe(true);
      const after = entryRow(
        dir,
        "design-system/token.json",
        "primitive.color.blue.500"
      );
      expect(after?.updated_at).toBe(before?.updated_at);
    });
  });

  test("a lazy re-ingest regenerates the derived export", () => {
    withTempProject((dir) => {
      seedDeclare(dir, "#3b82f6");
      writeProjectFile(dir, "design-system/token.json", tokenJson("#ff0000"));

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);

      const exportPath = path.join(
        dir,
        ".ikran",
        "artifacts",
        "design-system-view.json"
      );
      const exported = JSON.parse(readFileSync(exportPath, "utf-8")) as {
        tokens: { primitive: Array<{ entry_id: string; value: unknown }> };
      };
      const primitive = exported.tokens.primitive.find(
        (entry) => entry.entry_id === "primitive.color.blue.500"
      );
      expect(primitive?.value).toBe("#ff0000");
      // Transient sync state never leaks into the deterministic export.
      expect("sync_warnings" in exported).toBe(false);
    });
  });

  test("an invalid edited file downgrades to a warning and last-good rows", () => {
    withTempProject((dir) => {
      seedDeclare(dir, "#3b82f6");
      writeProjectFile(dir, "design-system/token.json", "{ not json");

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const primitive = result.view.tokens.primitive.find(
        (entry) => entry.entry_id === "primitive.color.blue.500"
      );
      expect(primitive?.value).toBe("#3b82f6");
      expect(result.view.sync_warnings).toEqual([
        expect.objectContaining({
          path: "design-system/token.json",
          reason: "invalid_json"
        })
      ]);
    });
  });

  test("a schema-invalid edited file warns instead of failing the view", () => {
    withTempProject((dir) => {
      seedDeclare(dir, "#3b82f6");
      // Structurally valid JSON but not a valid token.json.
      writeProjectFile(dir, "design-system/token.json", { wrong: true });

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.view.sync_warnings).toEqual([
        expect.objectContaining({
          path: "design-system/token.json",
          reason: "schema_validation_failed"
        })
      ]);
      expect(result.view.tokens.primitive.length).toBe(1);
    });
  });

  test("a missing source file warns and keeps last-good rows", () => {
    withTempProject((dir) => {
      seedDeclare(dir, "#3b82f6");
      rmSync(path.join(dir, "design-system/token.json"));

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.view.sync_warnings).toEqual([
        expect.objectContaining({
          path: "design-system/token.json",
          reason: "source_file_missing"
        })
      ]);
      expect(result.view.tokens.primitive.length).toBe(1);
    });
  });

  test("undeclared files on disk are never auto-ingested", () => {
    withTempProject((dir) => {
      seedDeclare(dir);
      writeProjectFile(dir, "design-system/interaction-rules.json", {
        rules: [
          {
            id: "r1",
            value: "Undeclared rule.",
            meaning: "undeclared",
            status: "candidate",
            links: ["card-edited"]
          }
        ]
      });

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.view.interaction.length).toBe(0);
      expect(result.view.sync_warnings).toBeUndefined();
    });
  });

  test("designer approval keeps the digest in step (no spurious re-ingest)", () => {
    withTempProject((dir) => {
      seedDeclare(dir);
      const approved = approveDesignSystemEntry(dir, {
        sourceArtifactPath: "design-system/token.json",
        entryId: "semantic.color.primary",
        targetStatus: "formalized"
      });
      expect(approved.ok).toBe(true);
      expect(artifactDigest(dir, "design-system/token.json")).toBe(
        sha256OfFile(dir, "design-system/token.json")
      );

      const before = entryRow(
        dir,
        "design-system/token.json",
        "semantic.color.primary"
      );
      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      const after = entryRow(
        dir,
        "design-system/token.json",
        "semantic.color.primary"
      );
      expect(after?.updated_at).toBe(before?.updated_at);
    });
  });

  test("a NULL-digest row whose file still matches the DB skips the ingest gate", () => {
    withTempProject((dir) => {
      seedDeclare(dir);
      // Production legacy state: the card predates the designer-edited gate,
      // so a full re-ingest would reject the formalized entry — but the file
      // is unchanged and matches the DB rows, so sync must not re-ingest at
      // all. (This is the ikran test 7 recurring-warning scenario.)
      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        db.prepare(
          `UPDATE alignment_question_cards
           SET answer_source = 'agent-proposed-designer-accepted'
           WHERE id = 'card-edited'`
        ).run();
        db.prepare(
          `UPDATE source_artifacts SET content_digest = NULL
           WHERE path = 'design-system/token.json'`
        ).run();
      } finally {
        db.close();
      }

      const before = entryRow(
        dir,
        "design-system/token.json",
        "primitive.color.blue.500"
      );
      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Content-match fast path: no gate rejection, no warning, and the
      // missing digest is backfilled so the next read skips the file.
      expect(result.view.sync_warnings).toBeUndefined();
      expect(artifactDigest(dir, "design-system/token.json")).toBe(
        sha256OfFile(dir, "design-system/token.json")
      );
      const after = entryRow(
        dir,
        "design-system/token.json",
        "primitive.color.blue.500"
      );
      expect(after?.updated_at).toBe(before?.updated_at);
    });
  });

  test("a NULL-digest row with changed bytes still goes through full ingest", () => {
    withTempProject((dir) => {
      seedDeclare(dir, "#3b82f6");
      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        db.prepare(
          `UPDATE source_artifacts SET content_digest = NULL
           WHERE path = 'design-system/token.json'`
        ).run();
      } finally {
        db.close();
      }
      writeProjectFile(dir, "design-system/token.json", tokenJson("#ff0000"));

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const primitive = result.view.tokens.primitive.find(
        (entry) => entry.entry_id === "primitive.color.blue.500"
      );
      expect(primitive?.value).toBe("#ff0000");
      expect(result.view.sync_warnings).toBeUndefined();
      expect(artifactDigest(dir, "design-system/token.json")).toBe(
        sha256OfFile(dir, "design-system/token.json")
      );
    });
  });
});

describe("capture single storage (value_json stripped)", () => {
  test("spec value_json omits sourceCaptures while the view projects captures", () => {
    withTempProject((dir) => {
      seedEvidence(dir);
      // The declaration gate requires the declared capture file to exist.
      writeProjectFile(dir, ".ikran/artifacts/button.png", "png");
      writeProjectFile(dir, "design-system/components/button.json", {
        id: "button",
        name: "Button",
        value: {
          description: "主按钮",
          props: [{ name: "label", type: "string" }],
          variants: [{ axis: "style", name: "primary" }],
          stateMatrix: [{ state: "default" }],
          guidelines: [{ kind: "do", text: "使用语义色" }],
          tokenLinks: [],
          codeLinks: [],
          sourceCaptures: [
            {
              nodeName: "Button / Primary",
              artifactPath: ".ikran/artifacts/button.png",
              capturedAt: "2026-07-29T00:00:00.000Z"
            }
          ]
        },
        status: "candidate",
        links: ["card-edited"]
      });
      const declared = recordSourceArtifact(dir, {
        path: "design-system/components/button.json",
        artifactType: "component-spec",
        semanticPurpose: "capture strip fixture",
        relatedRecordIds: ["card-edited"]
      });
      expect(declared.ok).toBe(true);

      const row = entryRow(dir, "design-system/components/button.json", "button");
      expect(row).toBeDefined();
      const storedValue = JSON.parse(row!.value_json) as Record<string, unknown>;
      expect("sourceCaptures" in storedValue).toBe(false);

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const spec = result.view.components.specs.find(
        (entry) => entry.entry_id === "button"
      );
      expect(spec?.captures?.length).toBe(1);
      expect(spec?.captures?.[0].nodeName).toBe("Button / Primary");
    });
  });
});
