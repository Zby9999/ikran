// Unit tests for design-system approval write-back (Issue 09A decision 5,
// Task D). The Browser's only write operation in v1 is candidate → formalized
// approval: it flips the DB row AND writes the entry's status back into the
// JSON source file with canonical serialization (sorted keys, 2-space indent,
// trailing newline). Conflicts are LWW with a semantic event log (09A d.8).

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
import {
  getDesignSystemView,
  stableJsonStringify,
  writeDesignSystemViewExport
} from "../../lib/runtime/design-system-view";
import { validateDesignSystemJson } from "../../lib/runtime/design-system-schema";
import type { DesignSystemFileKind } from "../../lib/runtime/design-system-schema";
import { approveDesignSystemEntryCommand } from "../../lib/runtime/commands";
import { commandErrorHttpStatus } from "../../lib/runtime/commands";
import { listEvents } from "../../lib/runtime/events";
import { initializeProjectDb } from "../../lib/runtime/db";
import { getArtifactsDir, getProjectDbPath } from "../../lib/runtime/paths";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import {
  subscribeRecordEvents,
  resetRecordBusForTests,
  type RecordBusEvent
} from "../../lib/runtime/record-bus";

const VALID_FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-ds-approval-"));
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

function readProjectFile(dir: string, rel: string): string {
  return readFileSync(path.join(dir, rel), "utf-8");
}

