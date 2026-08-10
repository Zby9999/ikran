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
import { approveDesignSystemEntryCommand } from "../../lib/runtime/commands/design-system";
import {
  captureDesignSystemSourceDigestSnapshot,
  verifyDesignSystemSourceDigestSnapshot
} from "../../lib/runtime/design-system-sync";
import { logEventOnDb } from "../../lib/runtime/events";
import { designSystemEntryContentDigest } from "../../lib/runtime/design-system-entry-provenance";
import {
  confirmRuleUpdate,
  proposeRuleUpdate
} from "../../lib/runtime/rule-update-proposal";
import { getDesignSystemView } from "../../lib/runtime/design-system-view";
import { initializeProjectDb } from "../../lib/runtime/db";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import {
  resetRecordBusForTests,
  subscribeRecordEvents,
  type RecordBusEvent
} from "../../lib/runtime/record-bus";

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

function setProjectPhase(dir: string, phase: string): void {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `UPDATE project_phase SET phase = ?, updated_at = ? WHERE singleton = 1`
    ).run(phase, "2026-08-10T00:00:00.000Z");
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
  return { seedId: seed.record.id, surfaceId: pkg.record.id };
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

const BASE_DESIGN_SYSTEM_LINKS: readonly string[] = [
  "card-accepted-1",
  "card-accepted-2",
  "card-accepted-3",
  "annotation-confirmed"
];

function designSystemJsonFixture() {
  return {
    name: "Protected DS",
    visualLanguage: {
      id: "visualLanguage.monochromeStudio",
      value: { description: "Monochrome editorial clarity." },
      meaning: "Fixed vector signatures and image-led color.",
      status: "candidate",
      links: [...BASE_DESIGN_SYSTEM_LINKS]
    },
    principles: [
      {
        id: "principle.minimalRestraint",
        value: "Project imagery supplies the color.",
        meaning: "The interface stays monochrome.",
        status: "candidate",
        links: [...BASE_DESIGN_SYSTEM_LINKS]
      }
    ]
  };
}

function seedProtectedDesignSystem(dir: string): {
  sourcePath: string;
  editEventIds: [string, string];
} {
  const evidence = seedEvidence(dir);
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    const insertCard = db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, final_answer, answer_source,
        anchor_json, created_at, updated_at)
       VALUES (?, 'foundations', 'obs', 'ques', 'accepted',
               'agent-proposed-designer-accepted', '{}',
               '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`
    );
    for (const cardId of BASE_DESIGN_SYSTEM_LINKS.slice(0, 3)) {
      insertCard.run(cardId);
    }
    db.prepare(
      `INSERT INTO agent_alignment_annotations
       (id, inference, body, anchor_json, created_at, updated_at)
       VALUES ('annotation-confirmed', 'confirmed', 'confirmed evidence', ?,
               '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`
    ).run(
      JSON.stringify({
        kind: "single",
        target: {
          kind: "surface",
          seedReferenceId: evidence.seedId,
          evidenceSurfaceId: evidence.surfaceId,
          evidenceVersionId: evidence.surfaceId
        }
      })
    );
  } finally {
    db.close();
  }

  const sourcePath = "design-system/design-system.json";
  writeProjectFile(dir, sourcePath, designSystemJsonFixture());
  const declared = recordSourceArtifact(dir, {
    path: sourcePath,
    artifactType: "design-system.json",
    semanticPurpose: "protected metadata reconciliation fixture",
    relatedRecordIds: [...BASE_DESIGN_SYSTEM_LINKS]
  });
  expect(declared.ok).toBe(true);

  const eventDb = new DatabaseSync(getProjectDbPath(dir));
  let editEventIds: [string, string];
  try {
    const first = logEventOnDb(eventDb, "design_system_entry_edited", {
      source_artifact_path: sourcePath,
      entry_id: "visualLanguage.monochromeStudio",
      field: "value.description",
      before: "Monochrome editorial clarity",
      after: "Monochrome editorial clarity.",
      from_status: "candidate",
      to_status: "candidate"
    });
    const second = logEventOnDb(eventDb, "design_system_entry_edited", {
      source_artifact_path: sourcePath,
      entry_id: "visualLanguage.monochromeStudio",
      field: "meaning",
      before: "Fixed vector signatures.",
      after: "Fixed vector signatures and image-led color.",
      from_status: "candidate",
      to_status: "candidate"
    });
    editEventIds = [first.event_id, second.event_id];
  } finally {
    eventDb.close();
  }

  // The real project has two older Browser edit events, followed by the
  // exact-content Formalized decision. A later stale source copy retained
  // those edit ids even though the DB provenance envelope did not.
  for (const entryId of [
    "visualLanguage.monochromeStudio",
    "principle.minimalRestraint"
  ]) {
    const approved = approveDesignSystemEntry(dir, {
      sourceArtifactPath: sourcePath,
      entryId,
      targetStatus: "formalized"
    });
    expect(approved.ok).toBe(true);
  }

  const source = JSON.parse(
    readFileSync(path.join(dir, sourcePath), "utf8")
  ) as ReturnType<typeof designSystemJsonFixture>;
  source.visualLanguage.links.push(...editEventIds);
  // A stale source status must not silently demote the designer-approved DB
  // row when the project is already Rule Update protected.
  source.principles[0].status = "candidate";
  writeProjectFile(dir, sourcePath, source);
  setProjectPhase(dir, "ready_for_new_design");
  return { sourcePath, editEventIds };
}

