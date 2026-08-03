import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";

import { editDesignSystemEntry } from "../../lib/runtime/design-system-edit";
import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import {
  resetRecordBusForTests,
  subscribeRecordEvents,
  type RecordBusEvent
} from "../../lib/runtime/record-bus";
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import { getDesignSystemView } from "../../lib/runtime/design-system-view";
import {
  editDesignSystemEntryCommand,
  editDesignSystemEntryInputSchema,
  parseCommandInput
} from "../../lib/runtime/commands";

function withTempProject(run: (projectPath: string) => void): void {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-ds-edit-"));
  try {
    initializeProjectDb(projectPath);
    run(projectPath);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

function writeJson(projectPath: string, relativePath: string, value: unknown) {
  const absolutePath = path.join(projectPath, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, JSON.stringify(value), "utf8");
}

function ingestGapRule(projectPath: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, final_answer, answer_source,
        anchor_json, created_at, updated_at)
       VALUES (?, 'interaction', 'Observed', 'Keep?', 'Yes',
               'designer-edited', '{}', ?, ?)`
    ).run(
      "designer-card",
      "2026-08-03T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z"
    );
  } finally {
    db.close();
  }
  writeJson(projectPath, "design-system/interaction-rules.json", {
    rules: [
      {
        id: "interaction.transition",
        value: { statement: "Transitions stay quiet." },
        meaning: "Quiet transitions",
        status: "gap",
        links: []
      },
      {
        id: "interaction.focus",
        value: { statement: "Focus remains visible." },
        meaning: "Visible focus",
        status: "candidate",
        links: ["designer-card"]
      },
      {
        id: "interaction.feedback",
        value: { statement: "Feedback is immediate." },
        meaning: "Immediate feedback",
        status: "formalized",
        links: ["designer-card"]
      }
    ]
  });
  const declared = recordSourceArtifact(projectPath, {
    path: "design-system/interaction-rules.json",
    artifactType: "interaction-rules.json",
    semanticPurpose: "edit command fixture",
    relatedRecordIds: ["designer-card"]
  });
  if (!declared.ok) throw new Error(JSON.stringify(declared));
}

afterEach(() => resetRecordBusForTests());

test("edit-entry transport accepts only the declared command envelope", () => {
  expect(
    parseCommandInput(editDesignSystemEntryInputSchema, {
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.transition",
      field: "meaning",
      text: "Calm transitions"
    })
  ).toMatchObject({ ok: true });
  expect(
    parseCommandInput(editDesignSystemEntryInputSchema, {
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.transition",
      field: "status",
      text: "formalized"
    })
  ).toEqual({ ok: false, reason: "invalid_params" });
});

test("designer fills a gap rule title through the Runtime write path", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    const busEvents: RecordBusEvent[] = [];
    const unsubscribe = subscribeRecordEvents((event) => busEvents.push(event));

    const result = editDesignSystemEntryCommand(projectPath, {
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.transition",
      field: "meaning",
      text: "Calm transitions"
    });
    unsubscribe();

    if (!result.ok) throw new Error(JSON.stringify(result));
    const source = JSON.parse(
      readFileSync(
        path.join(projectPath, "design-system/interaction-rules.json"),
        "utf8"
      )
    );
    expect(source.rules[0]).toMatchObject({
      meaning: "Calm transitions",
      status: "candidate"
    });

    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      expect(
        db
          .prepare(
            `SELECT meaning, status FROM design_system_entries
             WHERE source_artifact_path = ? AND entry_id = ?`
          )
          .get(
            "design-system/interaction-rules.json",
            "interaction.transition"
          )
      ).toEqual({ meaning: "Calm transitions", status: "candidate" });
    } finally {
      db.close();
    }

    expect(listEvents(projectPath, "design_system_entry_edited")).toHaveLength(1);
    expect(listEvents(projectPath, "design_system_entry_edited")[0].payload).toMatchObject({
      source_artifact_path: "design-system/interaction-rules.json",
      entry_id: "interaction.transition",
      field: "meaning",
      before: "Quiet transitions",
      after: "Calm transitions",
      from_status: "gap",
      to_status: "candidate"
    });
    expect(busEvents).toEqual([
      expect.objectContaining({
        kind: "design-system",
        action: "updated",
        id: "design-system/interaction-rules.json",
        projectPath: path.resolve(projectPath)
      })
    ]);
  });
});

test("designer title edits preserve candidate and formalized status", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    for (const edit of [
      {
        entryId: "interaction.focus",
        text: "Persistent focus",
        status: "candidate"
      },
      {
        entryId: "interaction.feedback",
        text: "Instant feedback",
        status: "formalized"
      }
    ] as const) {
      const result = editDesignSystemEntryCommand(projectPath, {
        sourceArtifactPath: "design-system/interaction-rules.json",
        entryId: edit.entryId,
        field: "meaning",
        text: edit.text
      });
      expect(result).toMatchObject({ ok: true, entry: { status: edit.status } });
    }

    const source = JSON.parse(
      readFileSync(
        path.join(projectPath, "design-system/interaction-rules.json"),
        "utf8"
      )
    );
    expect(source.rules[1]).toMatchObject({
      meaning: "Persistent focus",
      status: "candidate"
    });
    expect(source.rules[2]).toMatchObject({
      meaning: "Instant feedback",
      status: "formalized"
    });
    expect(source.rules[1].links.at(-1)).toBe(
      listEvents(projectPath, "design_system_entry_edited")[0].event_id
    );
    expect(source.rules[2].links.at(-1)).toBe(
      listEvents(projectPath, "design_system_entry_edited")[1].event_id
    );
    const view = getDesignSystemView(projectPath);
    if (!view.ok) throw new Error(view.reason);
    expect(
      view.view.interaction.find(
        (entry) => entry.entry_id === "interaction.focus"
      )?.evidence.edit_history
    ).toEqual([
      expect.objectContaining({
        field: "meaning",
        before: "Visible focus",
        after: "Persistent focus"
      })
    ]);
  });
});

test("edit command rejects invalid inputs without changing source or DB", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    const sourcePath = path.join(
      projectPath,
      "design-system/interaction-rules.json"
    );
    const original = readFileSync(sourcePath, "utf8");

    for (const [input, reason] of [
      [
        {
          sourceArtifactPath: "../outside.json",
          entryId: "interaction.transition",
          field: "meaning",
          text: "Outside"
        },
        "artifact_path_escape"
      ],
      [
        {
          sourceArtifactPath: "design-system/interaction-rules.json",
          entryId: "missing",
          field: "meaning",
          text: "Missing"
        },
        "not_found"
      ],
      [
        {
          sourceArtifactPath: "design-system/interaction-rules.json",
          entryId: "interaction.transition",
          field: "meaning",
          text: "   "
        },
        "empty_text"
      ]
    ] as const) {
      expect(editDesignSystemEntry(projectPath, input)).toMatchObject({
        ok: false,
        reason
      });
      expect(readFileSync(sourcePath, "utf8")).toBe(original);
    }
    expect(listEvents(projectPath, "design_system_entry_edited")).toHaveLength(0);
  });
});

test("edit command rejects source drift and missing source files", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    const relativePath = "design-system/interaction-rules.json";
    const sourcePath = path.join(projectPath, relativePath);
    const source = JSON.parse(readFileSync(sourcePath, "utf8"));
    source.rules[0].value.componentOnlyField = true;
    writeFileSync(sourcePath, JSON.stringify(source), "utf8");

    expect(
      editDesignSystemEntry(projectPath, {
        sourceArtifactPath: relativePath,
        entryId: "interaction.transition",
        field: "meaning",
        text: "Schema drift"
      })
    ).toMatchObject({ ok: false, reason: "invalid_field_type" });

    unlinkSync(sourcePath);
    expect(
      editDesignSystemEntry(projectPath, {
        sourceArtifactPath: relativePath,
        entryId: "interaction.transition",
        field: "meaning",
        text: "Missing file"
      })
    ).toEqual({ ok: false, reason: "artifact_file_missing" });
  });
});

test("DB transaction failure restores the exact original source bytes", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    const relativePath = "design-system/interaction-rules.json";
    const sourcePath = path.join(projectPath, relativePath);
    const original = readFileSync(sourcePath, "utf8");
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      db.exec(
        `CREATE TRIGGER reject_designer_edit
         BEFORE UPDATE ON design_system_entries
         BEGIN SELECT RAISE(ABORT, 'injected edit failure'); END;`
      );
    } finally {
      db.close();
    }

    expect(
      editDesignSystemEntry(projectPath, {
        sourceArtifactPath: relativePath,
        entryId: "interaction.transition",
        field: "meaning",
        text: "Should roll back"
      })
    ).toEqual({ ok: false, reason: "db_error" });
    expect(readFileSync(sourcePath, "utf8")).toBe(original);
    expect(listEvents(projectPath, "design_system_entry_edited")).toHaveLength(0);
  });
});

test("LWW race loser preserves the winner bytes and records an invalid-output audit", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    const relativePath = "design-system/interaction-rules.json";
    const losing = editDesignSystemEntry(
      projectPath,
      {
        sourceArtifactPath: relativePath,
        entryId: "interaction.focus",
        field: "meaning",
        text: "Outer edit"
      },
      {
        beforeCommit: () => {
          const winner = editDesignSystemEntry(projectPath, {
            sourceArtifactPath: relativePath,
            entryId: "interaction.focus",
            field: "meaning",
            text: "Concurrent winner"
          });
          expect(winner.ok).toBe(true);
        }
      }
    );
    expect(losing).toEqual({ ok: false, reason: "concurrent_edit_superseded" });

    const source = JSON.parse(
      readFileSync(path.join(projectPath, relativePath), "utf8")
    );
    expect(source.rules[1].meaning).toBe("Concurrent winner");
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      expect(
        db
          .prepare(
            `SELECT meaning FROM design_system_entries
             WHERE source_artifact_path = ? AND entry_id = ?`
          )
          .get(relativePath, "interaction.focus")
      ).toEqual({ meaning: "Concurrent winner" });
    } finally {
      db.close();
    }
    expect(listEvents(projectPath, "design_system_entry_edited")).toHaveLength(1);
    expect(listEvents(projectPath, "invalid_output")[0].payload).toMatchObject({
      tool: "edit_design_system_entry",
      reason: "concurrent_edit_superseded"
    });
  });
});
