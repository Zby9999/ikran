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
  value: z.unknown(),
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
      "Reusable semantic roles. Each evidence-backed typography role must describe one stable job with one scalar fontSize, at least one other supported style field, and a distinct usedFor; never bundle a scale or step collection into one role. Color roles should preserve every supported usage role instead of collapsing the palette into one token."
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
  const compositeTypographyRoles = [
    ...designSystem.tokens.semantic.map((token, index) => ({ token, layer: "semantic", index })),
    ...designSystem.tokens.component.map((token, index) => ({ token, layer: "component", index }))
  ].filter(({ token }) =>
    token.domain === "typography" && compositeFields(token.value).length > 1
  );
  const typographyRoleCandidates = [
    ...designSystem.tokens.semantic.map((token, index) => ({ token, layer: "semantic", index })),
    ...designSystem.tokens.component.map((token, index) => ({ token, layer: "component", index }))
  ].filter(({ token }) => token.domain === "typography");
  for (const { token, layer, index } of typographyRoleCandidates) {
    const value = token.value && typeof token.value === "object" &&
      !Array.isArray(token.value)
      ? token.value as Record<string, unknown>
      : null;
    if (!value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, "value"],
        message:
          "Semantic/component typography tokens must describe one concrete composite role."
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
    if (compositeFields(value).length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, "value"],
        message:
          "A typography role must combine fontSize with at least one other supported style field."
      });
    }
    const usedFor = value.usedFor;
    if (typeof usedFor !== "string" || usedFor.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", layer, index, "value", "usedFor"],
        message:
          "Composite typography roles require an evidence-backed usedFor description distinct from the stable role name."
      });
    }
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
  for (const [index, omission] of designSystem.sourceOmissions.entries()) {
    if (sourceOmissions.has(omission.sourceRef)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceOmissions", index, "sourceRef"],
        message: "Duplicate source omission."
      });
    }
    sourceOmissions.add(omission.sourceRef);
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

export function semanticDraftValidationIssues(draft: unknown): Array<{
  path: string;
  message: string;
}> {
  const parsed = semanticDesignSystemSchema.safeParse(draft);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));
}
