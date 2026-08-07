// Unit tests for source artifact declaration + artifact index (Issue 08).
// Pure Node — no MCP/Next. Runtime never fabricates semantics.

import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test, expect } from "vitest";
import {
  validateSourceArtifactDeclaration,
  recordSourceArtifact,
  listDeclaredArtifacts,
  isDeclaredArtifact
} from "../../lib/runtime/source-artifact";
import { listEvents } from "../../lib/runtime/events";
import { initializeProjectDb } from "../../lib/runtime/db";
import { getProjectDbPath } from "../../lib/runtime/paths";
import {
  subscribeRecordEvents,
  resetRecordBusForTests,
  type RecordBusEvent
} from "../../lib/runtime/record-bus";

function minimalDeclaration(overrides: Record<string, unknown> = {}) {
  return {
    path: "design-system/token.json",
    artifactType: "token.json",
    semanticPurpose: "primitive → semantic → component token layers",
    ...overrides
  };
}

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-source-artifact-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Task B: design-system declarations require deep-schema-valid files and at
// least one answered question card link.
const VALID_TOKEN_JSON = JSON.stringify({
  primitive: {},
  semantic: {},
  component: {}
});

function insertAnsweredCard(dir: string, id: string) {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, final_answer, answer_source,
        anchor_json, created_at, updated_at)
       VALUES (?, 'token', 'obs', 'ques', 'answer', 'designer-edited',
               '{}', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z')`
    ).run(id);
  } finally {
    db.close();
  }
}

