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
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";

import { editDesignSystemEntry } from "../../lib/runtime/design-system-edit";
import { approveDesignSystemEntry } from "../../lib/runtime/design-system-approval";
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
        value: "Transitions stay quiet.",
        meaning: "Quiet transitions",
        status: "gap",
        links: []
      },
      {
        id: "interaction.focus",
        value: "Focus remains visible.",
        meaning: "Visible focus",
        status: "candidate",
        links: ["designer-card"]
      },
      {
        id: "interaction.feedback",
        value: "Feedback is immediate.",
        meaning: "Immediate feedback",
        status: "formalized",
        links: ["designer-card"]
      },
      {
        id: "interaction.prose",
        value: "Use a short, calm response.",
        meaning: "Calm response",
        status: "candidate",
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

function ingestVisualLanguage(projectPath: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, final_answer, answer_source,
        anchor_json, created_at, updated_at)
       VALUES (?, 'visual-language', 'Observed', 'Keep?', 'Yes',
               'designer-edited', '{}', ?, ?)`
    ).run(
      "visual-language-card",
      "2026-08-05T00:00:00.000Z",
      "2026-08-05T00:00:00.000Z"
    );
  } finally {
    db.close();
  }
  writeJson(projectPath, "design-system/design-system.json", {
    name: "Editorial Portfolio",
    visualLanguage: {
      id: "visual-language",
      value: { description: "Monochrome editorial restraint." },
      meaning: "Quiet editorial clarity",
      status: "candidate",
      links: ["visual-language-card"]
    },
    concepts: []
  });
  const declared = recordSourceArtifact(projectPath, {
    path: "design-system/design-system.json",
    artifactType: "design-system.json",
    semanticPurpose: "visual language edit fixture",
    relatedRecordIds: ["visual-language-card"]
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
      sourceArtifactPath: "design-system/design-system.json",
      entryId: "visual-language",
      field: "value.description",
      text: "A revised visual language description."
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

test("designer edits the Visual Language description through the Runtime write path", () => {
  withTempProject((projectPath) => {
    ingestVisualLanguage(projectPath);
    const result = editDesignSystemEntryCommand(projectPath, {
      sourceArtifactPath: "design-system/design-system.json",
      entryId: "visual-language",
      field: "value.description",
      text: "Black-and-white structure with project-led color."
    });
    if (!result.ok) throw new Error(JSON.stringify(result));

    const source = JSON.parse(
      readFileSync(
        path.join(projectPath, "design-system/design-system.json"),
        "utf8"
      )
    );
    expect(source.visualLanguage).toMatchObject({
      meaning: "Quiet editorial clarity",
      value: {
        description: "Black-and-white structure with project-led color."
      },
      status: "candidate"
    });

    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      const row = db
        .prepare(
          `SELECT value_json FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get("design-system/design-system.json", "visual-language") as {
        value_json: string;
      };
      expect(JSON.parse(row.value_json)).toEqual({
        description: "Black-and-white structure with project-led color."
      });
    } finally {
      db.close();
    }

    expect(listEvents(projectPath, "design_system_entry_edited")[0].payload)
      .toMatchObject({
        field: "value.description",
        before: "Monochrome editorial restraint.",
        after: "Black-and-white structure with project-led color."
      });
  });
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

test("designer edits a prose body verbatim through the same write path", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    const body = "  Respond immediately.\nKeep motion restrained.  ";
    const result = editDesignSystemEntryCommand(projectPath, {
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.prose",
      field: "value",
      text: body
    });
    expect(result.ok).toBe(true);

    const source = JSON.parse(
      readFileSync(
        path.join(projectPath, "design-system/interaction-rules.json"),
        "utf8"
      )
    );
    expect(source.rules[3].value).toBe(body);
    expect(listEvents(projectPath, "design_system_entry_edited")[0].payload)
      .toMatchObject({
        field: "value",
        before: "Use a short, calm response.",
        after: body
      });
    const view = getDesignSystemView(projectPath);
    if (!view.ok) throw new Error(view.reason);
    expect(
      view.view.interaction.find(
        (entry) => entry.entry_id === "interaction.prose"
      )?.value
    ).toBe(body);
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
          field: "value.description",
          text: "Wrong entry shape"
        },
        "unsupported_field"
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
    source.rules[0].meaning = 42;
    writeFileSync(sourcePath, JSON.stringify(source), "utf8");

    expect(
      editDesignSystemEntry(projectPath, {
        sourceArtifactPath: relativePath,
        entryId: "interaction.transition",
        field: "value",
        text: "Schema drift."
      })
    ).toMatchObject({ ok: false, reason: "source_db_drift" });

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

