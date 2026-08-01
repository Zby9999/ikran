// Unit tests for design-system source JSON schemas (Issue 09 / 09A, Task B).
// Pure Node — no MCP/Next. Validators check structure only, never prose
// content quality.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, expect } from "vitest";
import {
  validateDesignSystemJson,
  collectStatusEntries
} from "../../lib/runtime/design-system-schema";
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import { listEvents } from "../../lib/runtime/events";
import { initializeProjectDb } from "../../lib/runtime/db";
import { getProjectDbPath } from "../../lib/runtime/paths";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    value: { statement: "保持界面克制" },
    meaning: "少即是多",
    status: "formalized",
    links: ["card-1"],
    ...overrides
  };
}

function validDesignSystemJson() {
  return {
    name: "Recursive Design System",
    visualLanguage: {
      id: "visual-language",
      value: { description: "整体视觉语言偏向冷静、低饱和的工程感。" },
      meaning: "项目级视觉语言叙述",
      status: "candidate",
      links: ["card-1"]
    },
    principles: [
      entry({ id: "principle-1" }),
      entry({ id: "principle-2", status: "gap", links: [], value: { statement: "待定" } })
    ]
  };
}

function validTokenJson(): {
  primitive: Record<string, Record<string, unknown>>;
  semantic: Record<string, Record<string, unknown>>;
  component: Record<string, Record<string, unknown>>;
} {
  return {
    primitive: {
      "color.blue.500": {
        value: "#3b82f6",
        meaning: "品牌主色",
        status: "formalized",
        links: ["card-1"]
      },
      "space.4": {
        value: "16px",
        meaning: "基础间距",
        status: "candidate",
        links: ["card-1"]
      }
    },
    semantic: {
      "color.primary": {
        value: { alias: "primitive.color.blue.500" },
        meaning: "语义主色",
        status: "formalized",
        links: ["card-1"]
      }
    },
    component: {
      "button.bg": {
        value: { alias: "semantic.color.primary" },
        meaning: "按钮背景",
        status: "candidate",
        links: ["card-1"]
      },
      // Layer skip: component may alias primitive directly.
      "button.padding": {
        value: { alias: "primitive.space.4" },
        meaning: "按钮内边距",
        status: "gap",
        links: []
      }
    }
  };
}

function validComponentListJson() {
  return {
    components: [
      {
        id: "component-button",
        value: { name: "Button", specPath: "components/button.json" },
        meaning: "主按钮",
        status: "formalized",
        links: ["card-1"]
      }
    ]
  };
}

function validComponentSpec() {
  return {
    id: "component-button",
    name: "Button",
    value: {
      description: "主操作按钮",
      props: [
        { name: "variant", type: "string", meaning: "视觉变体", default: "primary" }
      ],
      boundaries: ["一个屏幕区域最多一个主按钮"],
      stateMatrix: [
        { state: "default", behavior: "主色背景" },
        { state: "disabled", behavior: "降透明度,不可点击" }
      ]
    },
    meaning: "触发主操作",
    status: "formalized",
    links: ["card-1"]
  };
}

