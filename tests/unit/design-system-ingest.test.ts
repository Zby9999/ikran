// Unit tests for design-system DB ingest + Browser read view + derived
// export (Issue 09 / 09A, Task C). The DB is the Runtime truth; ingest is
// replace-by-source inside the declaration transaction with the 09A
// decision-4 status cross-validation as a hard gate.

import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";

import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import {
  getDesignSystemView,
  writeDesignSystemViewExport
} from "../../lib/runtime/design-system-view";
import {
  getDesignSystemComponentCommand,
  getDesignSystemViewCommand
} from "../../lib/runtime/commands";
import { listEvents } from "../../lib/runtime/events";
import { initializeProjectDb } from "../../lib/runtime/db";
import { getArtifactsDir, getProjectDbPath } from "../../lib/runtime/paths";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { createRegionAnnotation } from "../../lib/runtime/region-annotation";
import {
  subscribeRecordEvents,
  resetRecordBusForTests,
  type RecordBusEvent
} from "../../lib/runtime/record-bus";

const VALID_FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-ds-ingest-"));
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

// A real seed + evidence surface: the alignment snapshot resolves every
// persisted annotation anchor against these rows, so seeded Agent
// annotations must carry a valid anchor (08A snapshot surface).
function seedSurface(dir: string): { seedId: string; surfaceId: string } {
  const seed = registerSeedReference(dir, {
    figmaSeedReference: VALID_FIGMA,
    originalDesignIntent: "ingest fixture"
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

function declareFile(
  dir: string,
  rel: string,
  artifactType: string,
  relatedRecordIds: string[] = ["card-edited"]
) {
  return recordSourceArtifact(dir, {
    path: rel,
    artifactType,
    semanticPurpose: "09A source",
    relatedRecordIds
  });
}

// Full 09A six-file set: formalized entries back onto card-edited,
// candidates onto card-accepted / ann-reasonable, gaps link nothing.
function writeSixFiles(dir: string) {
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
        value: { statement: "少即是多" },
        meaning: "克制",
        status: "candidate",
        links: ["card-accepted"]
      },
      {
        id: "p2",
        value: { statement: "待定" },
        meaning: "尚未确认的原则",
        status: "gap",
        links: []
      }
    ]
  });
  writeProjectFile(dir, "design-system/token.json", {
    primitive: {
      "color.blue.500": {
        value: "#3b82f6",
        meaning: "品牌主色",
        status: "formalized",
        links: ["card-edited"]
      }
    },
    semantic: {
      "color.primary": {
        value: { alias: "primitive.color.blue.500" },
        meaning: "语义主色",
        status: "candidate",
        links: ["ann-reasonable"]
      }
    },
    component: {}
  });
  writeProjectFile(dir, "design-system/component-list.json", {
    components: [
      {
        id: "component-button",
        value: { name: "Button", specPath: "design-system/components/button.json" },
        meaning: "主按钮",
        status: "candidate",
        links: ["ann-reasonable"]
      }
    ]
  });
  writeProjectFile(dir, "design-system/components/button.json", {
    id: "button-spec",
    name: "Button",
    meaning: "触发主操作",
    status: "candidate",
    links: ["card-accepted"],
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
        value: { rule: "12 列主栅格" },
        meaning: "主栅格",
        status: "formalized",
        links: ["card-edited"]
      }
    ]
  });
  writeProjectFile(dir, "design-system/interaction-rules.json", {
    rules: [
      {
        id: "ix-1",
        value: { rule: "150ms ease-out" },
        meaning: "标准过渡",
        status: "gap",
        links: []
      }
    ]
  });
}

function declareSixFiles(dir: string) {
  const files: Array<[string, string]> = [
    ["design-system/design-system.json", "design-system.json"],
    ["design-system/token.json", "token.json"],
    ["design-system/component-list.json", "component-list.json"],
    ["design-system/components/button.json", "component-spec"],
    ["design-system/layout-rules.json", "layout-rules.json"],
    ["design-system/interaction-rules.json", "interaction-rules.json"]
  ];
  for (const [rel, type] of files) {
    const res = declareFile(dir, rel, type);
    expect(res.ok, type).toBe(true);
  }
}