describe("design-system-sync (lazy file→DB re-ingest)", () => {
  test("a digest snapshot detects later source changes and accepts promotion overrides", () => {
    withTempProject((dir) => {
      seedDeclare(dir, "#3b82f6");
      const relativePath = "design-system/token.json";
      const originalDigest = sha256OfFile(dir, relativePath);

      const snapshot = captureDesignSystemSourceDigestSnapshot(dir);
      expect(snapshot).toEqual({
        sources: [{ path: relativePath, digest: originalDigest }]
      });
      expect(verifyDesignSystemSourceDigestSnapshot(dir, snapshot)).toEqual({
        ok: true,
        issues: []
      });

      // formalize writes promoted bytes after capture; without an override
      // those bytes are drift, while the exact promoted digest is accepted.
      writeProjectFile(dir, relativePath, tokenJson("#ff0000"));
      const promotedDigest = sha256OfFile(dir, relativePath);
      expect(verifyDesignSystemSourceDigestSnapshot(dir, snapshot)).toEqual({
        ok: false,
        issues: [
          {
            path: relativePath,
            reason: "source_content_changed",
            expectedDigest: originalDigest,
            actualDigest: promotedDigest
          }
        ]
      });
      expect(
        verifyDesignSystemSourceDigestSnapshot(dir, snapshot, {
          [relativePath]: promotedDigest
        })
      ).toEqual({ ok: true, issues: [] });

      rmSync(path.join(dir, relativePath));
      expect(
        verifyDesignSystemSourceDigestSnapshot(dir, snapshot, {
          [relativePath]: promotedDigest
        })
      ).toEqual({
        ok: false,
        issues: [{ path: relativePath, reason: "source_file_missing" }]
      });
    });
  });

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

  test("undeclared Design System edits are not absorbed after Prototype confirmation", () => {
    withTempProject((dir) => {
      seedDeclare(dir, "#3b82f6");
      setProjectPhase(dir, "design_system_formal");

      // This models an Agent editing what it believes should become a rule
      // without first going through the formal Rule Update review.
      writeProjectFile(dir, "design-system/token.json", tokenJson("#ff0000"));

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
          reason: "rule_update_proposal_required"
        })
      ]);
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

  test("protected metadata drift auto-reconciles without losing edit provenance, then the first status click succeeds", () => {
    withTempProject((dir) => {
      const { sourcePath, editEventIds } = seedProtectedDesignSystem(dir);

      const beforeRead = JSON.parse(
        readFileSync(path.join(dir, sourcePath), "utf8")
      ) as ReturnType<typeof designSystemJsonFixture>;
      expect(beforeRead.visualLanguage.links).toEqual([
        ...BASE_DESIGN_SYSTEM_LINKS,
        ...editEventIds
      ]);
      expect(beforeRead.principles[0].status).toBe("candidate");
      const beforeDb = new DatabaseSync(getProjectDbPath(dir));
      try {
        expect(
          beforeDb
            .prepare(
              `SELECT status, links_json FROM design_system_entries
               WHERE source_artifact_path = ? AND entry_id = ?`
            )
            .get(sourcePath, "visualLanguage.monochromeStudio")
        ).toEqual({
          status: "formalized",
          links_json: JSON.stringify(BASE_DESIGN_SYSTEM_LINKS)
        });
        expect(
          beforeDb
            .prepare(
              `SELECT status FROM design_system_entries
               WHERE source_artifact_path = ? AND entry_id = ?`
            )
            .get(sourcePath, "principle.minimalRestraint")
        ).toEqual({ status: "formalized" });
      } finally {
        beforeDb.close();
      }
      expect(artifactDigest(dir, sourcePath)).not.toBe(
        sha256OfFile(dir, sourcePath)
      );

      const firstRead = getDesignSystemView(dir);
      expect(firstRead.ok).toBe(true);
      if (!firstRead.ok) return;
      expect(firstRead.view.sync_warnings).toBeUndefined();

      const afterRead = JSON.parse(
        readFileSync(path.join(dir, sourcePath), "utf8")
      ) as ReturnType<typeof designSystemJsonFixture>;
      expect(afterRead.visualLanguage.links).toEqual([
        ...BASE_DESIGN_SYSTEM_LINKS,
        ...editEventIds
      ]);
      expect(afterRead.principles[0].status).toBe("formalized");

      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        const rows = db
          .prepare(
            `SELECT entry_id, status, links_json
             FROM design_system_entries
             WHERE source_artifact_path = ?
             ORDER BY entry_id`
          )
          .all(sourcePath) as Array<{
          entry_id: string;
          status: string;
          links_json: string;
        }>;
        expect(rows).toEqual([
          {
            entry_id: "principle.minimalRestraint",
            status: "formalized",
            links_json: JSON.stringify(BASE_DESIGN_SYSTEM_LINKS)
          },
          {
            entry_id: "visualLanguage.monochromeStudio",
            status: "formalized",
            links_json: JSON.stringify([
              ...BASE_DESIGN_SYSTEM_LINKS,
              ...editEventIds
            ])
          }
        ]);
        const reconciliationEvents = db
          .prepare(
            `SELECT payload FROM events
             WHERE type = 'design_system_source_metadata_reconciled'
             ORDER BY id`
          )
          .all() as Array<{ payload: string }>;
        expect(reconciliationEvents).toHaveLength(1);
        const reconciliation = JSON.parse(
          reconciliationEvents[0].payload
        ) as { entries: Array<Record<string, unknown>> };
        expect(reconciliation.entries).toEqual([
          expect.objectContaining({
            entry_id: "principle.minimalRestraint",
            source_status: "candidate",
            db_status: "formalized",
            source_links: [...BASE_DESIGN_SYSTEM_LINKS],
            db_links: [...BASE_DESIGN_SYSTEM_LINKS],
            resolved_links: [...BASE_DESIGN_SYSTEM_LINKS],
            resolved_content_digest: designSystemEntryContentDigest(
              afterRead.principles[0]
            )
          }),
          expect.objectContaining({
            entry_id: "visualLanguage.monochromeStudio",
            source_status: "formalized",
            db_status: "formalized",
            source_links: [
              ...BASE_DESIGN_SYSTEM_LINKS,
              ...editEventIds
            ],
            db_links: [...BASE_DESIGN_SYSTEM_LINKS],
            resolved_links: [
              ...BASE_DESIGN_SYSTEM_LINKS,
              ...editEventIds
            ],
            resolved_content_digest: designSystemEntryContentDigest(
              afterRead.visualLanguage
            )
          })
        ]);
      } finally {
        db.close();
      }
      expect(artifactDigest(dir, sourcePath)).toBe(
        sha256OfFile(dir, sourcePath)
      );

      // Force the full status gate once: the audited reconciliation event
      // carries the prior Formalized decision to the provenance-enriched
      // exact digest, so this is durable rather than a digest-ledger bypass.
      setProjectPhase(dir, "draft_design_system");
      const redeclared = recordSourceArtifact(dir, {
        path: sourcePath,
        artifactType: "design-system.json",
        semanticPurpose: "status revalidation after metadata reconciliation",
        relatedRecordIds: [...BASE_DESIGN_SYSTEM_LINKS]
      });
      expect(redeclared.ok).toBe(true);
      setProjectPhase(dir, "ready_for_new_design");

      // Exercise the POST preflight too: if metadata drifts again after the
      // authoritative GET, the fixed target click repairs once and still
      // records exactly one designer status decision.
      const driftedBeforeClick = JSON.parse(
        readFileSync(path.join(dir, sourcePath), "utf8")
      ) as ReturnType<typeof designSystemJsonFixture>;
      driftedBeforeClick.visualLanguage.links = [
        ...BASE_DESIGN_SYSTEM_LINKS,
        editEventIds[0]
      ];
      writeProjectFile(dir, sourcePath, driftedBeforeClick);
      expect(artifactDigest(dir, sourcePath)).not.toBe(
        sha256OfFile(dir, sourcePath)
      );

      const busEvents: RecordBusEvent[] = [];
      const unsubscribe = subscribeRecordEvents((event) =>
        busEvents.push(event)
      );
      const clicked = approveDesignSystemEntryCommand(dir, {
        sourceArtifactPath: sourcePath,
        entryId: "visualLanguage.monochromeStudio",
        targetStatus: "candidate"
      });
      unsubscribe();
      expect(clicked).toMatchObject({
        ok: true,
        entry: {
          entry_id: "visualLanguage.monochromeStudio",
          status: "candidate"
        }
      });
      expect(busEvents).toEqual([
        expect.objectContaining({
          kind: "design-system",
          action: "updated",
          id: sourcePath
        })
      ]);

      const converged = getDesignSystemView(dir);
      expect(converged.ok).toBe(true);
      if (!converged.ok) return;
      expect(converged.view.sync_warnings).toBeUndefined();
      expect(
        converged.view.foundations.visualLanguage?.status
      ).toBe("candidate");
      expect(
        converged.view.foundations.principles.find(
          (entry) => entry.entry_id === "principle.minimalRestraint"
        )?.status
      ).toBe("formalized");

      const finalSource = JSON.parse(
        readFileSync(path.join(dir, sourcePath), "utf8")
      ) as ReturnType<typeof designSystemJsonFixture>;
      expect(finalSource.visualLanguage).toMatchObject({
        status: "candidate",
        links: [...BASE_DESIGN_SYSTEM_LINKS, ...editEventIds]
      });
      const finalDb = new DatabaseSync(getProjectDbPath(dir));
      try {
        expect(
          finalDb
            .prepare(
              `SELECT status, links_json FROM design_system_entries
               WHERE source_artifact_path = ? AND entry_id = ?`
            )
            .get(sourcePath, "visualLanguage.monochromeStudio")
        ).toEqual({
          status: "candidate",
          links_json: JSON.stringify([
            ...BASE_DESIGN_SYSTEM_LINKS,
            ...editEventIds
          ])
        });
        expect(
          finalDb
            .prepare(
              "SELECT COUNT(*) AS count FROM events WHERE type = 'design_system_source_metadata_reconciled'"
            )
            .get()
        ).toEqual({ count: 2 });
        const revertedEvents = finalDb
          .prepare(
            `SELECT payload FROM events
             WHERE type = 'design_system_entry_reverted'
             ORDER BY id`
          )
          .all() as Array<{ payload: string }>;
        expect(revertedEvents).toHaveLength(1);
        expect(JSON.parse(revertedEvents[0].payload)).toMatchObject({
          source_artifact_path: sourcePath,
          entry_id: "visualLanguage.monochromeStudio",
          from: "formalized",
          to: "candidate"
        });
      } finally {
        finalDb.close();
      }
      expect(artifactDigest(dir, sourcePath)).toBe(
        sha256OfFile(dir, sourcePath)
      );
    });
  });

  test("draft lazy sync retries a rejected approval digest when only edit provenance drifted", () => {
    withTempProject((dir) => {
      const { sourcePath, editEventIds } = seedProtectedDesignSystem(dir);
      const source = JSON.parse(
        readFileSync(path.join(dir, sourcePath), "utf8")
      ) as ReturnType<typeof designSystemJsonFixture>;
      // Draft status authoring remains source-led. Remove the protected-only
      // stale status from this fixture so the retry is strictly link metadata.
      source.principles[0].status = "formalized";
      writeProjectFile(dir, sourcePath, source);
      setProjectPhase(dir, "draft_design_system");

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.view.sync_warnings).toBeUndefined();

      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        expect(
          db
            .prepare(
              `SELECT status, links_json FROM design_system_entries
               WHERE source_artifact_path = ? AND entry_id = ?`
            )
            .get(sourcePath, "visualLanguage.monochromeStudio")
        ).toEqual({
          status: "formalized",
          links_json: JSON.stringify([
            ...BASE_DESIGN_SYSTEM_LINKS,
            ...editEventIds
          ])
        });
      } finally {
        db.close();
      }

      const clicked = approveDesignSystemEntryCommand(dir, {
        sourceArtifactPath: sourcePath,
        entryId: "visualLanguage.monochromeStudio",
        targetStatus: "candidate"
      });
      expect(clicked).toMatchObject({
        ok: true,
        entry: { status: "candidate" }
      });
    });
  });

  test("an unconsumed confirmed proposal from an older Rule Update cycle does not block metadata convergence", () => {
    withTempProject((dir) => {
      const { sourcePath } = seedProtectedDesignSystem(dir);
      const oldProposal = proposeRuleUpdate(dir, {
        kind: "update",
        classification: "proposed_update",
        title: "Older source update",
        changeDescription: "A proposal from the prior Rule Update cycle.",
        reason: "Regression fixture for cycle-scoped write windows.",
        affectedItems: ["Visual language"],
        evidenceRecordIds: [BASE_DESIGN_SYSTEM_LINKS[0]],
        sourceArtifactPath: sourcePath
      });
      expect(oldProposal.ok).toBe(true);
      if (!oldProposal.ok) return;
      expect(
        confirmRuleUpdate(dir, {
          proposalId: oldProposal.proposal.proposal_id
        }).ok
      ).toBe(true);

      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        logEventOnDb(db, "design_system_formalized", {
          from_phase: "design_system_formal",
          phase: "ready_for_new_design",
          command: "formalize_design_system"
        });
      } finally {
        db.close();
      }

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.view.sync_warnings).toBeUndefined();
    });
  });

  test("a proposal without the current Prototype review cannot hold metadata convergence open", () => {
    withTempProject((dir) => {
      const { sourcePath } = seedProtectedDesignSystem(dir);
      setProjectPhase(dir, "design_system_formal");

      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        logEventOnDb(db, "project_phase_confirmed", {
          from_phase: "prototype_validation",
          phase: "design_system_formal",
          command: "confirm_prototype"
        });
        logEventOnDb(db, "conversation_reconciliation_completed", {
          reconciliation_id: "mismatched-review"
        });
        logEventOnDb(db, "consolidate_review_started", {
          reconciliation_id: "mismatched-review",
          prototype_confirmation_event_id: "another-prototype-confirmation"
        });
      } finally {
        db.close();
      }

      const proposal = proposeRuleUpdate(dir, {
        kind: "update",
        classification: "proposed_update",
        title: "Unreviewed source update",
        changeDescription: "A proposal whose review is bound to another Prototype confirmation.",
        reason: "Regression fixture for the exact current-cycle authorization boundary.",
        affectedItems: ["Visual language"],
        evidenceRecordIds: [BASE_DESIGN_SYSTEM_LINKS[0]],
        sourceArtifactPath: sourcePath
      });
      expect(proposal.ok).toBe(true);
      if (!proposal.ok) return;
      expect(
        confirmRuleUpdate(dir, { proposalId: proposal.proposal.proposal_id }).ok
      ).toBe(true);

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.view.sync_warnings).toBeUndefined();
    });
  });

  test("protected approval rejects source-only entry fields hidden from the Workbench", () => {
    withTempProject((dir) => {
      const { sourcePath } = seedProtectedDesignSystem(dir);
      const source = JSON.parse(
        readFileSync(path.join(dir, sourcePath), "utf8")
      ) as ReturnType<typeof designSystemJsonFixture> & {
        visualLanguage: { hiddenBody?: string };
      };
      source.visualLanguage.hiddenBody =
        "Undeclared source-only content the designer never reviewed";
      writeProjectFile(dir, sourcePath, source);
      const bytesBefore = readFileSync(path.join(dir, sourcePath), "utf8");

      const clicked = approveDesignSystemEntryCommand(dir, {
        sourceArtifactPath: sourcePath,
        entryId: "visualLanguage.monochromeStudio",
        targetStatus: "candidate"
      });
      expect(clicked).toMatchObject({
        ok: false,
        reason: "source_db_drift"
      });
      expect(readFileSync(path.join(dir, sourcePath), "utf8")).toBe(
        bytesBefore
      );

      const eventDb = new DatabaseSync(getProjectDbPath(dir));
      try {
        expect(
          eventDb
            .prepare(
              "SELECT COUNT(*) AS count FROM events WHERE type = 'design_system_entry_reverted'"
            )
            .get()
        ).toEqual({ count: 0 });
      } finally {
        eventDb.close();
      }
    });
  });

  test("protected metadata reconciliation fails closed when the same file has semantic drift", () => {
    withTempProject((dir) => {
      const { sourcePath } = seedProtectedDesignSystem(dir);
      const source = JSON.parse(
        readFileSync(path.join(dir, sourcePath), "utf8")
      ) as ReturnType<typeof designSystemJsonFixture>;
      source.principles[0].meaning = "An undeclared semantic rewrite.";
      writeProjectFile(dir, sourcePath, source);
      const bytesBefore = readFileSync(path.join(dir, sourcePath), "utf8");

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.view.sync_warnings).toEqual([
        expect.objectContaining({
          path: sourcePath,
          reason: "rule_update_proposal_required"
        })
      ]);
      expect(readFileSync(path.join(dir, sourcePath), "utf8")).toBe(
        bytesBefore
      );

      const clicked = approveDesignSystemEntryCommand(dir, {
        sourceArtifactPath: sourcePath,
        entryId: "visualLanguage.monochromeStudio",
        targetStatus: "candidate"
      });
      expect(clicked).toMatchObject({
        ok: false,
        reason: "source_db_drift"
      });
      expect(readFileSync(path.join(dir, sourcePath), "utf8")).toBe(
        bytesBefore
      );

      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        expect(
          db
            .prepare(
              `SELECT meaning, status FROM design_system_entries
               WHERE source_artifact_path = ? AND entry_id = ?`
            )
            .get(sourcePath, "principle.minimalRestraint")
        ).toEqual({
          meaning: "The interface stays monochrome.",
          status: "formalized"
        });
        expect(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM events WHERE type = 'design_system_source_metadata_reconciled'"
            )
            .get()
        ).toEqual({ count: 0 });
        expect(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM events WHERE type = 'design_system_entry_reverted'"
            )
            .get()
        ).toEqual({ count: 0 });
      } finally {
        db.close();
      }
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
