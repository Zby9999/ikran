import { z } from "zod";

import { validateTokenUsageField } from "./design-system-schema";

const sourceRefs = z
  .array(z.string().trim().min(1))
  .min(1)
  .describe("Frozen Q/A/D source refs that directly support this decision.");

const semanticRule = z.object({
  meaning: z.string().trim().min(1),
  value: z.string().trim().min(1),
  sourceRefs
}).strict();

const semanticToken = z.object({
  name: z.string().trim().min(1),
  domain: z.enum([
    "color", "typography", "spacing", "size", "ratio", "radius",
    "border", "shadow", "opacity"
  ]),
  value: z.unknown().refine((value) => value !== undefined, {
    message: "Token value is required."
  }).describe(
    "Use a concrete value, or a structured alias object. For semantic/component Color roles that reuse a primitive, use { alias: 'primitive.<token-name>', usage: '<designer-language purpose>' }; never use brace-string references such as '{color.black}'."
  ),
  sourceRefs
}).strict();

const semanticFoundationRule = z.object({
  name: z.string().trim().min(1),
  layer: z.enum(["primitive", "semantic", "component"]).default("semantic"),
  domain: z.enum([
    "color", "typography", "spacing", "size", "ratio", "radius",
    "border", "shadow", "opacity"
  ]),
  meaning: z.string().trim().min(1),
  value: z.string().trim().min(1),
  sourceRefs
}).strict().describe(
  "A reusable foundation rule stored in token.json as kind=domain-rule. Use this for color usage/palette rules and other evidence-backed foundation guidance; do not encode rules as tokens."
);

const componentProp = z.object({
  name: z.string().trim().min(1),
  type: z.string().trim().min(1)
}).passthrough();

const componentVariant = z.object({
  axis: z.enum(["style", "size", "viewport"]),
  name: z.string().trim().min(1)
}).passthrough();

const componentState = z.object({
  state: z.string().trim().min(1)
}).passthrough();

const componentGuideline = z.object({
  kind: z.enum(["do", "dont"]),
  text: z.string().trim().min(1)
}).passthrough();

const semanticCategoryOmission = z.object({
  category: z.enum(["tokens", "layout", "interaction", "components"]),
  statement: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  sourceRefs
}).strict().describe(
  "Agent-authored evidence decision explaining why an otherwise required category is intentionally empty. Required exactly when that category has no entries."
);

const semanticSourceOmission = z.object({
  sourceRef: z.string().trim().min(1),
  statement: z.string().trim().min(1),
  reason: z.string().trim().min(1)
}).strict().describe(
  "Agent-authored disposition for one frozen Alignment source that does not produce a reusable Design System output. Runtime never invents this decision."
);