test("Visual Language DB failure restores the exact nested source bytes", () => {
  withTempProject((projectPath) => {
    ingestVisualLanguage(projectPath);
    const relativePath = "design-system/design-system.json";
    const sourcePath = path.join(projectPath, relativePath);
    const original = readFileSync(sourcePath, "utf8");
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      db.exec(
        `CREATE TRIGGER reject_visual_language_edit
         BEFORE UPDATE ON design_system_entries
         BEGIN SELECT RAISE(ABORT, 'injected visual edit failure'); END;`
      );
    } finally {
      db.close();
    }

    expect(
      editDesignSystemEntry(projectPath, {
        sourceArtifactPath: relativePath,
        entryId: "visual-language",
        field: "value.description",
        text: "This must roll back."
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

test("interleaved edits to different entries in one file both commit", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    const relativePath = "design-system/interaction-rules.json";
    let inner: ReturnType<typeof editDesignSystemEntry> | undefined;
    const outer = editDesignSystemEntry(
      projectPath,
      {
        sourceArtifactPath: relativePath,
        entryId: "interaction.focus",
        field: "meaning",
        text: "Persistent focus"
      },
      {
        beforeCommit: () => {
          inner = editDesignSystemEntry(projectPath, {
            sourceArtifactPath: relativePath,
            entryId: "interaction.feedback",
            field: "meaning",
            text: "Prompt feedback"
          });
        }
      }
    );

    expect(inner?.ok).toBe(true);
    expect(outer.ok).toBe(true);
    const source = JSON.parse(
      readFileSync(path.join(projectPath, relativePath), "utf8")
    );
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      for (const [entryId, meaning, sourceIndex] of [
        ["interaction.focus", "Persistent focus", 1],
        ["interaction.feedback", "Prompt feedback", 2]
      ] as const) {
        const row = db
          .prepare(
            `SELECT meaning, links_json FROM design_system_entries
             WHERE source_artifact_path = ? AND entry_id = ?`
          )
          .get(relativePath, entryId) as {
          meaning: string;
          links_json: string;
        };
        expect(row.meaning).toBe(meaning);
        expect(source.rules[sourceIndex]).toMatchObject({
          meaning,
          links: JSON.parse(row.links_json)
        });
      }
    } finally {
      db.close();
    }
    expect(listEvents(projectPath, "design_system_entry_edited")).toHaveLength(2);
  });
});

test("outer DB failure rolls back only its entry after another entry commits", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    const relativePath = "design-system/interaction-rules.json";
    let inner: ReturnType<typeof editDesignSystemEntry> | undefined;
    const outer = editDesignSystemEntry(
      projectPath,
      {
        sourceArtifactPath: relativePath,
        entryId: "interaction.focus",
        field: "meaning",
        text: "Rejected outer edit"
      },
      {
        beforeCommit: () => {
          inner = editDesignSystemEntry(projectPath, {
            sourceArtifactPath: relativePath,
            entryId: "interaction.feedback",
            field: "meaning",
            text: "Committed inner edit"
          });
          const db = new DatabaseSync(getProjectDbPath(projectPath));
          try {
            db.exec(
              `CREATE TRIGGER reject_outer_entry
               BEFORE UPDATE ON design_system_entries
               WHEN OLD.entry_id = 'interaction.focus'
               BEGIN SELECT RAISE(ABORT, 'reject outer'); END;`
            );
          } finally {
            db.close();
          }
        }
      }
    );

    expect(inner?.ok).toBe(true);
    expect(outer).toEqual({ ok: false, reason: "db_error" });
    const source = JSON.parse(
      readFileSync(path.join(projectPath, relativePath), "utf8")
    );
    expect(source.rules[1]).toMatchObject({
      meaning: "Visible focus",
      links: ["designer-card"]
    });
    expect(source.rules[2].meaning).toBe("Committed inner edit");
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      expect(
        db
          .prepare(
            `SELECT entry_id, meaning, links_json FROM design_system_entries
             WHERE source_artifact_path = ? AND entry_id IN (?, ?)
             ORDER BY entry_id`
          )
          .all(
            relativePath,
            "interaction.focus",
            "interaction.feedback"
          )
      ).toEqual([
        expect.objectContaining({
          entry_id: "interaction.feedback",
          meaning: "Committed inner edit"
        }),
        {
          entry_id: "interaction.focus",
          meaning: "Visible focus",
          links_json: JSON.stringify(["designer-card"])
        }
      ]);
    } finally {
      db.close();
    }
    expect(listEvents(projectPath, "design_system_entry_edited")).toHaveLength(1);
  });
});