function validRulesJson() {
  return {
    rules: [
      {
        id: "layout-1",
        value: { rule: "页面主栅格为 12 列", category: "grid" },
        meaning: "主栅格",
        status: "candidate",
        links: ["card-1"]
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// Temp-project helpers (registry wiring tests only)
// ---------------------------------------------------------------------------

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-ds-schema-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeProjectFile(dir: string, rel: string, content: unknown) {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    typeof content === "string" ? content : JSON.stringify(content)
  );
}

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

// ---------------------------------------------------------------------------
// Shared entry contract
// ---------------------------------------------------------------------------

test.describe("shared entry contract", () => {
  test("wrong status value → invalid_status", () => {
    const res = validateDesignSystemJson("layout-rules.json", {
      rules: [entry({ status: "locked" })]
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_status");
  });

  test("missing meaning → missing_required_field", () => {
    const res = validateDesignSystemJson("layout-rules.json", {
      rules: [entry({ meaning: "  " })]
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_required_field");
  });

  test("gap entry with links → gap_must_not_link", () => {
    const res = validateDesignSystemJson("layout-rules.json", {
      rules: [entry({ status: "gap", links: ["card-1"] })]
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("gap_must_not_link");
  });

  test("non-gap entry without links → entry_links_required", () => {
    for (const status of ["formalized", "candidate"]) {
      const res = validateDesignSystemJson("layout-rules.json", {
        rules: [entry({ status, links: [] })]
      });
      expect(res.ok, status).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe("entry_links_required");
    }
  });

  test("duplicate entry ids → duplicate_entry_id", () => {
    const res = validateDesignSystemJson("layout-rules.json", {
      rules: [entry({ id: "dup" }), entry({ id: "dup" })]
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("duplicate_entry_id");
  });

  test("top level not an object → invalid_design_system_json", () => {
    for (const input of [null, [1, 2], "x", 42]) {
      const res = validateDesignSystemJson("layout-rules.json", input);
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe("invalid_design_system_json");
    }
  });
});

// ---------------------------------------------------------------------------
// design-system.json
// ---------------------------------------------------------------------------

test.describe("design-system.json", () => {
  test("valid file (principles + visual language prose as JSON string)", () => {
    const res = validateDesignSystemJson(
      "design-system.json",
      validDesignSystemJson()
    );
    expect(res.ok).toBe(true);
  });

  test("missing name / visualLanguage / principles → missing_required_field", () => {
    const valid = validDesignSystemJson();
    for (const field of ["name", "visualLanguage", "principles"] as const) {
      const broken = { ...valid, [field]: undefined };
      const res = validateDesignSystemJson("design-system.json", broken);
      expect(res.ok, field).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe("missing_required_field");
    }
  });

  test("principle value must carry a statement string", () => {
    const res = validateDesignSystemJson("design-system.json", {
      ...validDesignSystemJson(),
      principles: [entry({ value: {} })]
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_required_field");
  });

  test("09B principle detail fields have stable string/array shapes", () => {
    const rich = validDesignSystemJson();
    Object.assign(rich.principles[0].value, {
      rationale: "Preserve editorial hierarchy.",
      scope: "Product surfaces",
      use: ["Large display type"],
      avoid: ["Competing emphasis"],
      exceptions: []
    });
    expect(validateDesignSystemJson("design-system.json", rich).ok).toBe(true);

    const invalid = validDesignSystemJson();
    Object.assign(invalid.principles[0].value, { use: "everywhere" });
    expect(
      validateDesignSystemJson("design-system.json", invalid)
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: { field: "value.use", expected: "array" }
    });
  });

  test("visual language value must carry a description string", () => {
    const res = validateDesignSystemJson("design-system.json", {
      ...validDesignSystemJson(),
      visualLanguage: {
        ...validDesignSystemJson().visualLanguage,
        value: { description: 42 }
      }
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_field_type");
  });
});

// ---------------------------------------------------------------------------
// token.json — 3 layers + alias graph
// ---------------------------------------------------------------------------

test.describe("token.json", () => {
  test("valid 3-layer file incl. component → primitive layer skip", () => {
    const res = validateDesignSystemJson("token.json", validTokenJson());
    expect(res.ok).toBe(true);
  });

  test("accepts a declared token domain and rejects unknown domains", () => {
    const valid = validTokenJson();
    valid.primitive["color.blue.500"].domain = "color";
    expect(validateDesignSystemJson("token.json", valid).ok).toBe(true);

    const invalid = validTokenJson();
    invalid.primitive["color.blue.500"].domain = "marketing";
    const result = validateDesignSystemJson("token.json", invalid);
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_token_domain",
      details: { token: "primitive.color.blue.500", domain: "marketing" }
    });
  });

  test("missing a layer → missing_required_field", () => {
    const res = validateDesignSystemJson("token.json", { primitive: {} });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_required_field");
  });

  test("dangling alias → token_alias_unresolvable", () => {
    const json = validTokenJson();
    json.semantic["color.primary"].value = { alias: "primitive.color.nope" };
    const res = validateDesignSystemJson("token.json", json);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("token_alias_unresolvable");
  });

  test("alias without layer prefix → token_alias_unresolvable", () => {
    const json = validTokenJson();
    json.semantic["color.primary"].value = { alias: "color.blue.500" };
    const res = validateDesignSystemJson("token.json", json);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("token_alias_unresolvable");
  });

  test("forward-layer alias (semantic → component) → token_alias_invalid_layer", () => {
    const json = validTokenJson();
    json.semantic["color.primary"].value = { alias: "component.button.bg" };
    const res = validateDesignSystemJson("token.json", json);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("token_alias_invalid_layer");
  });

  test("primitive entry as alias → token_primitive_alias", () => {
    const json = validTokenJson();
    json.primitive["color.blue.500"].value = { alias: "primitive.space.4" };
    const res = validateDesignSystemJson("token.json", json);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("token_primitive_alias");
  });

  test("mixed object combining alias with content keys → token_alias_reserved_key", () => {
    const json = validTokenJson();
    json.semantic["color.primary"].value = {
      alias: "primitive.color.blue.500",
      fallback: "#3b82f6"
    };
    const res = validateDesignSystemJson("token.json", json);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("token_alias_reserved_key");
    expect(res.details).toMatchObject({
      keys: ["alias", "fallback"]
    });

    // A pure alias object with a non-string target stays invalid_field_type.
    const bad = validTokenJson();
    bad.semantic["color.primary"].value = { alias: 42 };
    const badRes = validateDesignSystemJson("token.json", bad);
    expect(badRes.ok).toBe(false);
    if (badRes.ok) return;
    expect(badRes.reason).toBe("invalid_field_type");
  });

  test("self-cycle → token_alias_cycle with offending path", () => {
    const json = validTokenJson();
    json.semantic["color.primary"].value = { alias: "semantic.color.primary" };
    const res = validateDesignSystemJson("token.json", json);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("token_alias_cycle");
    expect(res.details).toMatchObject({
      path: ["semantic.color.primary", "semantic.color.primary"]
    });
  });

  test("multi-node cycle → token_alias_cycle with offending path", () => {
    const json = validTokenJson();
    json.component["button.bg"].value = { alias: "component.button.fg" };
    json.component["button.fg"] = {
      value: { alias: "component.button.bg" },
      meaning: "按钮前景",
      status: "candidate",
      links: ["card-1"]
    };
    const res = validateDesignSystemJson("token.json", json);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("token_alias_cycle");
    const cyclePath = (res.details as { path: string[] }).path;
    expect(cyclePath.length).toBe(3);
    expect(cyclePath[0]).toBe(cyclePath[2]);
    expect(new Set(cyclePath)).toEqual(
      new Set(["component.button.bg", "component.button.fg"])
    );
  });

  test("same-layer chain without cycle is allowed", () => {
    const json = validTokenJson();
    json.semantic["color.accent"] = {
      value: { alias: "semantic.color.primary" },
      meaning: "强调色",
      status: "candidate",
      links: ["card-1"]
    };
    const res = validateDesignSystemJson("token.json", json);
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// component-list.json
// ---------------------------------------------------------------------------

test.describe("component-list.json", () => {
  test("valid file", () => {
    const res = validateDesignSystemJson(
      "component-list.json",
      validComponentListJson()
    );
    expect(res.ok).toBe(true);
  });

  test("missing components array → missing_required_field", () => {
    const res = validateDesignSystemJson("component-list.json", {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_required_field");
  });

  test("component entry value needs name + specPath", () => {
    const res = validateDesignSystemJson("component-list.json", {
      components: [
        {
          id: "c1",
          value: { name: "Button" },
          meaning: "m",
          status: "candidate",
          links: ["card-1"]
        }
      ]
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_required_field");
  });
});

// ---------------------------------------------------------------------------
// components/<name>.json (component-spec)
// ---------------------------------------------------------------------------

test.describe("component-spec", () => {
  test("valid spec with boundaries + state matrix", () => {
    const res = validateDesignSystemJson("component-spec", validComponentSpec());
    expect(res.ok).toBe(true);
  });

  test("missing boundaries / stateMatrix → missing_required_field", () => {
    for (const field of ["boundaries", "stateMatrix"] as const) {
      const value = { ...validComponentSpec().value, [field]: undefined };
      const res = validateDesignSystemJson("component-spec", {
        ...validComponentSpec(),
        value
      });
      expect(res.ok, field).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe("missing_required_field");
    }
  });

  test("state matrix rows need a state name", () => {
    const res = validateDesignSystemJson("component-spec", {
      ...validComponentSpec(),
      value: {
        ...validComponentSpec().value,
        stateMatrix: [{ behavior: "no state name" }]
      }
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_required_field");
  });

  test("boundaries must be non-empty strings", () => {
    const res = validateDesignSystemJson("component-spec", {
      ...validComponentSpec(),
      value: { ...validComponentSpec().value, boundaries: [""] }
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_field_type");
  });

  test("09B component detail groups use stable array shapes when present", () => {
    const rich = validComponentSpec();
    Object.assign(rich.value, {
      anatomy: [{ part: "label" }, { part: "icon" }],
      variants: [{ name: "text-link" }],
      sizes: [{ name: "default" }],
      tokenLinks: ["semantic.text.action"],
      usageRules: ["Use for a single inline CTA."],
      contentRules: ["Pair a short label with an arrow."],
      responsiveBehavior: ["Preserve inline flow."],
      codeLinks: ["components/TextLink.tsx"],
      verificationTargets: ["No filled background."],
      openGaps: []
    });
    expect(validateDesignSystemJson("component-spec", rich).ok).toBe(true);

    const invalid = validComponentSpec();
    Object.assign(invalid.value, { anatomy: { part: "label" } });
    expect(
      validateDesignSystemJson("component-spec", invalid)
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: { field: "value.anatomy", expected: "array" }
    });
  });
});

// ---------------------------------------------------------------------------
// layout-rules.json / interaction-rules.json
// ---------------------------------------------------------------------------

test.describe("layout-rules.json / interaction-rules.json", () => {
  test("valid files", () => {
    expect(
      validateDesignSystemJson("layout-rules.json", validRulesJson()).ok
    ).toBe(true);
    expect(
      validateDesignSystemJson("interaction-rules.json", {
        rules: [entry({ value: { statement: "Motion stays quiet" } })]
      }).ok
    ).toBe(true);
  });

  test("rule value must be a plain object", () => {
    for (const badValue of [[1, 2], "text", 7]) {
      const res = validateDesignSystemJson("layout-rules.json", {
        rules: [entry({ value: badValue })]
      });
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe("invalid_field_type");
    }
  });

  test("D01 interaction strategies use description, behavior, and accessibility", () => {
    const layout = validRulesJson();
    Object.assign(layout.rules[0].value, {
      relationship: [{ from: "title", to: "content" }],
      responsiveBehavior: ["Preserve hierarchy"],
      tokenLinks: ["spacing.section"],
      acceptanceChecks: ["Title remains dominant"]
    });
    expect(validateDesignSystemJson("layout-rules.json", layout).ok).toBe(true);

    const interaction = {
      rules: [
        entry({
          value: {
            statement: "Motion stays quiet",
            description: "Feedback explains change without competing with content.",
            behavior: ["Use short state feedback."],
            accessibility: ["Preserve the same information without motion."]
          }
        })
      ]
    };
    expect(
      validateDesignSystemJson("interaction-rules.json", interaction).ok
    ).toBe(true);

    const invalid = {
      rules: [
        entry({
          value: {
            statement: "Keep focus visible",
            accessibility: "visible focus"
          }
        })
      ]
    };
    expect(
      validateDesignSystemJson("interaction-rules.json", invalid)
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: { field: "value.accessibility", expected: "array" }
    });

    const componentBound = {
      rules: [
        entry({
          value: {
            statement: "Underline TextLink on hover",
            states: [{ state: "hover", behavior: "Underline" }]
          }
        })
      ]
    };
    expect(
      validateDesignSystemJson("interaction-rules.json", componentBound)
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: {
        field: "value.states",
        expected: "interaction rules only support cross-component strategy fields; component-bound fields belong in a component spec"
      }
    });
  });

  test("keeps rich-field writing style as a soft contract", () => {
    const layout = validRulesJson();
    Object.assign(layout.rules[0].value, {
      relationship: [
        "This remains structurally valid. The schema does not judge prose style."
      ]
    });

    expect(validateDesignSystemJson("layout-rules.json", layout).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// collectStatusEntries (Task C ingest seam)
// ---------------------------------------------------------------------------

test.describe("collectStatusEntries", () => {
  test("token.json yields layer-qualified ids across all layers", () => {
    const entries = collectStatusEntries("token.json", validTokenJson());
    expect(entries.map((e) => e.id).sort()).toEqual([
      "component.button.bg",
      "component.button.padding",
      "primitive.color.blue.500",
      "primitive.space.4",
      "semantic.color.primary"
    ]);
    const gap = entries.find((e) => e.id === "component.button.padding");
    expect(gap).toMatchObject({ status: "gap", links: [] });
  });

  test("design-system.json yields visual language + principles", () => {
    const entries = collectStatusEntries(
      "design-system.json",
      validDesignSystemJson()
    );
    expect(entries.map((e) => e.id).sort()).toEqual([
      "principle-1",
      "principle-2",
      "visual-language"
    ]);
  });

  test("component-spec yields the single component entry", () => {
    const entries = collectStatusEntries("component-spec", validComponentSpec());
    expect(entries).toEqual([
      { id: "component-button", status: "formalized", links: ["card-1"] }
    ]);
  });
});

// ---------------------------------------------------------------------------
// Registry wiring: declaration runs the deep per-file check
// ---------------------------------------------------------------------------

test.describe("declaration wiring (deep checkFile seam)", () => {
  test("valid full 09A source set declares cleanly", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      const files: Array<[string, string, unknown]> = [
        ["design-system/design-system.json", "design-system.json", validDesignSystemJson()],
        ["design-system/token.json", "token.json", validTokenJson()],
        ["design-system/component-list.json", "component-list.json", validComponentListJson()],
        ["design-system/components/button.json", "component-spec", validComponentSpec()],
        ["design-system/layout-rules.json", "layout-rules.json", validRulesJson()],
        [
          "design-system/interaction-rules.json",
          "interaction-rules.json",
          { rules: [entry({ value: { statement: "Motion stays quiet" } })] }
        ]
      ];
      for (const [rel, artifactType, content] of files) {
        writeProjectFile(dir, rel, content);
        const res = recordSourceArtifact(dir, {
          path: rel,
          artifactType,
          semanticPurpose: "09A source",
          relatedRecordIds: ["card-1"]
        });
        expect(res.ok, artifactType).toBe(true);
      }
      expect(listEvents(dir, "invalid_artifact").length).toBe(0);
    });
  });

  test("token.json with a cycle is rejected at declaration (token_alias_cycle + invalid_artifact)", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      const json = validTokenJson();
      json.component["button.bg"].value = { alias: "component.button.fg" };
      json.component["button.fg"] = {
        value: { alias: "component.button.bg" },
        meaning: "按钮前景",
        status: "candidate",
        links: ["card-1"]
      };
      writeProjectFile(dir, "design-system/token.json", json);

      const res = recordSourceArtifact(dir, {
        path: "design-system/token.json",
        artifactType: "token.json",
        semanticPurpose: "token layers",
        relatedRecordIds: ["card-1"]
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("token_alias_cycle");

      const invalid = listEvents(dir, "invalid_artifact");
      expect(invalid.length).toBe(1);
      expect(invalid[0].payload).toMatchObject({
        tool: "record_artifact_written",
        reason: "token_alias_cycle"
      });
    });
  });

  test("design-system.json missing principles is rejected at declaration", () => {
    withTempProject((dir) => {
      insertAnsweredCard(dir, "card-1");
      const broken = validDesignSystemJson() as Record<string, unknown>;
      delete broken.principles;
      writeProjectFile(dir, "design-system/design-system.json", broken);

      const res = recordSourceArtifact(dir, {
        path: "design-system/design-system.json",
        artifactType: "design-system.json",
        semanticPurpose: "meta + principles",
        relatedRecordIds: ["card-1"]
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("missing_required_field");
    });
  });
});