function entryRows(
  dir: string,
  where = ""
): Array<Record<string, unknown>> {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    return db
      .prepare(`SELECT * FROM design_system_entries ${where}`)
      .all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Ingest happy path + replace-by-source
// ---------------------------------------------------------------------------

describe("design-system ingest", () => {
  test("full six-file set ingests into DB rows grouped by section", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeSixFiles(dir);
      declareSixFiles(dir);

      const rows = entryRows(dir);
      // 3 foundations (visual language + 2 principles) + 2 tokens
      // + 1 inventory + 1 spec + 1 layout + 1 interaction
      expect(rows.length).toBe(9);
      const sections = rows.map((r) => r.section).sort();
      expect(sections).toEqual([
        "components.inventory",
        "components.spec",
        "foundations.principles",
        "foundations.principles",
        "foundations.visual-language",
        "interaction",
        "layout",
        "token.primitive",
        "token.semantic"
      ]);

      // Index rows are marked ingested (Task A reserved status column).
      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        const artifacts = db
          .prepare("SELECT status FROM source_artifacts")
          .all() as Array<{ status: string }>;
        expect(artifacts.map((a) => a.status)).toEqual(
          Array(6).fill("ingested")
        );
        const meta = db
          .prepare("SELECT name FROM design_system_meta WHERE singleton = 1")
          .get() as { name: string };
        expect(meta.name).toBe("Test DS");
      } finally {
        db.close();
      }

      // Event semantics: draft fires once (first content ingest), the view
      // event fires per ingested file.
      expect(listEvents(dir, "draft_design_system_generated").length).toBe(1);
      expect(listEvents(dir, "design_system_view_generated").length).toBe(6);
      expect(listEvents(dir, "invalid_artifact").length).toBe(0);
    });
  });

  test("re-ingest of a file replaces its entries (no duplicates, removals stick)", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeProjectFile(dir, "design-system/token.json", {
        primitive: {
          "color.blue.500": {
            value: "#3b82f6",
            meaning: "品牌主色",
            status: "formalized",
            links: ["card-edited"]
          },
          "space.4": {
            value: "16px",
            meaning: "基础间距",
            status: "candidate",
            links: ["card-accepted"]
          }
        },
        semantic: {},
        component: {}
      });
      expect(
        declareFile(dir, "design-system/token.json", "token.json").ok
      ).toBe(true);
      expect(entryRows(dir).length).toBe(2);

      // Rewrite: change one value, drop the other token.
      writeProjectFile(dir, "design-system/token.json", {
        primitive: {
          "color.blue.500": {
            value: "#1d4ed8",
            meaning: "品牌主色(深)",
            status: "formalized",
            links: ["card-edited"]
          }
        },
        semantic: {},
        component: {}
      });
      const res = declareFile(dir, "design-system/token.json", "token.json");
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.declaration_version).toBe(2);

      const rows = entryRows(dir);
      expect(rows.length).toBe(1);
      expect(rows[0].entry_id).toBe("primitive.color.blue.500");
      expect(JSON.parse(rows[0].value_json as string)).toBe("#1d4ed8");
      // Replace-by-source does not duplicate the draft/view events per row.
      expect(listEvents(dir, "design_system_view_generated").length).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// 09A decision 4 hard gate at ingest
// ---------------------------------------------------------------------------

