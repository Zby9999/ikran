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
    value: "保持界面克制。",
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
      entry({ id: "principle-2", status: "gap", links: [], value: "待定。" })
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
        domain: "color",
        status: "formalized",
        links: ["card-1"]
      },
      "space.4": {
        value: "16px",
        domain: "spacing",
        status: "candidate",
        links: ["card-1"]
      }
    },
    semantic: {
      "color.primary": {
        value: { alias: "primitive.color.blue.500" },
        domain: "color",
        status: "formalized",
        links: ["card-1"]
      }
    },
    component: {
      "button.bg": {
        value: { alias: "semantic.color.primary" },
        domain: "color",
        status: "candidate",
        links: ["card-1"]
      },
      // Layer skip: component may alias primitive directly.
      "button.padding": {
        value: { alias: "primitive.space.4" },
        domain: "spacing",
        status: "candidate",
        links: ["card-1"]
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
      variants: [
        { axis: "style", name: "primary" },
        { axis: "size", name: "default" }
      ],
      stateMatrix: [
        { state: "default", behavior: "主色背景" },
        {
          state: "disabled",
          behavior: "降透明度,不可点击",
          transition: "100ms ease-out"
        }
      ],
      guidelines: [
        { kind: "do", text: "一个屏幕区域只使用一个主按钮" },
        { kind: "dont", text: "不要并列多个主操作" }
      ],
      tokenLinks: ["semantic.action.primary"],
      codeLinks: ["components/Button.tsx"]
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
        value: "页面主栅格为 12 列。",
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
  test("09B entry kind is optional for legacy data but validated against its source file when declared", () => {
    const legacy = validTokenJson();
    expect(validateDesignSystemJson("token.json", legacy).ok).toBe(true);

    const tokenWithRule = validTokenJson();
    Object.assign(tokenWithRule.primitive["color.blue.500"], {
      kind: "token",
      domain: "color"
    });
    tokenWithRule.semantic["no-shadow-regions"] = {
      kind: "domain-rule",
      domain: "shadow",
      value: "Do not use shadows to separate regions.",
      meaning: "Use spacing and borders for hierarchy.",
      status: "candidate",
      links: ["card-1"]
    };
    expect(validateDesignSystemJson("token.json", tokenWithRule).ok).toBe(true);

    const globalRules = validDesignSystemJson();
    Object.assign(globalRules.visualLanguage, { kind: "global-rule" });
    for (const principle of globalRules.principles) {
      Object.assign(principle, { kind: "global-rule" });
    }
    expect(
      validateDesignSystemJson("design-system.json", globalRules).ok
    ).toBe(true);
    expect(
      validateDesignSystemJson("layout-rules.json", {
        rules: [entry({ kind: "domain-rule" })]
      }).ok
    ).toBe(true);
    expect(
      validateDesignSystemJson("interaction-rules.json", {
        rules: [
          entry({
            kind: "domain-rule",
            value: "Motion stays quiet."
          })
        ]
      }).ok
    ).toBe(true);

    const wrongFile = validTokenJson();
    Object.assign(wrongFile.primitive["color.blue.500"], {
      kind: "global-rule"
    });
    expect(validateDesignSystemJson("token.json", wrongFile)).toMatchObject({
      ok: false,
      reason: "entry_kind_file_mismatch"
    });
    expect(
      validateDesignSystemJson("layout-rules.json", {
        rules: [entry({ kind: "global-rule" })]
      })
    ).toMatchObject({ ok: false, reason: "entry_kind_file_mismatch" });

    const missingDomain = validTokenJson();
    missingDomain.semantic["cta-ink"] = {
      kind: "domain-rule",
      value: "CTA uses the ink color.",
      meaning: "Keep calls to action typographic.",
      status: "candidate",
      links: ["card-1"]
    };
    expect(validateDesignSystemJson("token.json", missingDomain)).toMatchObject({
      ok: false,
      reason: "domain_rule_domain_required"
    });

    const invalidKind = validTokenJson();
    Object.assign(invalidKind.primitive["color.blue.500"], { kind: "rule" });
    expect(validateDesignSystemJson("token.json", invalidKind)).toMatchObject({
      ok: false,
      reason: "invalid_entry_kind"
    });
  });

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

  test("principle value must be prose and legacy rich objects explain the migration", () => {
    const res = validateDesignSystemJson("design-system.json", {
      ...validDesignSystemJson(),
      principles: [entry({ value: { statement: "Keep hierarchy clear." } })]
    });
    expect(res).toMatchObject({
      ok: false,
      reason: "legacy_rule_body_requires_prose",
      details: {
        field: "value",
        expected: "non-empty prose string"
      }
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
  test("represents unresolved token decisions as gap domain rules", () => {
    const json = validTokenJson();
    json.semantic["rule.open-gap.image-accent-evidence"] = {
      kind: "domain-rule",
      domain: "color",
      meaning: "Image-led accent colors need broader evidence.",
      value:
        "Only one project image demonstrates the range. Next: inspect two more project pages before declaring reusable accent roles.",
      status: "gap",
      links: []
    };

    expect(validateDesignSystemJson("token.json", json)).toEqual({ ok: true });
  });

  test("rejects unresolved values in token entries and a parallel gaps collection", () => {
    const tokenGap = validTokenJson();
    tokenGap.semantic["color.hover"] = {
      kind: "token",
      domain: "color",
      value: "unresolved",
      status: "gap",
      links: []
    };
    expect(validateDesignSystemJson("token.json", tokenGap)).toMatchObject({
      ok: false,
      reason: "token_gap_forbidden",
      details: { token: "semantic.color.hover" }
    });

    const parallelCollection = {
      ...validTokenJson(),
      gaps: []
    };
    expect(validateDesignSystemJson("token.json", parallelCollection)).toMatchObject({
      ok: false,
      reason: "unknown_field",
      details: { field: "gaps" }
    });
  });

  test("token entries reject envelope meaning fail-closed", () => {
    const json = validTokenJson();
    json.primitive["color.blue.500"].meaning = "品牌主色";
    expect(validateDesignSystemJson("token.json", json)).toMatchObject({
      ok: false,
      reason: "token_meaning_forbidden",
      details: { token: "primitive.color.blue.500", field: "meaning" }
    });
  });

  test("valid 3-layer file incl. component → primitive layer skip", () => {
    const res = validateDesignSystemJson("token.json", validTokenJson());
    expect(res.ok).toBe(true);
  });

  test("accepts a declared token domain and rejects unknown domains", () => {
    const valid = validTokenJson();
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

  test.describe("token meaning retirement", () => {
    test("domain-rule entries in token.json keep required meaning", () => {
      const json = validTokenJson();
      json.primitive["color-scale-rule"] = {
        kind: "domain-rule",
        domain: "color",
        value: "Reserve the 500 step for interactive accents.",
        meaning: "Accent restraint",
        status: "candidate",
        links: ["card-1"]
      };
      expect(validateDesignSystemJson("token.json", json).ok).toBe(true);
      delete json.primitive["color-scale-rule"].meaning;
      expect(
        validateDesignSystemJson("token.json", json)
      ).toMatchObject({ ok: false, reason: "missing_required_field" });
    });
  });

  test("typography semantic tokens accept usedFor and reject usage", () => {
    const valid = validTokenJson();
    valid.primitive["fontSize.16"] = {
      value: "16px",
      domain: "typography",
      status: "formalized",
      links: ["card-1"]
    };
    valid.semantic["typography.body"] = {
      value: {
        alias: "primitive.fontSize.16",
        usedFor: "Default reading text across content surfaces."
      },
      domain: "typography",
      status: "formalized",
      links: ["card-1"]
    };
    expect(validateDesignSystemJson("token.json", valid)).toEqual({ ok: true });

    const wrongField = structuredClone(valid);
    wrongField.semantic["typography.body"].value = {
      alias: "primitive.fontSize.16",
      usage: "Default reading text across content surfaces."
    };
    expect(validateDesignSystemJson("token.json", wrongField)).toMatchObject({
      ok: false,
      reason: "token_usage_field_forbidden",
      details: {
        token: "semantic.typography.body",
        field: "value.usage",
        expected: "value.usedFor"
      }
    });
  });

  test("non-typography semantic/component tokens accept usage and reject usedFor", () => {
    const valid = validTokenJson();
    valid.semantic["color.primary"].value = {
      alias: "primitive.color.blue.500",
      usage: "Default foreground for readable text."
    };
    valid.component["button.bg"].value = {
      alias: "semantic.color.primary",
      usage: "Button surface color."
    };
    expect(validateDesignSystemJson("token.json", valid)).toEqual({ ok: true });

    const wrongField = structuredClone(valid);
    wrongField.semantic["color.primary"].value = {
      alias: "primitive.color.blue.500",
      usedFor: "Default foreground for readable text."
    };
    expect(validateDesignSystemJson("token.json", wrongField)).toMatchObject({
      ok: false,
      reason: "token_usage_field_forbidden",
      details: {
        token: "semantic.color.primary",
        field: "value.usedFor",
        expected: "value.usage"
      }
    });
  });

  test("primitive tokens reject usage fields and usage text must be non-empty", () => {
    const primitiveUsage = validTokenJson();
    primitiveUsage.primitive["color.blue.500"].value = {
      hex: "#3b82f6",
      usage: "Palette ink"
    };
    expect(validateDesignSystemJson("token.json", primitiveUsage)).toMatchObject({
      ok: false,
      reason: "token_usage_field_forbidden",
      details: {
        token: "primitive.color.blue.500",
        field: "value.usage",
        expected: "no token usage field"
      }
    });

    for (const invalidUsage of ["", "   ", 42]) {
      const semanticUsage = validTokenJson();
      semanticUsage.semantic["color.primary"].value = {
        alias: "primitive.color.blue.500",
        usage: invalidUsage
      };
      expect(
        validateDesignSystemJson("token.json", semanticUsage),
        String(invalidUsage)
      ).toMatchObject({
        ok: false,
        reason: "invalid_field_type",
        details: {
          token: "semantic.color.primary",
          field: "value.usage",
          expected: "non-empty string"
        }
      });
    }
  });

  test("domain rules in token.json require prose bodies", () => {
    const legacy = validTokenJson();
    legacy.semantic["no-shadow-regions"] = {
      kind: "domain-rule",
      domain: "shadow",
      value: { statement: "Do not use shadows to separate regions." },
      meaning: "Use spacing and borders for hierarchy.",
      status: "candidate",
      links: ["card-1"]
    };
    expect(validateDesignSystemJson("token.json", legacy)).toMatchObject({
      ok: false,
      reason: "legacy_rule_body_requires_prose",
      details: { field: "value", expected: "non-empty prose string" }
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
      domain: "color",
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
      domain: "color",
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

  test("rejects foundation entry kinds outside their owned files", () => {
    const json = validComponentListJson();
    Object.assign(json.components[0], { kind: "token" });
    expect(validateDesignSystemJson("component-list.json", json)).toMatchObject({
      ok: false,
      reason: "entry_kind_file_mismatch"
    });
  });
});

// ---------------------------------------------------------------------------
// components/<name>.json (component-spec)
// ---------------------------------------------------------------------------

test.describe("component-spec", () => {
  test("valid spec uses the consolidated designer-facing contract", () => {
    const res = validateDesignSystemJson("component-spec", validComponentSpec());
    expect(res.ok).toBe(true);
  });

  test("component spec uses value.description and does not require meaning", () => {
    const { meaning: _meaning, ...spec } = validComponentSpec();

    expect(validateDesignSystemJson("component-spec", spec)).toEqual({
      ok: true
    });
  });

  test("rejects foundation entry kinds outside their owned files", () => {
    expect(
      validateDesignSystemJson("component-spec", {
        ...validComponentSpec(),
        kind: "domain-rule"
      })
    ).toMatchObject({
      ok: false,
      reason: "entry_kind_file_mismatch"
    });
  });

  test("missing designer-facing collections → missing_required_field", () => {
    for (const field of [
      "props",
      "variants",
      "stateMatrix",
      "guidelines",
      "tokenLinks",
      "codeLinks"
    ] as const) {
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

  test("guidelines require an explicit do/dont kind and non-empty text", () => {
    for (const guidelines of [
      [{ kind: "maybe", text: "Ambiguous advice" }],
      [{ kind: "do", text: "" }],
      ["Do not encode polarity in prose"]
    ]) {
      const spec = validComponentSpec();
      Object.assign(spec.value, { guidelines });
      expect(validateDesignSystemJson("component-spec", spec)).toMatchObject({
        ok: false,
        reason: "invalid_field_type"
      });
    }
  });

  test("variants require a named style, size, or viewport axis", () => {
    for (const variants of [
      [{ name: "primary" }],
      [{ axis: "density", name: "compact" }],
      [{ axis: "size", name: "" }]
    ]) {
      const spec = validComponentSpec();
      Object.assign(spec.value, { variants });
      expect(validateDesignSystemJson("component-spec", spec)).toMatchObject({
        ok: false,
        reason: "invalid_field_type"
      });
    }
  });

  test.each([
    "states",
    "boundaries",
    "anatomy",
    "sizes",
    "motion",
    "usageRules",
    "contentRules",
    "responsiveBehavior",
    "verificationTargets",
    "openGaps",
    "openQuestions",
    "labelArrowGap"
  ])(
    "rejects unregistered component spec value key %s",
    (field) => {
      const spec = validComponentSpec();
      Object.assign(spec.value, { [field]: ["must not be silently dropped"] });

      expect(validateDesignSystemJson("component-spec", spec)).toMatchObject({
        ok: false,
        reason: "unknown_field",
        details: { field: `value.${field}` }
      });
    }
  );

  test("group is an optional component|block enum (09C-D03 sidebar grouping)", () => {
    // Absent (09A/09B legacy specs) stays valid.
    expect(
      validateDesignSystemJson("component-spec", validComponentSpec()).ok
    ).toBe(true);
    for (const group of ["component", "block"] as const) {
      const spec = validComponentSpec();
      Object.assign(spec.value, { group });
      expect(
        validateDesignSystemJson("component-spec", spec).ok,
        group
      ).toBe(true);
    }
    const invalidEnum = validComponentSpec();
    Object.assign(invalidEnum.value, { group: "section" });
    expect(
      validateDesignSystemJson("component-spec", invalidEnum)
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: { field: "value.group" }
    });
    const invalidType = validComponentSpec();
    Object.assign(invalidType.value, { group: 1 });
    expect(validateDesignSystemJson("component-spec", invalidType).ok).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// layout-rules.json / interaction-rules.json
// ---------------------------------------------------------------------------

test.describe("layout-rules.json / interaction-rules.json", () => {
  test("rejects source-only fields that the DB and Workbench do not project", () => {
    const hiddenEntryField = {
      rules: [
        {
          ...entry({ value: "Use a stable grid." }),
          hiddenBody: "Undeclared source-only rule body"
        }
      ]
    };
    expect(
      validateDesignSystemJson("layout-rules.json", hiddenEntryField)
    ).toMatchObject({
      ok: false,
      reason: "unknown_field",
      details: { field: "hiddenBody" }
    });

    expect(
      validateDesignSystemJson("interaction-rules.json", {
        ...validRulesJson(),
        hiddenRootBody: "Undeclared file-level body"
      })
    ).toMatchObject({
      ok: false,
      reason: "unknown_field",
      details: { field: "hiddenRootBody" }
    });

    expect(
      validateDesignSystemJson("interaction-rules.json", {
        rules: [entry({ name: "Quiet motion" })]
      })
    ).toMatchObject({
      ok: false,
      reason: "unknown_field",
      details: { field: "name" }
    });
  });

  test("accepts prose rule bodies while keeping meaning required", () => {
    const proseRule = {
      id: "interaction-prose",
      value: "Use restrained 150ms transitions so feedback stays immediate without becoming decorative.",
      meaning: "Restrained transitions",
      status: "candidate",
      links: ["card-1"]
    };
    expect(
      validateDesignSystemJson("interaction-rules.json", {
        rules: [proseRule]
      }).ok
    ).toBe(true);
    expect(
      validateDesignSystemJson("layout-rules.json", {
        rules: [
          {
            ...proseRule,
            id: "layout-prose",
            meaning: "Editorial rhythm",
            sourceCaptures: []
          }
        ]
      }).ok
    ).toBe(true);

    const { meaning: _meaning, ...withoutMeaning } = proseRule;
    expect(
      validateDesignSystemJson("interaction-rules.json", {
        rules: [withoutMeaning]
      })
    ).toMatchObject({
      ok: false,
      reason: "missing_required_field",
      details: { field: "meaning" }
    });
  });

  test("valid files", () => {
    expect(
      validateDesignSystemJson("layout-rules.json", validRulesJson()).ok
    ).toBe(true);
    expect(
      validateDesignSystemJson("interaction-rules.json", {
        rules: [entry({ value: "Motion stays quiet." })]
      }).ok
    ).toBe(true);
  });

  test("rule value must be prose text", () => {
    for (const badValue of [[1, 2], 7, "  "]) {
      const res = validateDesignSystemJson("layout-rules.json", {
        rules: [entry({ value: badValue })]
      });
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe("invalid_field_type");
    }
  });

  test("legacy rich rule objects explain how to migrate", () => {
    for (const fileKind of ["layout-rules.json", "interaction-rules.json"] as const) {
      expect(
        validateDesignSystemJson(fileKind, {
          rules: [entry({ value: { statement: "Motion stays quiet." } })]
        })
      ).toMatchObject({
        ok: false,
        reason: "legacy_rule_body_requires_prose",
        details: {
          field: "value",
          expected: "non-empty prose string"
        }
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Layout source captures (09C-D02): rule → Figma node screenshot provenance
// ---------------------------------------------------------------------------

test.describe("layout-rules.json sourceCaptures", () => {
  function capture(overrides: Record<string, unknown> = {}) {
    return {
      nodeId: "1:23",
      nodeName: "Work grid",
      artifactPath: "design-system/captures/grid-page-work-grid.png",
      capturedAt: "2026-08-01T04:00:00.000Z",
      surfaceId: "surface-1",
      ...overrides
    };
  }

  function rulesWith(captures: unknown) {
    return {
      rules: [entry({ value: "Use a twelve-column grid.", sourceCaptures: captures })]
    };
  }

  test("accepts a valid capture list, optional nodeId/surfaceId omitted", () => {
    expect(
      validateDesignSystemJson("layout-rules.json", rulesWith([capture()]))
    ).toMatchObject({ ok: true });
    const minimal = capture();
    delete (minimal as Record<string, unknown>).nodeId;
    delete (minimal as Record<string, unknown>).surfaceId;
    expect(
      validateDesignSystemJson("layout-rules.json", rulesWith([minimal]))
    ).toMatchObject({ ok: true });
  });

  test("sourceCaptures must be an array when present", () => {
    expect(
      validateDesignSystemJson("layout-rules.json", rulesWith("work-grid"))
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: { field: "sourceCaptures", expected: "array" }
    });
  });

  test("each capture requires nodeName / artifactPath / capturedAt", () => {
    for (const field of ["nodeName", "artifactPath", "capturedAt"] as const) {
      const broken = capture();
      delete (broken as Record<string, unknown>)[field];
      expect(
        validateDesignSystemJson("layout-rules.json", rulesWith([broken]))
      ).toMatchObject({
        ok: false,
        reason: "invalid_field_type",
        details: {
          field: `sourceCaptures[0].${field}`,
          expected: "non-empty string"
        }
      });
      expect(
        validateDesignSystemJson(
          "layout-rules.json",
          rulesWith([capture({ [field]: "  " })])
        )
      ).toMatchObject({
        ok: false,
        reason: "invalid_field_type",
        details: {
          field: `sourceCaptures[0].${field}`,
          expected: "non-empty string"
        }
      });
    }
  });

  test("optional nodeId / surfaceId must be non-empty strings when present", () => {
    for (const field of ["nodeId", "surfaceId"] as const) {
      expect(
        validateDesignSystemJson(
          "layout-rules.json",
          rulesWith([capture({ [field]: 42 })])
        )
      ).toMatchObject({
        ok: false,
        reason: "invalid_field_type",
        details: {
          field: `sourceCaptures[0].${field}`,
          expected: "non-empty string"
        }
      });
    }
  });

  test("origin is a closed enum; absent stays valid (legacy source captures)", () => {
    expect(
      validateDesignSystemJson(
        "layout-rules.json",
        rulesWith([capture({ origin: "source" })])
      )
    ).toMatchObject({ ok: true });
    expect(
      validateDesignSystemJson(
        "layout-rules.json",
        rulesWith([capture({ origin: "figma" })])
      )
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: {
        field: "sourceCaptures[0].origin",
        expected: '"source" | "code"'
      }
    });
  });

  test("a code capture requires codeDigest and codeLinks (Issue 32)", () => {
    const codeCapture = capture({
      origin: "code",
      codeDigest: "abc123",
      codeLinks: ["components/Button.tsx"]
    });
    expect(
      validateDesignSystemJson("layout-rules.json", rulesWith([codeCapture]))
    ).toMatchObject({ ok: true });

    expect(
      validateDesignSystemJson(
        "layout-rules.json",
        rulesWith([capture({ origin: "code", codeLinks: ["components/Button.tsx"] })])
      )
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: { field: "sourceCaptures[0].codeDigest" }
    });
    expect(
      validateDesignSystemJson(
        "layout-rules.json",
        rulesWith([capture({ origin: "code", codeDigest: "abc123" })])
      )
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: { field: "sourceCaptures[0].codeLinks" }
    });
    expect(
      validateDesignSystemJson(
        "layout-rules.json",
        rulesWith([
          capture({ origin: "code", codeDigest: "abc123", codeLinks: [] })
        ])
      )
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: { field: "sourceCaptures[0].codeLinks" }
    });
  });

  test("harnessPath declares a same-origin relative route, code captures only (Issue 33)", () => {
    const codeCapture = (harnessPath: unknown) =>
      capture({
        origin: "code",
        codeDigest: "abc123",
        codeLinks: ["components/Button.tsx"],
        ...(harnessPath === undefined ? {} : { harnessPath })
      });

    // Valid: a leading-slash relative route.
    expect(
      validateDesignSystemJson(
        "layout-rules.json",
        rulesWith([codeCapture("/__ikran/component/button")])
      )
    ).toMatchObject({ ok: true });
    // Absent stays valid (static code-backed tier only).
    expect(
      validateDesignSystemJson("layout-rules.json", rulesWith([codeCapture(undefined)]))
    ).toMatchObject({ ok: true });

    // Anything that could navigate away from the surface origin — or carry
    // its own query/fragment — fails closed.
    for (const bad of [
      "components/button",
      "//evil.com/x",
      "https://evil.com/x",
      "/../secret",
      "/__ikran/component/../button",
      "/x?state=hover",
      "/x#frag",
      "\\\\evil\\x",
      ""
    ]) {
      expect(
        validateDesignSystemJson(
          "layout-rules.json",
          rulesWith([codeCapture(bad)])
        )
      ).toMatchObject({
        ok: false,
        reason: "invalid_field_type",
        details: { field: "sourceCaptures[0].harnessPath" }
      });
    }

    // A source capture never names a render route (its surface is Figma
    // evidence, not a preview).
    expect(
      validateDesignSystemJson(
        "layout-rules.json",
        rulesWith([capture({ harnessPath: "/__ikran/component/button" })])
      )
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: {
        field: "sourceCaptures[0].harnessPath",
        expected: 'only allowed when origin is "code"'
      }
    });
  });

  test("nodeRect declares the node's position inside the capture image", () => {
    expect(
      validateDesignSystemJson(
        "layout-rules.json",
        rulesWith([
          capture({
            nodeRect: { x: 0.05, y: 0, width: 0.9, height: 0.0625 }
          })
        ])
      )
    ).toMatchObject({ ok: true });
  });

  test("nodeRect must be an object with x/y/width/height fractions", () => {
    expect(
      validateDesignSystemJson(
        "layout-rules.json",
        rulesWith([capture({ nodeRect: "top-left" })])
      )
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: {
        field: "sourceCaptures[0].nodeRect",
        expected: "object"
      }
    });
    for (const field of ["x", "y", "width", "height"] as const) {
      const broken: Record<string, unknown> = {
        x: 0,
        y: 0,
        width: 0.5,
        height: 0.5
      };
      delete broken[field];
      expect(
        validateDesignSystemJson(
          "layout-rules.json",
          rulesWith([capture({ nodeRect: broken })])
        )
      ).toMatchObject({
        ok: false,
        reason: "invalid_field_type",
        details: {
          field: `sourceCaptures[0].nodeRect.${field}`,
          expected: "number"
        }
      });
    }
  });

  test("nodeRect fractions stay inside the image", () => {
    const cases: Record<string, unknown>[] = [
      { x: -0.1, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 1.2, width: 0.5, height: 0.5 },
      { x: 0, y: 0, width: 0, height: 0.5 },
      { x: 0, y: 0, width: 0.5, height: -0.2 },
      { x: 0, y: 0, width: 4.1, height: 0.5 },
      { x: 0, y: 0, width: 0.5, height: 4.1 }
    ];
    for (const nodeRect of cases) {
      expect(
        validateDesignSystemJson(
          "layout-rules.json",
          rulesWith([capture({ nodeRect })])
        )
      ).toMatchObject({
        ok: false,
        reason: "invalid_field_type",
        details: { field: "sourceCaptures[0].nodeRect" }
      });
    }
  });

  test("nodeRect width/height may exceed 1 when the crop truncates the node", () => {
    // A tall frame captured as a top-truncated 2:3 portrait: the node fills
    // the crop horizontally and overflows below — a valid locator, no mark.
    expect(
      validateDesignSystemJson(
        "layout-rules.json",
        rulesWith([
          capture({ nodeRect: { x: 0, y: 0, width: 1, height: 1.87 } })
        ])
      )
    ).toMatchObject({ ok: true });
  });

  test("capture items must be plain objects", () => {
    expect(
      validateDesignSystemJson("layout-rules.json", rulesWith(["work-grid"]))
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: { field: "sourceCaptures[0]", expected: "object" }
    });
  });

  test("interaction rich-object shape receives the prose migration error", () => {
    expect(
      validateDesignSystemJson("interaction-rules.json", {
        rules: [
          entry({
            value: {
              statement: "Motion stays quiet",
              sourceCaptures: [capture()]
            }
          })
        ]
      })
    ).toMatchObject({ ok: false, reason: "legacy_rule_body_requires_prose" });
  });
});

// ---------------------------------------------------------------------------
// collectStatusEntries (Task C ingest seam)
// ---------------------------------------------------------------------------

test.describe("collectStatusEntries", () => {
  test("token.json yields layer-qualified ids across all layers", () => {
    const json = validTokenJson();
    json.semantic["rule.open-gap.hover-color"] = {
      kind: "domain-rule",
      domain: "color",
      meaning: "Hover color needs evidence.",
      value: "Inspect the hover state before declaring a color token.",
      status: "gap",
      links: []
    };
    const entries = collectStatusEntries("token.json", json);
    expect(entries.map((e) => e.id).sort()).toEqual([
      "component.button.bg",
      "component.button.padding",
      "primitive.color.blue.500",
      "primitive.space.4",
      "semantic.color.primary",
      "semantic.rule.open-gap.hover-color"
    ]);
    const gap = entries.find(
      (e) => e.id === "semantic.rule.open-gap.hover-color"
    );
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
          { rules: [entry({ value: "Motion stays quiet." })] }
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
        domain: "color",
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