function insertCard(
  dir: string,
  opts: {
    id: string;
    finalAnswer?: string | null;
    answerSource?: string | null;
    anchorJson?: string;
  }
) {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, final_answer, answer_source,
        anchor_json, created_at, updated_at)
       VALUES (?, 'token', 'obs', 'ques', ?, ?, ?,
               '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z')`
    ).run(
      opts.id,
      opts.finalAnswer ?? null,
      opts.answerSource ?? null,
      opts.anchorJson ?? "{}"
    );
  } finally {
    db.close();
  }
}

function insertAnnotation(
  dir: string,
  opts: { id: string; inference: string; anchorJson?: string }
) {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `INSERT INTO agent_alignment_annotations
       (id, inference, body, anchor_json, created_at, updated_at)
       VALUES (?, ?, 'body', ?,
               '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z')`
    ).run(opts.id, opts.inference, opts.anchorJson ?? "{}");
  } finally {
    db.close();
  }
}

// A real seed + evidence surface so annotation anchors resolve on the 08A
// snapshot surface (same fixture discipline as the ingest tests).
function seedSurface(dir: string): { seedId: string; surfaceId: string } {
  const seed = registerSeedReference(dir, {
    figmaSeedReference: VALID_FIGMA,
    originalDesignIntent: "approval fixture"
  });
  if (!seed.ok) throw new Error(`seed failed: ${seed.reason}`);
  const pkg = recordEvidencePackage(dir, {
    figmaSeedReference: VALID_FIGMA,
    frame: { nodeId: "1:2", name: "Checkout" },
    evidenceViews: { rawData: "available", screenshot: "missing" }
  });
  if (!pkg.ok) throw new Error(`evidence failed: ${pkg.reason}`);
  return { seedId: seed.record.id, surfaceId: pkg.record.id };
}

function surfaceAnchorJson(seedId: string, surfaceId: string): string {
  return JSON.stringify({
    kind: "single",
    target: {
      kind: "surface",
      seedReferenceId: seedId,
      evidenceSurfaceId: surfaceId,
      evidenceVersionId: surfaceId
    }
  });
}

function seedEvidenceCards(dir: string) {
  const { seedId, surfaceId } = seedSurface(dir);
  insertCard(dir, {
    id: "card-edited",
    finalAnswer: "设计师改过的答案",
    answerSource: "designer-edited"
  });
  insertCard(dir, {
    id: "card-accepted",
    finalAnswer: "采纳 Agent 提议",
    answerSource: "agent-proposed-designer-accepted"
  });
  insertAnnotation(dir, {
    id: "ann-reasonable",
    inference: "reasonable",
    anchorJson: surfaceAnchorJson(seedId, surfaceId)
  });
  return { seedId, surfaceId };
}

// Shared token.json fixture; the semantic candidate's links vary per test
// (approvable via card-edited, rejection cases via card-accepted / annotation).
function tokenJsonFixture(semanticLinks: string[]) {
  return {
    primitive: {
      "color.blue.500": {
        kind: "token",
        domain: "color",
        value: "#3b82f6",
        status: "formalized",
        links: ["card-edited"]
      }
    },
    semantic: {
      "color.primary": {
        kind: "token",
        domain: "color",
        value: {
          alias: "primitive.color.blue.500",
          usage: "语义主色"
        },
        status: "candidate",
        links: semanticLinks
      }
    },
    component: {}
  };
}

// Approval fixtures: one candidate per file kind backed by the designer-edited
// card (approvable), plus an annotation-only candidate and gaps for the
// rejection paths.
function writeApprovalFixtures(dir: string) {
  writeProjectFile(dir, "design-system/design-system.json", {
    name: "Test DS",
    visualLanguage: {
      id: "vl",
      value: { description: "冷静低饱和的工程感" },
      meaning: "项目级视觉语言叙述",
      status: "formalized",
      links: ["card-edited"]
    },
    principles: [
      {
        id: "p1",
        value: "少即是多。",
        meaning: "克制",
        status: "candidate",
        links: ["card-edited"]
      },
      {
        id: "p2",
        value: "一致性优先。",
        meaning: "一致性",
        status: "candidate",
        links: ["card-edited"]
      },
      {
        id: "p3",
        value: "Agent 推断的原则。",
        meaning: "仅 annotation 支撑",
        status: "candidate",
        links: ["ann-reasonable"]
      },
      {
        id: "p4",
        value: "待定。",
        meaning: "显式缺口",
        status: "gap",
        links: []
      }
    ]
  });
  writeProjectFile(
    dir,
    "design-system/token.json",
    tokenJsonFixture(["card-edited"])
  );
  writeProjectFile(dir, "design-system/component-list.json", {
    components: [
      {
        id: "component-button",
        value: {
          name: "Button",
          specPath: "design-system/components/button.json"
        },
        meaning: "主按钮",
        status: "candidate",
        links: ["card-edited"]
      }
    ]
  });
  writeProjectFile(dir, "design-system/components/button.json", {
    id: "button-spec",
    name: "Button",
    meaning: "触发主操作",
    status: "candidate",
    links: ["card-edited"],
    value: {
      description: "主操作按钮",
      props: [{ name: "variant", type: "string" }],
      boundaries: ["一个屏幕区域最多一个主按钮"],
      stateMatrix: [{ state: "default", behavior: "主色背景" }]
    }
  });
  writeProjectFile(dir, "design-system/layout-rules.json", {
    rules: [
      {
        id: "layout-1",
        value: "使用 12 列主栅格。",
        meaning: "主栅格",
        status: "candidate",
        links: ["card-edited"]
      }
    ]
  });
  writeProjectFile(dir, "design-system/interaction-rules.json", {
    rules: [
      {
        id: "ix-1",
        value: "待定。",
        meaning: "显式缺口",
        status: "gap",
        links: []
      },
      {
        id: "ix-2",
        value: "Transitions use 150ms ease-out.",
        meaning: "标准过渡",
        status: "candidate",
        links: ["card-edited"]
      }
    ]
  });
}

const SIX_FILES: Array<[string, DesignSystemFileKind]> = [
  ["design-system/design-system.json", "design-system.json"],
  ["design-system/token.json", "token.json"],
  ["design-system/component-list.json", "component-list.json"],
  ["design-system/components/button.json", "component-spec"],
  ["design-system/layout-rules.json", "layout-rules.json"],
  ["design-system/interaction-rules.json", "interaction-rules.json"]
];

function declareFixtures(dir: string) {
  for (const [rel, type] of SIX_FILES) {
    const res = recordSourceArtifact(dir, {
      path: rel,
      artifactType: type,
      semanticPurpose: "09A source",
      relatedRecordIds: ["card-edited"]
    });
    expect(res.ok, type).toBe(true);
  }
}

function seedAndIngest(dir: string) {
  seedEvidenceCards(dir);
  writeApprovalFixtures(dir);
  declareFixtures(dir);
}

function entryRow(dir: string, sourcePath: string, entryId: string) {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    return db
      .prepare(
        `SELECT * FROM design_system_entries
         WHERE source_artifact_path = ? AND entry_id = ?`
      )
      .get(sourcePath, entryId) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
}

function approve(dir: string, sourceArtifactPath: string, entryId: string) {
  return approveDesignSystemEntryCommand(dir, { sourceArtifactPath, entryId });
}

// ---------------------------------------------------------------------------
// Happy path — DB + file consistency, canonical serialization
// ---------------------------------------------------------------------------

describe("approveDesignSystemEntry happy path", () => {
  test("domain-rule approval preserves kind, domain, and value through source write-back and DB view", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeProjectFile(dir, "design-system/token.json", {
        primitive: {},
        semantic: {
          "no-shadow-regions": {
            kind: "domain-rule",
            domain: "shadow",
            value: "Do not use shadows to separate regions; use spacing and borders.",
            meaning: "Keep material treatment flat.",
            status: "candidate",
            links: ["card-edited"]
          }
        },
        component: {}
      });
      const declared = recordSourceArtifact(dir, {
        path: "design-system/token.json",
        artifactType: "token.json",
        semanticPurpose: "09C-D04 domain rule approval fixture",
        relatedRecordIds: ["card-edited"]
      });
      expect(declared.ok).toBe(true);

      const approved = approve(
        dir,
        "design-system/token.json",
        "semantic.no-shadow-regions"
      );
      expect(approved.ok).toBe(true);

      const source = JSON.parse(
        readProjectFile(dir, "design-system/token.json")
      );
      expect(source.semantic["no-shadow-regions"]).toMatchObject({
        kind: "domain-rule",
        domain: "shadow",
        status: "formalized",
        value: "Do not use shadows to separate regions; use spacing and borders."
      });

      const view = getDesignSystemView(dir);
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      expect(view.view.tokens.semantic[0]).toMatchObject({
        kind: "domain-rule",
        domain: "shadow",
        status: "formalized"
      });
    });
  });

  test("DB row and source file both flip candidate → formalized", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);

      const before = entryRow(dir, "design-system/design-system.json", "p1");
      expect(before?.status).toBe("candidate");

      const res = approve(dir, "design-system/design-system.json", "p1");
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.entry).toMatchObject({
        source_artifact_path: "design-system/design-system.json",
        entry_id: "p1",
        status: "formalized"
      });

      // DB row flipped; volatile row uuid unchanged (identity is stable).
      const after = entryRow(dir, "design-system/design-system.json", "p1");
      expect(after?.status).toBe("formalized");
      expect(after?.id).toBe(before?.id);
      expect(after?.updated_at).toBe(res.entry.updated_at);
      expect(after?.created_at).toBe(before?.created_at);

      // Source file flipped at the entry location.
      const json = JSON.parse(
        readProjectFile(dir, "design-system/design-system.json")
      );
      expect(
        json.principles.find((p: { id: string }) => p.id === "p1").status
      ).toBe("formalized");
      // Other entries untouched.
      expect(
        json.principles.find((p: { id: string }) => p.id === "p2").status
      ).toBe("candidate");
      expect(json.visualLanguage.status).toBe("formalized");
    });
  });

  test("write-back is canonical: sorted keys, 2-space indent, trailing newline", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const res = approve(dir, "design-system/design-system.json", "p1");
      expect(res.ok).toBe(true);

      const content = readProjectFile(dir, "design-system/design-system.json");
      expect(content.endsWith("\n")).toBe(true);
      expect(content.endsWith("\n\n")).toBe(false);
      expect(content).toContain('\n  "name"');
      // Byte-identical to re-serializing the parsed content canonically.
      expect(content).toBe(
        `${stableJsonStringify(JSON.parse(content))}\n`
      );
    });
  });

  test("second approval-write produces no diff noise beyond the status flip", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      expect(approve(dir, "design-system/design-system.json", "p1").ok).toBe(
        true
      );
      const afterFirst = readProjectFile(
        dir,
        "design-system/design-system.json"
      );

      expect(approve(dir, "design-system/design-system.json", "p2").ok).toBe(
        true
      );
      const afterSecond = readProjectFile(
        dir,
        "design-system/design-system.json"
      );

      // The second write equals the first file with ONLY p2's status flipped,
      // re-serialized canonically — no reordering/reformat noise.
      const expected = JSON.parse(afterFirst);
      expected.principles.find((p: { id: string }) => p.id === "p2").status =
        "formalized";
      expect(afterSecond).toBe(`${stableJsonStringify(expected)}\n`);
    });
  });

  test("written file round-trips validateDesignSystemJson for its kind", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const approvals: Array<[string, string, DesignSystemFileKind]> = [
        ["design-system/design-system.json", "p1", "design-system.json"],
        ["design-system/token.json", "semantic.color.primary", "token.json"],
        ["design-system/component-list.json", "component-button", "component-list.json"],
        ["design-system/components/button.json", "button-spec", "component-spec"],
        ["design-system/layout-rules.json", "layout-1", "layout-rules.json"],
        ["design-system/interaction-rules.json", "ix-2", "interaction-rules.json"]
      ];
      for (const [rel, entryId, kind] of approvals) {
        const res = approve(dir, rel, entryId);
        expect(res.ok, `${kind} ${entryId}`).toBe(true);
        const json = JSON.parse(readProjectFile(dir, rel));
        const validation = validateDesignSystemJson(kind, json);
        expect(validation.ok, `${kind} re-validation`).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Per-kind write-back location
// ---------------------------------------------------------------------------

describe("per-kind write-back location", () => {
  test("token entry is located inside its nested layer (layer-qualified id)", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const res = approve(dir, "design-system/token.json", "semantic.color.primary");
      expect(res.ok).toBe(true);

      const json = JSON.parse(readProjectFile(dir, "design-system/token.json"));
      expect(json.semantic["color.primary"].status).toBe("formalized");
      // The primitive layer entry with a similar name is untouched.
      expect(json.primitive["color.blue.500"].status).toBe("formalized");

      const row = entryRow(
        dir,
        "design-system/token.json",
        "semantic.color.primary"
      );
      expect(row?.status).toBe("formalized");
      // Alias payload persisted verbatim through the flip.
      expect(JSON.parse(row?.value_json as string)).toEqual({
        alias: "primitive.color.blue.500",
        usage: "语义主色"
      });
    });
  });

  test("array entries are located by id in the remaining four kinds", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);

      expect(
        approve(dir, "design-system/component-list.json", "component-button").ok
      ).toBe(true);
      expect(
        JSON.parse(readProjectFile(dir, "design-system/component-list.json"))
          .components[0].status
      ).toBe("formalized");

      // component-spec: the file root IS the entry.
      expect(
        approve(dir, "design-system/components/button.json", "button-spec").ok
      ).toBe(true);
      expect(
        JSON.parse(readProjectFile(dir, "design-system/components/button.json"))
          .status
      ).toBe("formalized");

      expect(approve(dir, "design-system/layout-rules.json", "layout-1").ok).toBe(
        true
      );
      expect(
        JSON.parse(readProjectFile(dir, "design-system/layout-rules.json"))
          .rules[0].status
      ).toBe("formalized");

      expect(approve(dir, "design-system/interaction-rules.json", "ix-2").ok).toBe(
        true
      );
      const ix = JSON.parse(
        readProjectFile(dir, "design-system/interaction-rules.json")
      );
      expect(
        ix.rules.find((r: { id: string }) => r.id === "ix-2").status
      ).toBe("formalized");
      expect(
        ix.rules.find((r: { id: string }) => r.id === "ix-1").status
      ).toBe("gap");
    });
  });
});

// ---------------------------------------------------------------------------
// Rejections — typed reasons, nothing written
// ---------------------------------------------------------------------------

describe("approval rejections", () => {
  test("unknown entry → not_found (bad id and unknown source path)", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);

      const badId = approve(dir, "design-system/design-system.json", "nope");
      expect(badId.ok).toBe(false);
      if (badId.ok) return;
      expect(badId.reason).toBe("not_found");
      expect(commandErrorHttpStatus(badId.reason)).toBe(404);

      const badPath = approve(dir, "design-system/missing.json", "p1");
      expect(badPath.ok).toBe(false);
      if (badPath.ok) return;
      expect(badPath.reason).toBe("not_found");

      expect(listEvents(dir, "design_system_entry_approved").length).toBe(0);
    });
  });

  test("gap entry → gap_entry_not_approvable; DB and file untouched", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const fileBefore = readProjectFile(
        dir,
        "design-system/interaction-rules.json"
      );

      const res = approve(dir, "design-system/interaction-rules.json", "ix-1");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("gap_entry_not_approvable");

      expect(
        entryRow(dir, "design-system/interaction-rules.json", "ix-1")?.status
      ).toBe("gap");
      expect(
        readProjectFile(dir, "design-system/interaction-rules.json")
      ).toBe(fileBefore);
      expect(listEvents(dir, "design_system_entry_approved").length).toBe(0);
    });
  });

  test("already formalized → already_formalized (rejected, not a no-op)", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);

      // Freshly ingested formalized entry.
      const direct = approve(dir, "design-system/design-system.json", "vl");
      expect(direct.ok).toBe(false);
      if (direct.ok) return;
      expect(direct.reason).toBe("already_formalized");
      expect(commandErrorHttpStatus(direct.reason)).toBe(409);

      // Approving the same candidate twice: second call rejects.
      expect(approve(dir, "design-system/design-system.json", "p1").ok).toBe(
        true
      );
      const second = approve(dir, "design-system/design-system.json", "p1");
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.reason).toBe("already_formalized");

      // Exactly one approval event (the successful one).
      expect(listEvents(dir, "design_system_entry_approved").length).toBe(1);
    });
  });

  test("annotation-only candidate → formalized_requires_designer_edited_link", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const fileBefore = readProjectFile(
        dir,
        "design-system/design-system.json"
      );

      const res = approve(dir, "design-system/design-system.json", "p3");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      // The formalized invariant is enforced AT APPROVAL TIME: a candidate
      // backed only by an Agent annotation cannot be formalized (its own file
      // would fail the next ingest's cross-validation).
      expect(res.reason).toBe("formalized_requires_designer_edited_link");
      expect(res.details).toMatchObject({ links: ["ann-reasonable"] });

      expect(
        entryRow(dir, "design-system/design-system.json", "p3")?.status
      ).toBe("candidate");
      expect(readProjectFile(dir, "design-system/design-system.json")).toBe(
        fileBefore
      );
      expect(listEvents(dir, "design_system_entry_approved").length).toBe(0);
    });
  });

  test("candidate backed by a non-designer-edited answered card is rejected", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      // Rewrite the token file so the semantic candidate links card-accepted
      // (answered, but not designer-edited) — ingest-valid as a candidate,
      // never approvable.
      writeProjectFile(
        dir,
        "design-system/token.json",
        tokenJsonFixture(["card-accepted"])
      );
      expect(
        recordSourceArtifact(dir, {
          path: "design-system/token.json",
          artifactType: "token.json",
          semanticPurpose: "09A source",
          relatedRecordIds: ["card-accepted"]
        }).ok
      ).toBe(true);

      const res = approve(dir, "design-system/token.json", "semantic.color.primary");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("formalized_requires_designer_edited_link");
    });
  });

  test("DB/file drift: entry missing from the source file → entry_not_in_source_file", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      // Someone edits the file on disk and drops p2 without re-declaring.
      const json = JSON.parse(
        readProjectFile(dir, "design-system/design-system.json")
      );
      json.principles = json.principles.filter(
        (p: { id: string }) => p.id !== "p2"
      );
      writeProjectFile(dir, "design-system/design-system.json", json);

      const res = approve(dir, "design-system/design-system.json", "p2");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("entry_not_in_source_file");
      expect(commandErrorHttpStatus(res.reason)).toBe(409);

      // DB row stays candidate; no event.
      expect(
        entryRow(dir, "design-system/design-system.json", "p2")?.status
      ).toBe("candidate");
      expect(listEvents(dir, "design_system_entry_approved").length).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Event log, record bus, derived export
// ---------------------------------------------------------------------------

describe("approval side effects", () => {
  test("semantic event is logged inside the transaction with from/to payload", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const res = approve(dir, "design-system/token.json", "semantic.color.primary");
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const events = listEvents(dir, "design_system_entry_approved");
      expect(events.length).toBe(1);
      expect(events[0].event_id).toBe(res.event_id);
      expect(events[0].payload).toMatchObject({
        source_artifact_path: "design-system/token.json",
        entry_id: "semantic.color.primary",
        from: "candidate",
        to: "formalized"
      });
    });
  });

  test("record bus emits design-system/updated keyed by the source path after commit", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const events: RecordBusEvent[] = [];
      const unsubscribe = subscribeRecordEvents((event) => events.push(event));
      try {
        const res = approve(dir, "design-system/layout-rules.json", "layout-1");
        expect(res.ok).toBe(true);
        expect(events).toEqual([
          expect.objectContaining({
            kind: "design-system",
            action: "updated",
            id: "design-system/layout-rules.json",
            projectPath: path.resolve(dir)
          })
        ]);
      } finally {
        unsubscribe();
      }
    });
  });

  test("derived export is regenerated with the formalized status", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const res = approve(dir, "design-system/layout-rules.json", "layout-1");
      expect(res.ok).toBe(true);

      const outPath = path.join(
        getArtifactsDir(dir),
        "design-system-view.json"
      );
      const parsed = JSON.parse(readFileSync(outPath, "utf-8"));
      expect(parsed.layout[0].entry_id).toBe("layout-1");
      expect(parsed.layout[0].status).toBe("formalized");
    });
  });

  test("approval does NOT re-ingest: no declaration/ingest events, index row untouched", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const declaredBefore = listEvents(dir, "source_artifact_declared").length;
      const viewsBefore = listEvents(dir, "design_system_view_generated").length;

      const res = approve(dir, "design-system/design-system.json", "p1");
      expect(res.ok).toBe(true);

      // Runtime wrote the file itself; the write-back path must not go
      // through recordSourceArtifact (the DB is already consistent).
      expect(listEvents(dir, "source_artifact_declared").length).toBe(
        declaredBefore
      );
      expect(listEvents(dir, "design_system_view_generated").length).toBe(
        viewsBefore
      );
      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        const artifact = db
          .prepare(
            `SELECT declaration_version FROM source_artifacts
             WHERE path = 'design-system/design-system.json'`
          )
          .get() as { declaration_version: number };
        expect(artifact.declaration_version).toBe(1);
      } finally {
        db.close();
      }
    });
  });

  test("export regeneration failure is audited as invalid_output, approval still succeeds", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      // Block the export target with a directory (EISDIR on write) — the
      // ingest already wrote the file, so replace it.
      rmSync(path.join(getArtifactsDir(dir), "design-system-view.json"));
      mkdirSync(path.join(getArtifactsDir(dir), "design-system-view.json"), {
        recursive: true
      });

      const res = approve(dir, "design-system/layout-rules.json", "layout-1");
      expect(res.ok).toBe(true);

      const audit = listEvents(dir, "invalid_output");
      expect(audit.length).toBe(1);
      expect(audit[0].payload).toMatchObject({
        tool: "design_system_view_export",
        reason: "write_failed"
      });
      expect(
        entryRow(dir, "design-system/layout-rules.json", "layout-1")?.status
      ).toBe("formalized");
    });
  });
});

// ---------------------------------------------------------------------------
// Re-ingest after approval keeps the approval (self-consistency)
// ---------------------------------------------------------------------------

describe("post-approval consistency", () => {
  test("re-ingesting the written-back file passes the formalized gate unchanged", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      expect(
        approve(dir, "design-system/design-system.json", "p1").ok
      ).toBe(true);

      // The file Runtime wrote carries p1 as formalized with a designer-edited
      // link, so a later declaration of the same bytes passes its own gate.
      const res = recordSourceArtifact(dir, {
        path: "design-system/design-system.json",
        artifactType: "design-system.json",
        semanticPurpose: "09A source",
        relatedRecordIds: ["card-edited"]
      });
      expect(res.ok).toBe(true);
      expect(
        entryRow(dir, "design-system/design-system.json", "p1")?.status
      ).toBe("formalized");
    });
  });
});

// ---------------------------------------------------------------------------
// Atomicity: restore on DB failure, and the LWW race loser
// ---------------------------------------------------------------------------

describe("atomicity + LWW race", () => {
  test("DB failure after the file write restores the original file bytes", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const fileBefore = readProjectFile(
        dir,
        "design-system/layout-rules.json"
      );

      // Deterministic Phase-3 failure injection: any UPDATE on
      // design_system_entries aborts, so the commit-point transaction throws
      // AFTER the source file has already been written.
      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        db.exec(
          `CREATE TRIGGER fail_entry_update
           BEFORE UPDATE ON design_system_entries
           BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`
        );
      } finally {
        db.close();
      }

      const res = approve(dir, "design-system/layout-rules.json", "layout-1");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("db_error");

      // The original file bytes are restored; the DB row is untouched and no
      // approval event was logged.
      expect(readProjectFile(dir, "design-system/layout-rules.json")).toBe(
        fileBefore
      );
      expect(
        entryRow(dir, "design-system/layout-rules.json", "layout-1")?.status
      ).toBe("candidate");
      expect(listEvents(dir, "design_system_entry_approved").length).toBe(0);
      expect(listEvents(dir, "invalid_output").length).toBe(0);
    });
  });

  test("LWW race loser keeps the winner's formalized bytes and is audited", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);

      // Sequential simulation of the concurrent winner: it lands in the
      // window between our source-file write and our commit, so the
      // in-transaction re-check observes the entry already formalized.
      const res = approveDesignSystemEntry(
        dir,
        {
          sourceArtifactPath: "design-system/layout-rules.json",
          entryId: "layout-1"
        },
        {
          beforeCommit: () => {
            const db = new DatabaseSync(getProjectDbPath(dir));
            try {
              db.prepare(
                `UPDATE design_system_entries
                 SET status = 'formalized', updated_at = ?
                 WHERE source_artifact_path = ? AND entry_id = ?`
              ).run(
                new Date().toISOString(),
                "design-system/layout-rules.json",
                "layout-1"
              );
            } finally {
              db.close();
            }
          }
        }
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("already_formalized");

      // The loser must NOT restore its pre-write bytes over the winner's —
      // the file keeps the canonical formalized content.
      const json = JSON.parse(
        readProjectFile(dir, "design-system/layout-rules.json")
      );
      expect(json.rules[0].status).toBe("formalized");

      // LWW conflict visibility (09A decision 8): the losing approval is
      // audited; no design_system_entry_approved event for the loser.
      const audit = listEvents(dir, "invalid_output");
      expect(audit.length).toBe(1);
      expect(audit[0].payload).toMatchObject({
        tool: "approve_design_system_entry",
        reason: "already_formalized",
        details: {
          source_artifact_path: "design-system/layout-rules.json",
          entry_id: "layout-1"
        }
      });
      expect(listEvents(dir, "design_system_entry_approved").length).toBe(0);
    });
  });
});