test("edit repairs source-only evidence-link drift from the DB authority", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    const relativePath = "design-system/interaction-rules.json";
    const sourcePath = path.join(projectPath, relativePath);
    const source = JSON.parse(readFileSync(sourcePath, "utf8"));
    source.rules[1].links = ["source-only-drift"];
    writeFileSync(sourcePath, JSON.stringify(source), "utf8");

    const result = editDesignSystemEntry(projectPath, {
      sourceArtifactPath: relativePath,
      entryId: "interaction.focus",
      field: "meaning",
      text: "Persistent focus"
    });
    if (!result.ok) throw new Error(JSON.stringify(result));

    const repaired = JSON.parse(readFileSync(sourcePath, "utf8"));
    expect(repaired.rules[1].links).toEqual([
      "designer-card",
      result.event_id
    ]);
  });
});

test("an approval interleaved after a source write fails closed without splitting source and DB", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    const relativePath = "design-system/interaction-rules.json";
    let approval: ReturnType<typeof approveDesignSystemEntry> | undefined;
    const edit = editDesignSystemEntry(
      projectPath,
      {
        sourceArtifactPath: relativePath,
        entryId: "interaction.focus",
        field: "meaning",
        text: "Persistent focus"
      },
      {
        beforeCommit: () => {
          approval = approveDesignSystemEntry(projectPath, {
            sourceArtifactPath: relativePath,
            entryId: "interaction.focus",
            targetStatus: "formalized"
          });
        }
      }
    );

    expect(approval).toMatchObject({ ok: false, reason: "source_db_drift" });
    expect(edit.ok).toBe(true);
    const source = JSON.parse(
      readFileSync(path.join(projectPath, relativePath), "utf8")
    );
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      const row = db
        .prepare(
          `SELECT meaning, status, links_json FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get(relativePath, "interaction.focus") as {
        meaning: string;
        status: string;
        links_json: string;
      };
      expect(source.rules[1]).toMatchObject({
        meaning: row.meaning,
        status: row.status,
        links: JSON.parse(row.links_json)
      });
    } finally {
      db.close();
    }
  });
});


// ---------------------------------------------------------------------------
// Token meaning contract
// ---------------------------------------------------------------------------

function ingestTokenFile(projectPath: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, final_answer, answer_source,
        anchor_json, created_at, updated_at)
       VALUES (?, 'token', 'Observed', 'Keep?', 'Yes',
               'designer-edited', '{}', ?, ?)`
    ).run(
      "designer-card",
      "2026-08-03T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z"
    );
  } finally {
    db.close();
  }
  writeJson(projectPath, "design-system/token.json", {
    primitive: {
      "color.ink": {
        kind: "token",
        domain: "color",
        value: "#111111",
        status: "formalized",
        links: ["designer-card"]
      },
      "color-rule": {
        kind: "domain-rule",
        domain: "color",
        value: "Reserve the ink for primary text.",
        meaning: "Ink restraint",
        status: "candidate",
        links: ["designer-card"]
      },
      "space.4": {
        kind: "token",
        domain: "spacing",
        value: "16px",
        status: "candidate",
        links: ["designer-card"]
      }
    },
    semantic: {
      "color.primary": {
        kind: "token",
        domain: "color",
        value: { alias: "primitive.color.ink", usage: "语义主色" },
        status: "candidate",
        links: ["designer-card"]
      }
    },
    component: {}
  });
  const declared = recordSourceArtifact(projectPath, {
    path: "design-system/token.json",
    artifactType: "token.json",
    semanticPurpose: "edit command fixture",
    relatedRecordIds: ["designer-card"]
  });
  if (!declared.ok) throw new Error(JSON.stringify(declared));
}

