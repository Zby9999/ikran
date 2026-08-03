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
import { expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { proposeRuleUpdate } from "../../lib/runtime/rule-update-proposal";

test("rule-update proposal records an awaiting-confirmation event without moving sources", () => {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-rule-proposal-"));
  try {
    initializeProjectDb(projectPath);
    const sourceRelative = "design-system/layout-rules.json";
    const targetRelative = "design-system/components/sticky-navigation.json";
    const sourcePath = path.join(projectPath, sourceRelative);
    const targetPath = path.join(projectPath, targetRelative);
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(
      sourcePath,
      JSON.stringify({
        rules: [
          {
            id: "layout.stickyTopBar",
            value: "Keep the sticky navigation visible while scrolling.",
            meaning: "Sticky navigation",
            status: "candidate",
            links: []
          }
        ]
      }),
      "utf8"
    );
    writeFileSync(targetPath, JSON.stringify({ rules: [] }), "utf8");
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      db.prepare(
        `INSERT INTO alignment_question_cards
         (id, section, observation, question, final_answer, answer_source,
          anchor_json, created_at, updated_at)
         VALUES ('capture-1', 'layout', 'Observed', 'Move?', 'Yes',
                 'designer-edited', '{}', ?, ?)`
      ).run(
        "2026-08-03T00:00:00.000Z",
        "2026-08-03T00:00:00.000Z"
      );
      db.prepare(
        `INSERT INTO design_system_entries
         (id, source_artifact_path, file_kind, section, entry_id, name,
          value_json, meaning, status, links_json, position, created_at, updated_at)
         VALUES (?, ?, 'layout-rules.json', 'layout', ?, ?, ?, ?,
                 'candidate', '[]', 0, ?, ?)`
      ).run(
        "layout-rules.json::layout.stickyTopBar",
        sourceRelative,
        "layout.stickyTopBar",
        "layout.stickyTopBar",
        JSON.stringify("Keep the sticky navigation visible while scrolling."),
        "Sticky navigation",
        "2026-08-03T00:00:00.000Z",
        "2026-08-03T00:00:00.000Z"
      );
    } finally {
      db.close();
    }
    const sourceBefore = readFileSync(sourcePath, "utf8");
    const targetBefore = readFileSync(targetPath, "utf8");

    const result = proposeRuleUpdate(projectPath, {
      sourceArtifactPath: sourceRelative,
      entryId: "layout.stickyTopBar",
      proposedTargetPath: targetRelative,
      reason: "This behavior belongs to the sticky navigation component.",
      affectedItems: ["Sticky navigation"],
      evidenceRecordIds: ["capture-1"]
    });

    expect(result).toMatchObject({
      ok: true,
      proposal: {
        source_artifact_path: sourceRelative,
        entry_id: "layout.stickyTopBar",
        proposed_target_path: targetRelative,
        status: "awaiting_confirmation"
      }
    });
    expect(readFileSync(sourcePath, "utf8")).toBe(sourceBefore);
    expect(readFileSync(targetPath, "utf8")).toBe(targetBefore);
    expect(listEvents(projectPath, "rule_update_proposal_created")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          entry_id: "layout.stickyTopBar",
          status: "awaiting_confirmation"
        })
      })
    ]);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test("rule-update proposal rejects forged evidence ids", () => {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-rule-proposal-"));
  try {
    initializeProjectDb(projectPath);
    mkdirSync(path.join(projectPath, "design-system", "components"), {
      recursive: true
    });
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      db.prepare(
        `INSERT INTO design_system_entries
         (id, source_artifact_path, file_kind, section, entry_id, name,
          value_json, meaning, status, links_json, position, created_at, updated_at)
         VALUES ('rule', 'design-system/layout-rules.json', 'layout-rules.json',
                 'layout', 'layout.rule', 'layout.rule', '"Rule"', 'Rule',
                 'candidate', '[]', 0, ?, ?)`
      ).run(
        "2026-08-03T00:00:00.000Z",
        "2026-08-03T00:00:00.000Z"
      );
    } finally {
      db.close();
    }
    expect(
      proposeRuleUpdate(projectPath, {
        sourceArtifactPath: "design-system/layout-rules.json",
        entryId: "layout.rule",
        proposedTargetPath: "design-system/components/card.json",
        reason: "Move it.",
        affectedItems: ["Card"],
        evidenceRecordIds: ["forged-evidence"]
      })
    ).toEqual({ ok: false, reason: "evidence_record_not_found" });
    expect(listEvents(projectPath, "rule_update_proposal_created")).toEqual([]);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});
