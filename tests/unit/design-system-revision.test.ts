import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import {
  getDesignSystemRevisionHistory,
  getEffectiveDesignSystem,
  reviseDraftDesignSystem
} from "../../lib/runtime/design-system-revision";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";

function withFixture(run: (projectPath: string) => void): void {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-ds-revision-"));
  try {
    initializeProjectDb(projectPath);
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      db.prepare(
        `INSERT INTO alignment_question_cards
         (id, section, observation, question, final_answer, answer_source,
          anchor_json, created_at, updated_at)
         VALUES ('designer-card', 'token', 'Observed', 'Keep?', 'Yes',
                 'designer-edited', '{}', ?, ?)`
      ).run("2026-08-30T00:00:00.000Z", "2026-08-30T00:00:00.000Z");
      db.prepare(
        `UPDATE project_phase
         SET phase = 'draft_design_system', updated_at = ?
         WHERE singleton = 1`
      ).run("2026-08-30T00:00:00.000Z");
    } finally {
      db.close();
    }
    const artifactPath = path.join(projectPath, "design-system/token.json");
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, JSON.stringify({
      primitive: {
        "color.ink": {
          kind: "token",
          domain: "color",
          value: "#111111",
          status: "candidate",
          links: ["designer-card"]
        }
      },
      semantic: {},
      component: {}
    }), "utf8");
    const declared = recordSourceArtifact(projectPath, {
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "revision test fixture",
      relatedRecordIds: ["designer-card"]
    });
    if (!declared.ok) throw new Error(JSON.stringify(declared));
    run(projectPath);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

test("Draft Design System supplementation creates and activates one immutable revision", () => {
  withFixture((projectPath) => {
    const initial = getEffectiveDesignSystem(projectPath);
    if (!initial.ok) throw new Error(JSON.stringify(initial));
    expect(initial.revision).toMatchObject({ sequence: 1, status: "draft" });
    expect(initial.historyIncluded).toBe(false);

    const revisionInput = {
      baseRevisionId: initial.revision.id,
      idempotencyKey: "add-body-type-role",
      summary: "Add the omitted body typography role",
      additions: [{
        kind: "token" as const,
        layer: "semantic" as const,
        name: "typography.body",
        domain: "typography" as const,
        value: {
          fontFamily: "Inter",
          fontSize: 16,
          lineHeight: 1.5,
          usedFor: "Long-form paragraph and supporting body copy"
        },
        sourceRefs: ["designer-card"]
      }]
    };
    const revised = reviseDraftDesignSystem(projectPath, revisionInput);
    if (!revised.ok) throw new Error(JSON.stringify(revised));
    expect(revised).toMatchObject({
      activeRevisionId: revised.revision.id,
      previousRevisionId: initial.revision.id,
      additionsApplied: 1,
      projectPhase: "draft_design_system",
      revision: { sequence: 2, parentRevisionId: initial.revision.id }
    });

    const effective = getEffectiveDesignSystem(projectPath);
    if (!effective.ok) throw new Error(JSON.stringify(effective));
    expect(effective.revision.id).toBe(revised.revision.id);
    expect(effective.historyIncluded).toBe(false);
    expect(effective.designSystem.entries.some(
      (entry) => entry.entry_id === "semantic.typography.body"
    )).toBe(true);

    const history = getDesignSystemRevisionHistory(projectPath);
    expect(history.activeRevisionId).toBe(revised.revision.id);
    expect(history.revisions.map((revision) => revision.sequence)).toEqual([2, 1]);

    const source = JSON.parse(readFileSync(
      path.join(projectPath, "design-system/token.json"), "utf8"
    ));
    expect(source.semantic["typography.body"].links).toEqual(["designer-card"]);

    expect(reviseDraftDesignSystem(projectPath, revisionInput)).toMatchObject({
      ok: true,
      reused: true,
      activeRevisionId: revised.revision.id
    });
  });
});

test("a stale Draft revision cannot overwrite the active revision", () => {
  withFixture((projectPath) => {
    const initial = getEffectiveDesignSystem(projectPath);
    if (!initial.ok) throw new Error(JSON.stringify(initial));
    const first = reviseDraftDesignSystem(projectPath, {
      baseRevisionId: initial.revision.id,
      idempotencyKey: "first-addition",
      summary: "Add spacing role",
      additions: [{
        kind: "token",
        layer: "semantic",
        name: "spacing.section",
        domain: "spacing",
        value: "48px",
        sourceRefs: ["designer-card"]
      }]
    });
    if (!first.ok) throw new Error(JSON.stringify(first));

    expect(reviseDraftDesignSystem(projectPath, {
      baseRevisionId: initial.revision.id,
      idempotencyKey: "stale-addition",
      summary: "Stale write",
      additions: [{
        kind: "token",
        layer: "semantic",
        name: "spacing.card",
        domain: "spacing",
        value: "24px",
        sourceRefs: ["designer-card"]
      }]
    })).toMatchObject({
      ok: false,
      reason: "stale_revision",
      activeRevisionId: first.revision.id
    });
  });
});