test("meaning edits on token entries are rejected before touching the source", () => {
  withTempProject((projectPath) => {
    ingestTokenFile(projectPath);
    const relativePath = "design-system/token.json";
    const sourcePath = path.join(projectPath, relativePath);
    const original = readFileSync(sourcePath, "utf8");

    expect(
      editDesignSystemEntry(projectPath, {
        sourceArtifactPath: relativePath,
        entryId: "primitive.color.ink",
        field: "meaning",
        text: "品牌墨色"
      })
    ).toEqual({ ok: false, reason: "token_meaning_forbidden" });
    expect(readFileSync(sourcePath, "utf8")).toBe(original);
    expect(listEvents(projectPath, "design_system_entry_edited")).toHaveLength(0);

    // Value edits stay allowed on the same entry.
    expect(
      editDesignSystemEntry(projectPath, {
        sourceArtifactPath: relativePath,
        entryId: "primitive.color.ink",
        field: "value",
        text: "#222222"
      })
    ).toMatchObject({ ok: true });

    // Rules retain editable meanings.
    expect(
      editDesignSystemEntry(projectPath, {
        sourceArtifactPath: relativePath,
        entryId: "primitive.color-rule",
        field: "meaning",
        text: "Ink stays for primary text"
      })
    ).toMatchObject({ ok: true });
    expect(
      editDesignSystemEntry(projectPath, {
        sourceArtifactPath: relativePath,
        entryId: "semantic.color.primary",
        field: "meaning",
        text: "品牌主色"
      })
    ).toEqual({ ok: false, reason: "token_meaning_forbidden" });
  });
});

test("legacy token meanings fail closed and are never repaired during edits", () => {
  withTempProject((projectPath) => {
    ingestTokenFile(projectPath);
    const relativePath = "design-system/token.json";
    const sourcePath = path.join(projectPath, relativePath);

    // Simulate a source file written under the pre-contract schema.
    const drifted = JSON.parse(readFileSync(sourcePath, "utf8"));
    drifted.primitive["color.ink"].meaning = "品牌墨色";
    writeFileSync(sourcePath, JSON.stringify(drifted), "utf8");

    const original = readFileSync(sourcePath, "utf8");
    const result = editDesignSystemEntry(projectPath, {
      sourceArtifactPath: relativePath,
      entryId: "primitive.color-rule",
      field: "meaning",
      text: "Ink remains restrained"
    });
    expect(result).toMatchObject({ ok: false, reason: "token_meaning_forbidden" });
    expect(readFileSync(sourcePath, "utf8")).toBe(original);
    expect(listEvents(projectPath, "design_system_entry_edited")).toHaveLength(0);
  });
});

test("edit leaves the digest stale when another entry drifted undeclared", () => {
  withTempProject((projectPath) => {
    ingestGapRule(projectPath);
    // Agent silently rewrites another rule's value on disk (no declaration):
    // the file now drifts from the DB rows.
    const source = JSON.parse(
      readFileSync(
        path.join(projectPath, "design-system/interaction-rules.json"),
        "utf8"
      )
    ) as { rules: Array<{ id: string; value: unknown }> };
    source.rules.find((rule) => rule.id === "interaction.prose")!.value =
      "Agent rewrote this on disk.";
    writeJson(projectPath, "design-system/interaction-rules.json", source);

    const result = editDesignSystemEntry(projectPath, {
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.focus",
      field: "meaning",
      text: "Focus always visible"
    });
    expect(result).toMatchObject({ ok: true });

    // The written-back file must NOT enter the digest ledger: recording
    // these bytes would hide the prose drift from the lazy file→DB sync.
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      const row = db
        .prepare(
          "SELECT content_digest FROM source_artifacts WHERE path = 'design-system/interaction-rules.json'"
        )
        .get() as { content_digest: string | null };
      const fileDigest = createHash("sha256")
        .update(
          readFileSync(
            path.join(projectPath, "design-system/interaction-rules.json")
          )
        )
        .digest("hex");
      expect(row.content_digest).not.toBe(fileDigest);
    } finally {
      db.close();
    }

    // The next view read notices the byte mismatch and re-ingests, healing
    // the drifted prose value into the DB.
    const view = getDesignSystemView(projectPath);
    expect(view.ok).toBe(true);
    const dbAfter = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      const prose = dbAfter
        .prepare(
          `SELECT value_json FROM design_system_entries
           WHERE source_artifact_path = 'design-system/interaction-rules.json'
             AND entry_id = 'interaction.prose'`
        )
        .get() as { value_json: string };
      expect(JSON.parse(prose.value_json)).toBe("Agent rewrote this on disk.");
    } finally {
      dbAfter.close();
    }
  });
});