function writeProjectFile(dir: string, rel: string, content: string) {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function countArtifacts(dir: string): number {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM source_artifacts")
      .get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

afterEach(() => {
  resetRecordBusForTests();
});

test.describe("validateSourceArtifactDeclaration (unit)", () => {
  test("valid minimal declaration", () => {
    const res = validateSourceArtifactDeclaration(minimalDeclaration());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.declaration.path).toBe("design-system/token.json");
    expect(res.declaration.artifactType).toBe("token.json");
    expect(res.declaration.relatedRecordIds).toEqual([]);
    expect(res.declaration.readiness).toBeUndefined();
  });

  test("valid with related record ids and readiness", () => {
    const res = validateSourceArtifactDeclaration(
      minimalDeclaration({
        path: "prototype/app.tsx",
        artifactType: "prototype",
        relatedRecordIds: ["card-1", "annotation-2"],
        readiness: "dev server boots on :5173"
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.declaration.relatedRecordIds).toEqual([
      "card-1",
      "annotation-2"
    ]);
    expect(res.declaration.readiness).toBe("dev server boots on :5173");
  });

  test("all 09A design-system file types plus prototype/code are known", () => {
    for (const artifactType of [
      "design-system.json",
      "token.json",
      "component-list.json",
      "component-spec",
      "layout-rules.json",
      "interaction-rules.json",
      "prototype",
      "code"
    ]) {
      const res = validateSourceArtifactDeclaration(
        minimalDeclaration({ artifactType })
      );
      expect(res.ok, artifactType).toBe(true);
    }
  });

  test("invalid: missing / empty path", () => {
    for (const input of [
      { ...minimalDeclaration(), path: undefined },
      { ...minimalDeclaration(), path: "   " }
    ]) {
      const res = validateSourceArtifactDeclaration(input);
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe("missing_path");
    }
  });

  test("invalid: missing artifact type", () => {
    const res = validateSourceArtifactDeclaration(
      minimalDeclaration({ artifactType: undefined })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_artifact_type");
  });

  test("invalid: unknown artifact type", () => {
    const res = validateSourceArtifactDeclaration(
      minimalDeclaration({ artifactType: "secret-sauce.yaml" })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("unknown_artifact_type");
  });

  test("invalid: missing semantic purpose", () => {
    const res = validateSourceArtifactDeclaration(
      minimalDeclaration({ semanticPurpose: "  " })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_semantic_purpose");
  });

  test("invalid: related record ids must be non-empty strings", () => {
    for (const relatedRecordIds of [["card-1", ""], [42], "card-1"]) {
      const res = validateSourceArtifactDeclaration(
        minimalDeclaration({ relatedRecordIds })
      );
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe("invalid_related_record_ids");
    }
  });
});

test.describe("recordSourceArtifact (record path)", () => {
  test("token declaration succeeds with actionable typography quality warnings", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      writeProjectFile(
        dir,
        "design-system/token.json",
        JSON.stringify({
          primitive: {
            "fontFamily.instrumentSans": {
              kind: "token",
              value: "Instrument Sans",
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            },
            "fontSize.64": {
              kind: "token",
              value: "64px",
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            },
            "fontWeight.regular": {
              kind: "token",
              value: 400,
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            },
            "lineHeight.100": {
              kind: "token",
              value: 1,
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            },
            "fontStyle.observedBundle": {
              kind: "token",
              value: {
                fontFamily: "Instrument Sans",
                fontSize: "64px",
                fontWeight: 400,
                lineHeight: 1
              },
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            }
          },
          semantic: {
            "typography.heroStatement": {
              kind: "token",
              value: {
                alias: "primitive.fontSize.64",
                usedFor: "Hero statement size role."
              },
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            }
          },
          component: {}
        })
      );

      const result = recordSourceArtifact(
        dir,
        minimalDeclaration({ relatedRecordIds: ["card-1"] })
      );

      expect(result).toMatchObject({
        ok: true,
        record: { status: "ingested" },
        quality_diagnostics: expect.arrayContaining([
          expect.objectContaining({
            severity: "warning",
            code: "typography_used_for_restates_role",
            entry_id: "semantic.typography.heroStatement"
          }),
          expect.objectContaining({
            severity: "warning",
            code: "typography_composite_roles_missing"
          })
        ])
      });
    });
  });

  test("flags the typography contract's low-information counterexample", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      writeProjectFile(
        dir,
        "design-system/token.json",
        JSON.stringify({
          primitive: {
            "fontSize.37": {
              kind: "token",
              value: "37px",
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            }
          },
          semantic: {
            "typography.connectHeadingSize": {
              kind: "token",
              value: {
                alias: "primitive.fontSize.37",
                usedFor: "Connect call-to-action heading size role."
              },
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            },
            "typography.callToAction": {
              kind: "token",
              value: {
                alias: "primitive.fontSize.37",
                usedFor: "Call-to-action role."
              },
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            }
          },
          component: {}
        })
      );

      const result = recordSourceArtifact(
        dir,
        minimalDeclaration({ relatedRecordIds: ["card-1"] })
      );

      expect(result).toMatchObject({
        ok: true,
        quality_diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: "typography_used_for_restates_role",
            entry_id: "semantic.typography.connectHeadingSize"
          }),
          expect.objectContaining({
            code: "typography_used_for_restates_role",
            entry_id: "semantic.typography.callToAction"
          })
        ])
      });
    });
  });

  test("rejects unresolved typography values disguised as token gaps", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      writeProjectFile(
        dir,
        "design-system/token.json",
        JSON.stringify({
          primitive: Object.fromEntries(
            ["fontFamily.observed", "fontSize.observed", "fontWeight.observed", "lineHeight.pending"].map(
              (name, index) => [
                name,
                {
                  kind: "token",
                  value: "Unresolved",
                  status: index === 3 ? "gap" : "candidate",
                  links: index === 3 ? [] : ["card-1"],
                  domain: "typography"
                }
              ]
            )
          ),
          semantic: {},
          component: {}
        })
      );

      const result = recordSourceArtifact(
        dir,
        minimalDeclaration({ relatedRecordIds: ["card-1"] })
      );

      expect(result).toMatchObject({
        ok: false,
        reason: "token_gap_forbidden"
      });
    });
  });

  test("complete composite typography roles declare without quality warnings", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      writeProjectFile(
        dir,
        "design-system/token.json",
        JSON.stringify({
          primitive: {
            "fontWeight.bold": {
              kind: "token",
              value: 700,
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            }
          },
          semantic: {
            "typography.connectHeading": {
              kind: "token",
              value: {
                fontFamily: "Instrument Sans",
                fontSize: "37px",
                fontWeight: 400,
                lineHeight: 1,
                letterSpacing: "-0.05em",
                usedFor: "Connect heading in the closing section."
              },
              status: "candidate",
              links: ["card-1"],
              domain: "typography"
            }
          },
          component: {}
        })
      );

      const result = recordSourceArtifact(
        dir,
        minimalDeclaration({ relatedRecordIds: ["card-1"] })
      );

      expect(result).toMatchObject({ ok: true, quality_diagnostics: [] });
    });
  });

  test("valid declaration → index row + source_artifact_declared event + bus", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      writeProjectFile(dir, "design-system/token.json", VALID_TOKEN_JSON);
      const invalidations: RecordBusEvent[] = [];
      const unsubscribe = subscribeRecordEvents((event) =>
        invalidations.push(event)
      );
      try {
        const res = recordSourceArtifact(
          dir,
          minimalDeclaration({ relatedRecordIds: ["card-1"] })
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.record.path).toBe("design-system/token.json");
        expect(res.record.artifact_type).toBe("token.json");
        expect(res.record.declaration_version).toBe(1);
        // Task C: design-system declarations pass the ingest gate and land
        // in the DB, so the index row is marked "ingested".
        expect(res.record.status).toBe("ingested");
        expect(JSON.parse(res.record.related_record_ids_json)).toEqual([
          "card-1"
        ]);

        const events = listEvents(dir, "source_artifact_declared");
        expect(events.length).toBe(1);
        expect(events[0].payload).toMatchObject({
          artifact_id: res.record.id,
          path: "design-system/token.json",
          artifact_type: "token.json",
          declaration_version: 1
        });
        expect(res.event_id).toBe(events[0].event_id);

        expect(invalidations).toEqual([
          expect.objectContaining({
            kind: "artifact",
            action: "created",
            id: res.record.id,
            projectPath: path.resolve(dir)
          }),
          expect.objectContaining({
            kind: "design-system",
            action: "created",
            id: "design-system/token.json",
            projectPath: path.resolve(dir)
          })
        ]);

        expect(countArtifacts(dir)).toBe(1);
        expect(listDeclaredArtifacts(dir).length).toBe(1);
      } finally {
        unsubscribe();
      }
    });
  });

  test("absolute path is canonicalized to the same project-relative index path", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      writeProjectFile(dir, "design-system/token.json", VALID_TOKEN_JSON);
      const res = recordSourceArtifact(
        dir,
        minimalDeclaration({
          path: path.join(dir, "design-system/token.json"),
          relatedRecordIds: ["card-1"]
        })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.path).toBe("design-system/token.json");
      expect(
        isDeclaredArtifact(dir, path.join(dir, "design-system/token.json"))
      ).toBe(true);
    });
  });

  test("out-of-scope path (traversal) → artifact_path_escape + invalid_artifact, no row", () => {
    withTempProject((dir) => {
      const res = recordSourceArtifact(
        dir,
        minimalDeclaration({ path: "../outside/token.json" })
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("artifact_path_escape");
      expect(countArtifacts(dir)).toBe(0);

      const invalid = listEvents(dir, "invalid_artifact");
      expect(invalid.length).toBe(1);
      expect(invalid[0].payload).toMatchObject({
        tool: "record_artifact_written",
        reason: "artifact_path_escape",
        details: { path: "../outside/token.json" }
      });
      expect(listEvents(dir, "source_artifact_declared").length).toBe(0);
    });
  });

  test("out-of-scope path (symlink escape) → artifact_path_escape", () => {
    withTempProject((dir) => {
      const outside = mkdtempSync(
        path.join(tmpdir(), "ikran-artifact-outside-")
      );
      try {
        writeFileSync(path.join(outside, "secret.json"), "{}");
        mkdirSync(path.join(dir, "design-system"), { recursive: true });
        symlinkSync(
          path.join(outside, "secret.json"),
          path.join(dir, "design-system", "token.json")
        );

        const res = recordSourceArtifact(dir, minimalDeclaration());
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.reason).toBe("artifact_path_escape");
        expect(countArtifacts(dir)).toBe(0);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  test("unknown artifact type → invalid_artifact event, no row", () => {
    withTempProject((dir) => {
      writeProjectFile(dir, "design-system/token.json", "{}");
      const res = recordSourceArtifact(
        dir,
        minimalDeclaration({ artifactType: "mystery.json" })
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("unknown_artifact_type");
      expect(countArtifacts(dir)).toBe(0);

      const invalid = listEvents(dir, "invalid_artifact");
      expect(invalid.length).toBe(1);
      expect(invalid[0].payload).toMatchObject({
        tool: "record_artifact_written",
        reason: "unknown_artifact_type"
      });
    });
  });

  test("design-system artifact: missing file → artifact_file_missing", () => {
    withTempProject((dir) => {
      const res = recordSourceArtifact(dir, minimalDeclaration());
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("artifact_file_missing");
      expect(countArtifacts(dir)).toBe(0);
    });
  });

  test("design-system artifact: invalid JSON / non-object top level → invalid_design_system_json", () => {
    withTempProject((dir) => {
      writeProjectFile(dir, "design-system/token.json", "not json{");
      const badSyntax = recordSourceArtifact(dir, minimalDeclaration());
      expect(badSyntax.ok).toBe(false);
      if (badSyntax.ok) return;
      expect(badSyntax.reason).toBe("invalid_design_system_json");

      writeProjectFile(dir, "design-system/token.json", "[1,2,3]");
      const arrayTop = recordSourceArtifact(dir, minimalDeclaration());
      expect(arrayTop.ok).toBe(false);
      if (arrayTop.ok) return;
      expect(arrayTop.reason).toBe("invalid_design_system_json");

      expect(countArtifacts(dir)).toBe(0);
      const invalid = listEvents(dir, "invalid_artifact");
      expect(invalid.length).toBe(2);
      expect(invalid[0].payload).toMatchObject({
        tool: "record_artifact_written",
        reason: "invalid_design_system_json"
      });
    });
  });

  test("code artifact: missing file → artifact_file_missing; never judged on quality", () => {
    withTempProject((dir) => {
      const missing = recordSourceArtifact(
        dir,
        minimalDeclaration({
          path: "prototype/app.tsx",
          artifactType: "prototype"
        })
      );
      expect(missing.ok).toBe(false);
      if (missing.ok) return;
      expect(missing.reason).toBe("artifact_file_missing");

      // Any file content passes: Runtime checks existence/scope only.
      writeProjectFile(dir, "prototype/app.tsx", "this is not even valid ts");
      const res = recordSourceArtifact(
        dir,
        minimalDeclaration({
          path: "prototype/app.tsx",
          artifactType: "prototype",
          readiness: "not started"
        })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.readiness).toBe("not started");
    });
  });

  test("re-declaration of the same path updates the index row (new declaration version)", () => {
    withTempProject((dir) => {
      writeProjectFile(dir, "prototype/app.tsx", "v1");
      const first = recordSourceArtifact(
        dir,
        minimalDeclaration({
          path: "prototype/app.tsx",
          artifactType: "prototype",
          semanticPurpose: "first reconstruction draft"
        })
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      writeProjectFile(dir, "prototype/app.tsx", "v2");
      const invalidations: RecordBusEvent[] = [];
      const unsubscribe = subscribeRecordEvents((event) =>
        invalidations.push(event)
      );
      try {
        const second = recordSourceArtifact(
          dir,
          minimalDeclaration({
            path: path.join(dir, "prototype", "app.tsx"),
            artifactType: "code",
            semanticPurpose: "revised reconstruction draft",
            relatedRecordIds: ["card-9"]
          })
        );
        expect(second.ok).toBe(true);
        if (!second.ok) return;

        // Same index row, bumped declaration version, latest semantics win.
        expect(second.record.id).toBe(first.record.id);
        expect(second.record.declaration_version).toBe(2);
        expect(second.record.artifact_type).toBe("code");
        expect(second.record.semantic_purpose).toBe(
          "revised reconstruction draft"
        );
        expect(JSON.parse(second.record.related_record_ids_json)).toEqual([
          "card-9"
        ]);
        expect(second.record.created_at).toBe(first.record.created_at);
        expect(countArtifacts(dir)).toBe(1);

        const events = listEvents(dir, "source_artifact_declared");
        expect(events.length).toBe(2);
        expect(events[1].payload).toMatchObject({
          artifact_id: first.record.id,
          declaration_version: 2
        });

        expect(invalidations).toEqual([
          expect.objectContaining({
            kind: "artifact",
            action: "updated",
            id: first.record.id
          })
        ]);
      } finally {
        unsubscribe();
      }
    });
  });

  test("undeclared-file guard: only declared index paths count", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      writeProjectFile(dir, "design-system/token.json", VALID_TOKEN_JSON);
      writeProjectFile(dir, "design-system/stray.json", "{}");

      expect(isDeclaredArtifact(dir, "design-system/token.json")).toBe(false);
      expect(listDeclaredArtifacts(dir)).toEqual([]);

      const res = recordSourceArtifact(
        dir,
        minimalDeclaration({ relatedRecordIds: ["card-1"] })
      );
      expect(res.ok).toBe(true);

      expect(isDeclaredArtifact(dir, "design-system/token.json")).toBe(true);
      expect(isDeclaredArtifact(dir, "design-system/stray.json")).toBe(false);
      // Escapes fail closed as undeclared.
      expect(isDeclaredArtifact(dir, "../outside.json")).toBe(false);

      const listed = listDeclaredArtifacts(dir);
      expect(listed.length).toBe(1);
      expect(listed[0].path).toBe("design-system/token.json");
    });
  });

  test("usedCandidateIds validates candidate entries and records dependency event", () => {
    withTempProject((dir) => {
      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        db.prepare(
          `INSERT INTO design_system_entries
           (id, source_artifact_path, file_kind, section, entry_id, name,
            value_json, meaning, status, links_json, position, created_at, updated_at)
           VALUES ('cand-1', 'design-system/layout-rules.json', 'layout-rules.json',
                   'layout', 'layout.cand', 'layout.cand', '"v"', 'Cand',
                   'candidate', '[]', 0, ?, ?)`
        ).run("2026-08-06T00:00:00.000Z", "2026-08-06T00:00:00.000Z");
        db.prepare(
          `INSERT INTO design_system_entries
           (id, source_artifact_path, file_kind, section, entry_id, name,
            value_json, meaning, status, links_json, position, created_at, updated_at)
           VALUES ('formal-1', 'design-system/layout-rules.json', 'layout-rules.json',
                   'layout', 'layout.formal', 'layout.formal', '"v"', 'Formal',
                   'formalized', '[]', 1, ?, ?)`
        ).run("2026-08-06T00:00:00.000Z", "2026-08-06T00:00:00.000Z");
      } finally {
        db.close();
      }

      writeProjectFile(dir, "prototype/app.tsx", "export default function App(){return null}");

      expect(
        recordSourceArtifact(dir, {
          path: "prototype/app.tsx",
          artifactType: "prototype",
          semanticPurpose: "new design page",
          usedCandidateIds: ["missing"]
        })
      ).toMatchObject({ ok: false, reason: "candidate_entry_not_found" });

      expect(
        recordSourceArtifact(dir, {
          path: "prototype/app.tsx",
          artifactType: "prototype",
          semanticPurpose: "new design page",
          usedCandidateIds: ["formal-1"]
        })
      ).toMatchObject({ ok: false, reason: "candidate_entry_not_candidate" });

      const ok = recordSourceArtifact(dir, {
        path: "prototype/app.tsx",
        artifactType: "prototype",
        semanticPurpose: "new design page",
        usedCandidateIds: ["cand-1"]
      });
      expect(ok.ok).toBe(true);
      expect(listEvents(dir, "candidate_dependency_declared")).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            used_candidate_ids: ["cand-1"],
            source: "record_artifact_written",
            path: "prototype/app.tsx"
          })
        })
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// Declared capture existence gate (capture_rule_screenshot): a sourceCaptures
// artifactPath on layout / components.spec rules must be a real project file.
// ---------------------------------------------------------------------------

test.describe("declared capture existence gate", () => {
  function insertCandidateCard(dir: string, id: string) {
    const db = new DatabaseSync(getProjectDbPath(dir));
    try {
      db.prepare(
        `INSERT INTO alignment_question_cards
         (id, section, observation, question, final_answer, answer_source,
          anchor_json, created_at, updated_at)
         VALUES (?, 'layout', 'obs', 'ques', 'answer',
                 'agent-proposed-designer-accepted',
                 '{}', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z')`
      ).run(id);
    } finally {
      db.close();
    }
  }

  function writeLayoutRules(dir: string, captures: unknown) {
    writeProjectFile(
      dir,
      "design-system/layout-rules.json",
      JSON.stringify({
        rules: [
          {
            id: "rule-1",
            value: "Use a twelve-column grid.",
            meaning: "Grid",
            status: "gap",
            links: [],
            ...(captures === undefined ? {} : { sourceCaptures: captures })
          }
        ]
      })
    );
  }

  function declareLayoutRules(dir: string) {
    return recordSourceArtifact(dir, {
      path: "design-system/layout-rules.json",
      artifactType: "layout-rules.json",
      semanticPurpose: "layout rules",
      relatedRecordIds: ["card-1"]
    });
  }

  function capture(artifactPath: string) {
    return {
      nodeName: "Grid",
      artifactPath,
      capturedAt: "2026-08-07T00:00:00.000Z"
    };
  }

  test("a declared layout capture artifactPath must exist on disk", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      writeLayoutRules(dir, [capture("design-system/captures/grid.png")]);

      const missing = declareLayoutRules(dir);
      expect(missing).toMatchObject({
        ok: false,
        reason: "capture_file_missing",
        details: { capturePath: "design-system/captures/grid.png" }
      });
      expect(countArtifacts(dir)).toBe(0);
      expect(
        listEvents(dir, "invalid_artifact")[0].payload
      ).toMatchObject({ reason: "capture_file_missing" });

      writeProjectFile(dir, "design-system/captures/grid.png", "png");
      expect(declareLayoutRules(dir).ok).toBe(true);
    });
  });

  test("omitting sourceCaptures stays legal", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      writeLayoutRules(dir, undefined);
      expect(declareLayoutRules(dir).ok).toBe(true);
    });
  });

  test("a capture path escaping the project fails closed", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      writeLayoutRules(dir, [capture("../outside.png")]);
      expect(declareLayoutRules(dir)).toMatchObject({
        ok: false,
        reason: "capture_file_missing",
        details: { capturePath: "../outside.png" }
      });
    });
  });

  test("component-spec value.sourceCaptures is gated the same way", () => {
    withTempProject((dir) => {
      insertCandidateCard(dir, "card-1");
      writeProjectFile(
        dir,
        "design-system/components/button.json",
        JSON.stringify({
          id: "component-button",
          name: "Button",
          value: {
            description: "Primary action.",
            props: [],
            variants: [],
            stateMatrix: [],
            guidelines: [],
            tokenLinks: [],
            codeLinks: [],
            sourceCaptures: [capture("design-system/captures/button.png")]
          },
          meaning: "Button spec",
          status: "candidate",
          links: ["card-1"]
        })
      );
      const declare = () =>
        recordSourceArtifact(dir, {
          path: "design-system/components/button.json",
          artifactType: "component-spec",
          semanticPurpose: "button spec",
          relatedRecordIds: ["card-1"]
        });

      expect(declare()).toMatchObject({
        ok: false,
        reason: "capture_file_missing",
        details: { capturePath: "design-system/captures/button.png" }
      });

      writeProjectFile(dir, "design-system/captures/button.png", "png");
      expect(declare().ok).toBe(true);
    });
  });
});