describe("ingest cross-validation gate", () => {
  test("formalized spoof (no designer-edited link) rejected: invalid_artifact + nothing persisted", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeProjectFile(dir, "design-system/token.json", {
        primitive: {
          "color.blue.500": {
            value: "#3b82f6",
            meaning: "冒充正式的主色",
            status: "formalized",
            links: ["card-accepted"] // answered, but NOT designer-edited
          }
        },
        semantic: {},
        component: {}
      });

      const res = declareFile(dir, "design-system/token.json", "token.json");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("formalized_requires_designer_edited_link");

      const invalid = listEvents(dir, "invalid_artifact");
      expect(invalid.length).toBe(1);
      expect(invalid[0].payload).toMatchObject({
        tool: "record_artifact_written",
        reason: "formalized_requires_designer_edited_link",
        details: {
          path: "design-system/token.json",
          entry_id: "primitive.color.blue.500"
        }
      });

      // Hard gate: no entries, no index row, no ingest events.
      expect(entryRows(dir).length).toBe(0);
      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        expect(
          (db.prepare("SELECT COUNT(*) AS c FROM source_artifacts").get() as {
            c: number;
          }).c
        ).toBe(0);
      } finally {
        db.close();
      }
      expect(listEvents(dir, "source_artifact_declared").length).toBe(0);
      expect(listEvents(dir, "design_system_view_generated").length).toBe(0);
    });
  });

  test("rejected re-ingest leaves previously ingested rows intact (no delete-on-reject)", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeProjectFile(dir, "design-system/token.json", {
        primitive: {
          "color.blue.500": {
            value: "#3b82f6",
            meaning: "品牌主色",
            status: "formalized",
            links: ["card-edited"]
          }
        },
        semantic: {},
        component: {}
      });
      expect(
        declareFile(dir, "design-system/token.json", "token.json").ok
      ).toBe(true);
      expect(entryRows(dir).length).toBe(1);

      // Re-declare the same file with content that now FAILS the gate.
      writeProjectFile(dir, "design-system/token.json", {
        primitive: {
          "color.blue.500": {
            value: "#3b82f6",
            meaning: "品牌主色",
            status: "formalized",
            links: ["card-accepted"] // spoof: no designer-edited backing
          }
        },
        semantic: {},
        component: {}
      });
      const res = declareFile(dir, "design-system/token.json", "token.json");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("formalized_requires_designer_edited_link");

      // The previously ingested rows survive untouched — the gate runs
      // before any write, so delete-by-source never executes on rejection.
      const rows = entryRows(dir);
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe("formalized");
      expect(JSON.parse(rows[0].links_json as string)).toEqual(["card-edited"]);

      // Nothing new persisted: no second ingest/declaration events, no
      // index-row version bump; exactly one invalid_artifact audit event.
      expect(listEvents(dir, "design_system_view_generated").length).toBe(1);
      expect(listEvents(dir, "source_artifact_declared").length).toBe(1);
      expect(listEvents(dir, "invalid_artifact").length).toBe(1);
      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        const artifact = db
          .prepare(
            "SELECT declaration_version, status FROM source_artifacts"
          )
          .get() as { declaration_version: number; status: string };
        expect(artifact.declaration_version).toBe(1);
        expect(artifact.status).toBe("ingested");
      } finally {
        db.close();
      }
    });
  });

  test("candidate via reasonable annotation accepted; gap accepted", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeProjectFile(dir, "design-system/layout-rules.json", {
        rules: [
          {
            id: "layout-1",
            value: { rule: "12 列" },
            meaning: "annotation 支撑的候选",
            status: "candidate",
            links: ["ann-reasonable"]
          },
          {
            id: "layout-2",
            value: { rule: "待定" },
            meaning: "显式缺口",
            status: "gap",
            links: []
          }
        ]
      });
      const res = declareFile(dir, "design-system/layout-rules.json", "layout-rules.json");
      expect(res.ok).toBe(true);

      const rows = entryRows(dir, "ORDER BY position ASC");
      expect(rows.map((r) => r.status)).toEqual(["candidate", "gap"]);
    });
  });

  test("global entry-id uniqueness inside design-system.json is enforced at ingest", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeProjectFile(dir, "design-system/design-system.json", {
        name: "Test DS",
        visualLanguage: {
          id: "shared-id",
          value: { description: "叙述" },
          meaning: "视觉语言",
          status: "candidate",
          links: ["card-accepted"]
        },
        principles: [
          {
            id: "shared-id",
            value: { statement: "碰撞" },
            meaning: "与 visualLanguage 撞 id",
            status: "candidate",
            links: ["card-accepted"]
          }
        ]
      });

      const res = declareFile(dir, "design-system/design-system.json", "design-system.json");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("duplicate_entry_id");

      const invalid = listEvents(dir, "invalid_artifact");
      expect(invalid.length).toBe(1);
      expect(invalid[0].payload).toMatchObject({
        reason: "duplicate_entry_id",
        details: { entry_id: "shared-id" }
      });
      expect(entryRows(dir).length).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Derived export
// ---------------------------------------------------------------------------

describe("design-system-view.json derived export", () => {
  test("export is written under .ikran/artifacts with deterministic content", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeSixFiles(dir);
      declareSixFiles(dir);

      const outPath = path.join(
        getArtifactsDir(dir),
        "design-system-view.json"
      );
      expect(existsSync(outPath)).toBe(true);
      const first = readFileSync(outPath, "utf-8");
      const parsed = JSON.parse(first);
      expect(parsed.name).toBe("Test DS");
      expect(parsed.foundations.principles.length).toBe(2);
      expect(parsed.tokens.semantic[0].alias).toBe(
        "primitive.color.blue.500"
      );
      // Volatile fields are stripped so exports do not diff-noise.
      expect(parsed.generated_at).toBeUndefined();
      expect(parsed.tokens.semantic[0].id).toBeUndefined();

      // Re-ingesting identical content yields identical bytes.
      expect(
        declareFile(dir, "design-system/token.json", "token.json").ok
      ).toBe(true);
      expect(readFileSync(outPath, "utf-8")).toBe(first);
    });
  });

  test("export builds from an empty DB view before any ingest", () => {
    withTempProject((dir) => {
      // No ingest yet: export still builds from an empty DB view.
      const res = writeDesignSystemViewExport(dir);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.path.endsWith("design-system-view.json")).toBe(true);
    });
  });

  test("post-commit export failure logs invalid_output audit and keeps the declaration", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      // Block the export target with a directory so the write fails (EISDIR)
      // — deterministic without relying on filesystem permissions.
      mkdirSync(
        path.join(getArtifactsDir(dir), "design-system-view.json"),
        { recursive: true }
      );
      writeProjectFile(dir, "design-system/token.json", {
        primitive: {
          "color.blue.500": {
            value: "#3b82f6",
            meaning: "品牌主色",
            status: "formalized",
            links: ["card-edited"]
          }
        },
        semantic: {},
        component: {}
      });

      // The ingest commits first; the export is derived, so its failure must
      // not affect the declaration result or the ingested rows.
      const res = declareFile(dir, "design-system/token.json", "token.json");
      expect(res.ok).toBe(true);
      expect(entryRows(dir).length).toBe(1);

      const audit = listEvents(dir, "invalid_output");
      expect(audit.length).toBe(1);
      expect(audit[0].payload).toMatchObject({
        tool: "design_system_view_export",
        reason: "write_failed"
      });
      expect(listEvents(dir, "invalid_artifact").length).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Browser read view — real-time evidence-chain join
// ---------------------------------------------------------------------------

describe("getDesignSystemView evidence join", () => {
  test("cards / annotations / evidence versions / designer annotations join per entry", () => {
    withTempProject((dir) => {
      const { seedId, surfaceId } = seedSurface(dir);
      insertCard(dir, {
        id: "card-edited",
        finalAnswer: "主色用蓝",
        answerSource: "designer-edited",
        anchorJson: surfaceAnchorJson(seedId, surfaceId)
      });

      const designer = createRegionAnnotation(dir, {
        target: { kind: "figma-surface", evidenceVersionId: surfaceId },
        author: "designer",
        body: "保持低饱和",
        section: "visual-language"
      });
      if (!designer.ok) throw new Error(`annotation failed: ${designer.reason}`);

      writeProjectFile(dir, "design-system/token.json", {
        primitive: {
          "color.blue.500": {
            value: "#3b82f6",
            meaning: "品牌主色",
            status: "formalized",
            links: ["card-edited", "forged-link"]
          }
        },
        semantic: {},
        component: {}
      });
      expect(
        declareFile(dir, "design-system/token.json", "token.json").ok
      ).toBe(true);

      const result = getDesignSystemViewCommand(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const entry = result.view.tokens.primitive[0];
      expect(entry.entry_id).toBe("primitive.color.blue.500");

      expect(entry.evidence.question_cards).toEqual([
        expect.objectContaining({
          id: "card-edited",
          final_answer: "主色用蓝",
          answer_source: "designer-edited"
        })
      ]);
      expect(entry.evidence.evidence_versions).toEqual([
        expect.objectContaining({ id: surfaceId, frame_name: "Checkout" })
      ]);
      expect(entry.evidence.designer_annotations).toEqual([
        expect.objectContaining({
          body: "保持低饱和",
          evidence_version_id: surfaceId
        })
      ]);
      // Forged links are surfaced, never silently dropped.
      expect(entry.evidence.unresolved_links).toEqual(["forged-link"]);
    });
  });

  test("annotation-backed entry joins the Agent annotation", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeProjectFile(dir, "design-system/token.json", {
        primitive: {
          "color.blue.500": {
            value: "#3b82f6",
            meaning: "品牌主色",
            status: "formalized",
            links: ["card-edited"]
          }
        },
        semantic: {
          "color.primary": {
            value: { alias: "primitive.color.blue.500" },
            meaning: "语义主色",
            status: "candidate",
            links: ["ann-reasonable"]
          }
        },
        component: {}
      });
      expect(
        declareFile(dir, "design-system/token.json", "token.json").ok
      ).toBe(true);

      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const entry = result.view.tokens.semantic[0];
      expect(entry.alias).toBe("primitive.color.blue.500");
      expect(entry.evidence.annotations).toEqual([
        expect.objectContaining({ id: "ann-reasonable", inference: "reasonable" })
      ]);
    });
  });

  test("empty project yields an empty view, not an error", () => {
    withTempProject((dir) => {
      const result = getDesignSystemView(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.view.name).toBe("");
      expect(result.view.foundations.principles).toEqual([]);
      expect(result.view.components.inventory).toEqual([]);
    });
  });
});