export const semanticDesignSystemSchema = z.object({
  name: z.string().trim().min(1),
  visualLanguage: z.object({
    description: z.string().trim().min(1),
    meaning: z.string().trim().min(1),
    sourceRefs
  }).strict(),
  concepts: z.array(semanticRule).default([]),
  tokens: z.object({
    primitive: z.array(semanticToken).default([]).describe(
      "Atomic construction facts. Typography roles do not belong here."
    ),
    semantic: z.array(semanticToken).default([]).describe(
      "Reusable semantic roles. Every distinct evidence-backed fontSize primitive must have its own semantic/component typography role with one scalar fontSize and a distinct usedFor. Keep Typography role identities concise canonical English for Browser specimens, write usedFor in the designer's language, and do not use those identities as a language precedent for other Draft copy. Runtime owns candidate lifecycle status. Never omit the size or bundle a scale into one role. Color roles should preserve every supported usage role instead of collapsing the palette into one token. Color aliases use value={alias:'primitive.<token-name>',usage:'...'}, never value='{color.<token-name>}'."
    ),
    component: z.array(semanticToken).default([])
  }).strict(),
  foundationRules: z.array(semanticFoundationRule).default([]),
  layoutRules: z.array(semanticRule).default([]),
  interactionRules: z.array(semanticRule).default([]),
  components: z.array(z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    sourceRefs,
    props: z.array(componentProp).default([]),
    variants: z.array(componentVariant).default([]),
    stateMatrix: z.array(componentState).default([]),
    guidelines: z.array(componentGuideline).default([]),
    tokenLinks: z.array(z.union([
      z.string().trim().min(1),
      z.record(z.string(), z.unknown())
    ])).default([]),
    codeLinks: z.array(z.union([
      z.string().trim().min(1),
      z.record(z.string(), z.unknown())
    ])).default([]),
    group: z.enum(["component", "block"]).optional()
  }).strict()).default([]),
  categoryOmissions: z.array(semanticCategoryOmission).default([]),
  sourceOmissions: z.array(semanticSourceOmission).default([])
}).strict().superRefine((designSystem, ctx) => {
  for (const layer of ["primitive", "semantic", "component"] as const) {
    for (const [index, token] of designSystem.tokens[layer].entries()) {
      const failure = validateTokenUsageField(
        token.value,
        layer,
        token.domain
      );
      if (!failure) continue;
      const details = failure.details &&
        typeof failure.details === "object" &&
        !Array.isArray(failure.details)
        ? failure.details as Record<string, unknown>
        : {};
      const field = typeof details.field === "string"
        ? details.field.split(".")
        : ["value"];
      const expected = typeof details.expected === "string"
        ? ` Expected ${details.expected}.`
        : "";
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, ...field],
        message: `${failure.reason}.${expected}`
      });
    }
  }
  const typographyStyleFields = new Set([
    "fontFamily", "fontSize", "fontWeight", "lineHeight",
    "letterSpacing", "textTransform"
  ]);
  const compositeFields = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).filter((field) => typographyStyleFields.has(field))
      : [];
  const aliasTarget = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 1) return null;
    if (typeof record.alias === "string") return record.alias;
    return typeof record.$ref === "string" ? record.$ref : null;
  };
  const normalizedTokenRef = (value: string) =>
    value
      .replace(/^(primitive|semantic|component)[./_-]+/i, "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
  const scalarFontSizeKey = (value: unknown): string | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return `length:${value}px`;
    }
    if (typeof value !== "string") return null;
    const compact = value.trim().toLowerCase().replace(/\s+/g, "");
    const px = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(compact);
    if (px) return `length:${Number.parseFloat(px[1]!)}px`;
    return compact.length > 0 ? `literal:${compact}` : null;
  };
  for (const [index, token] of designSystem.tokens.primitive.entries()) {
    if (token.domain === "typography" && compositeFields(token.value).length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", "primitive", index, "value"],
        message:
          "Composite typography roles must be semantic/component tokens; primitive typography entries are atomic construction facts."
      });
    }
  }
  const primitiveTokenNames = new Set(
    designSystem.tokens.primitive.map((token) => token.name)
  );
  for (const layer of ["semantic", "component"] as const) {
    for (const [index, token] of designSystem.tokens[layer].entries()) {
      if (token.domain !== "color" || typeof token.value !== "string") continue;
      const match = /^\{color\.([^{}]+)\}$/.exec(token.value.trim());
      if (!match) continue;
      const shorthandName = match[1]!.trim();
      const primitiveName = primitiveTokenNames.has(shorthandName)
        ? shorthandName
        : primitiveTokenNames.has(`color.${shorthandName}`)
          ? `color.${shorthandName}`
          : "<token-name>";
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, "value"],
        message:
          `Brace-string Color references are not aliases and cannot produce a Browser swatch. Use { alias: \"primitive.${primitiveName}\", usage: \"...\" }.`
      });
    }
  }
  const compositeTypographyRoles = [
    ...designSystem.tokens.semantic.map((token, index) => ({ token, layer: "semantic", index })),
    ...designSystem.tokens.component.map((token, index) => ({ token, layer: "component", index }))
  ].filter(({ token }) =>
    token.domain === "typography" && compositeFields(token.value).includes("fontSize")
  );
  const typographyRoleCandidates = [
    ...designSystem.tokens.semantic.map((token, index) => ({ token, layer: "semantic", index })),
    ...designSystem.tokens.component.map((token, index) => ({ token, layer: "component", index }))
  ].filter(({ token }) => token.domain === "typography");
  const candidateLifecycleCopy = /(?:\bcandidate\b|候选)/iu;
  for (const { token, layer, index } of typographyRoleCandidates) {
    if (candidateLifecycleCopy.test(token.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, "name"],
        message:
          "Candidate is Runtime-owned lifecycle status; write a concise canonical English typography role identity without lifecycle wording."
      });
    }
    const value = token.value && typeof token.value === "object" &&
      !Array.isArray(token.value)
      ? token.value as Record<string, unknown>
      : null;
    if (!value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, "value"],
        message:
          "Semantic/component typography tokens must describe one concrete font role."
      });
      continue;
    }
    for (const field of Object.keys(value)) {
      if (typographyStyleFields.has(field) || field === "usedFor") continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, "value", field],
        message:
          "A typography role describes one job with one scalar fontSize; preserve scales and step collections as atomic primitive facts."
      });
    }
    if (
      !("fontSize" in value) ||
      value.fontSize === null ||
      value.fontSize === undefined ||
      Array.isArray(value.fontSize)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, "value", "fontSize"],
        message:
          "A typography role requires one scalar fontSize for one stable job."
      });
    }
    for (const field of typographyStyleFields) {
      if (Array.isArray(value[field])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tokens", layer, index, "value", field],
          message:
            "Typography role style fields must be scalar values or one alias, not a scale or collection."
        });
      }
    }
    const usedFor = value.usedFor;
    if (typeof usedFor !== "string" || usedFor.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, "value", "usedFor"],
        message:
          "Typography roles require a non-empty usedFor description distinct from the stable role name; describe the best evidence-backed job in the designer's language when the exact semantic role needs review."
      });
    } else if (candidateLifecycleCopy.test(usedFor)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, "value", "usedFor"],
        message:
          "Candidate is Runtime-owned lifecycle status; describe the typography job directly without lifecycle wording."
      });
    }
  }
  const primitiveFontSizes = designSystem.tokens.primitive.flatMap(
    (token) => {
      if (token.domain !== "typography") return [];
      const normalized = token.name.replace(/[^a-z]/gi, "").toLowerCase();
      if (!/fontsize/.test(normalized)) return [];
      const key = scalarFontSizeKey(token.value);
      if (!key) return [];
      return [{
        key,
        label: key.startsWith("length:") ? key.slice("length:".length) : String(token.value),
        tokenRef: normalizedTokenRef(token.name)
      }];
    }
  );
  const coveredFontSizeKeys = new Set<string>();
  const coveredFontSizeRefs = new Set<string>();
  for (const { token } of typographyRoleCandidates) {
    if (!token.value || typeof token.value !== "object" || Array.isArray(token.value)) {
      continue;
    }
    const fontSize = (token.value as Record<string, unknown>).fontSize;
    const key = scalarFontSizeKey(fontSize);
    if (key) coveredFontSizeKeys.add(key);
    const alias = aliasTarget(fontSize);
    if (alias) coveredFontSizeRefs.add(normalizedTokenRef(alias));
  }
  const uncoveredFontSizes = primitiveFontSizes.filter((fact) =>
    !coveredFontSizeKeys.has(fact.key) && !coveredFontSizeRefs.has(fact.tokenRef)
  );
  const uncoveredLabels = [...new Set(uncoveredFontSizes.map((fact) => fact.label))];
  if (uncoveredLabels.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tokens", "semantic"],
      message:
        `Every observed font size requires its own visible semantic/component typography role. Missing roles for: ${uncoveredLabels.join(", ")}. Use concise canonical English role identities for Browser specimens and describe usedFor in the designer's language instead of omitting these sizes; Runtime owns candidate lifecycle status.`
    });
  }
  const atomicTypographyFacts = new Set(
    designSystem.tokens.primitive.flatMap((token) => {
      if (token.domain !== "typography") return [];
      const normalized = token.name.replace(/[^a-z]/gi, "").toLowerCase();
      if (/fontfamily|typeface/.test(normalized)) return ["fontFamily"];
      if (/fontsize/.test(normalized)) return ["fontSize"];
      if (/fontweight/.test(normalized)) return ["fontWeight"];
      if (/lineheight/.test(normalized)) return ["lineHeight"];
      return [];
    })
  );
  if (
    ["fontFamily", "fontSize", "fontWeight", "lineHeight"].every((field) =>
      atomicTypographyFacts.has(field)
    ) && compositeTypographyRoles.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tokens", "semantic"],
      message:
        "Typography construction facts are sufficient, but no composite semantic/component role was supplied."
    });
  }
  const counts = {
    tokens:
      designSystem.tokens.primitive.length +
      designSystem.tokens.semantic.length +
      designSystem.tokens.component.length +
      designSystem.foundationRules.length,
    layout: designSystem.layoutRules.length,
    interaction: designSystem.interactionRules.length,
    components: designSystem.components.length
  };
  const seen = new Set<string>();
  for (const [index, omission] of designSystem.categoryOmissions.entries()) {
    if (seen.has(omission.category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoryOmissions", index, "category"],
        message: "Duplicate category omission."
      });
    }
    seen.add(omission.category);
    if (counts[omission.category] > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoryOmissions", index],
        message: "Category omission is only allowed when the category is empty."
      });
    }
  }
  for (const [category, count] of Object.entries(counts)) {
    if (count === 0 && !seen.has(category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoryOmissions"],
        message: `Missing Agent-authored omission for empty ${category} category.`
      });
    }
  }
  const sourceOmissions = new Set<string>();
  const mappedSourceRefs = new Set([
    ...designSystem.visualLanguage.sourceRefs,
    ...designSystem.concepts.flatMap((item) => item.sourceRefs),
    ...Object.values(designSystem.tokens)
      .flat()
      .flatMap((item) => item.sourceRefs),
    ...designSystem.foundationRules.flatMap((item) => item.sourceRefs),
    ...designSystem.layoutRules.flatMap((item) => item.sourceRefs),
    ...designSystem.interactionRules.flatMap((item) => item.sourceRefs),
    ...designSystem.components.flatMap((item) => item.sourceRefs),
    ...designSystem.categoryOmissions.flatMap((item) => item.sourceRefs)
  ]);
  for (const [index, omission] of designSystem.sourceOmissions.entries()) {
    if (sourceOmissions.has(omission.sourceRef)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceOmissions", index, "sourceRef"],
        message: "Duplicate source omission."
      });
    }
    sourceOmissions.add(omission.sourceRef);
    if (mappedSourceRefs.has(omission.sourceRef)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceOmissions", index, "sourceRef"],
        message:
          "A source cannot be both mapped to a reusable output/category omission and dispositioned as a source omission."
      });
    }
  }
});

export const commitInitialDesignSystemSemanticInputSchema = z.object({
  alignmentAttemptId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  designSystem: semanticDesignSystemSchema
}).strict();

export type CommitInitialDesignSystemSemanticInput = z.infer<
  typeof commitInitialDesignSystemSemanticInputSchema
>;

export function semanticDraftValidationIssues(
  draft: unknown
): Array<{
  path: string;
  message: string;
}> {
  const parsed = semanticDesignSystemSchema.safeParse(draft);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
  }
  return [];
}