describe("getDesignSystemComponentCommand", () => {
  test("inventory id resolves inventory + spec via specPath; unknown id → not_found", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeSixFiles(dir);
      declareSixFiles(dir);

      const detail = getDesignSystemComponentCommand(dir, "component-button");
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.component.inventory?.name).toBe("Button");
      expect(detail.component.spec?.entry_id).toBe("button-spec");
      const specValue = detail.component.spec?.value as {
        boundaries: string[];
        stateMatrix: Array<{ state: string }>;
      };
      expect(specValue.boundaries).toEqual(["一个屏幕区域最多一个主按钮"]);
      expect(specValue.stateMatrix[0].state).toBe("default");

      const missing = getDesignSystemComponentCommand(dir, "nope");
      expect(missing.ok).toBe(false);
      if (missing.ok) return;
      expect(missing.reason).toBe("not_found");
    });
  });
});

// ---------------------------------------------------------------------------
// Record-bus invalidation
// ---------------------------------------------------------------------------

describe("record-bus emission", () => {
  test("successful ingest emits artifact + design-system invalidations after commit", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeProjectFile(dir, "design-system/token.json", {
        primitive: {},
        semantic: {},
        component: {}
      });
      const events: RecordBusEvent[] = [];
      const unsubscribe = subscribeRecordEvents((event) => events.push(event));
      try {
        const res = declareFile(dir, "design-system/token.json", "token.json");
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(events.map((e) => e.kind)).toEqual([
          "artifact",
          "design-system"
        ]);
        // Identity is the canonical project-relative path; first ingest of
        // that path is "created".
        expect(events[1]).toMatchObject({
          action: "created",
          id: "design-system/token.json",
          projectPath: path.resolve(dir)
        });
      } finally {
        unsubscribe();
      }
    });
  });

  test("rejected ingest emits no design-system invalidation", () => {
    withTempProject((dir) => {
      seedEvidenceCards(dir);
      writeProjectFile(dir, "design-system/token.json", {
        primitive: {
          "color.blue.500": {
            value: "#3b82f6",
            meaning: "冒充",
            status: "formalized",
            links: ["card-accepted"]
          }
        },
        semantic: {},
        component: {}
      });
      const events: RecordBusEvent[] = [];
      const unsubscribe = subscribeRecordEvents((event) => events.push(event));
      try {
        const res = declareFile(dir, "design-system/token.json", "token.json");
        expect(res.ok).toBe(false);
        expect(events).toEqual([]);
      } finally {
        unsubscribe();
      }
    });
  });
});
