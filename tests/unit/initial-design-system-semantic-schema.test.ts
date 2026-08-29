import { describe, expect, test } from "vitest";

import { semanticDraftValidationIssues } from "../../lib/runtime/initial-design-system-semantic-schema";
import type {
  CommitInitialDesignSystemSemanticInput
} from "../../lib/runtime/initial-design-system-semantic-commit";

function semanticDraft(): CommitInitialDesignSystemSemanticInput["designSystem"] {
  return {
    name: "Validation Draft",
    visualLanguage: {
      description: "A precise editorial system.",
      meaning: "Editorial precision",
      sourceRefs: ["Q01"]
    },
    concepts: [],
    tokens: {
      primitive: [],
      semantic: [],
      component: []
    },
    foundationRules: [],
    layoutRules: [],
    interactionRules: [],
    components: [],
    categoryOmissions: [
      {
        category: "layout",
        statement: "No reusable layout rule is supported.",
        reason: "The evidence is limited to foundations.",
        sourceRefs: ["Q01"]
      },
      {
        category: "interaction",
        statement: "No reusable interaction rule is supported.",
        reason: "The evidence is limited to foundations.",
        sourceRefs: ["Q01"]
      },
      {
        category: "components",
        statement: "No reusable component contract is supported.",
        reason: "The evidence is limited to foundations.",
        sourceRefs: ["Q01"]
      }
    ],
    sourceOmissions: []
  };
}

describe("incremental semantic Draft validation", () => {
  test("reports every token usage field that the projected token schema would reject", () => {
    const draft = semanticDraft();
    draft.tokens.semantic.push({
      name: "space.group-rhythm",
      domain: "spacing",
      value: {
        value: "20px",
        usedFor: "Spacing between related controls."
      },
      sourceRefs: ["Q01"]
    });
    draft.tokens.component.push({
      name: "button.surface",
      domain: "color",
      value: {
        value: "#000000",
        usedFor: "Primary button surface."
      },
      sourceRefs: ["Q01"]
    });

    expect(semanticDraftValidationIssues(draft)).toEqual(expect.arrayContaining([
      {
        path: "tokens.semantic.0.value.usedFor",
        message: expect.stringContaining("value.usage")
      },
      {
        path: "tokens.component.0.value.usedFor",
        message: expect.stringContaining("value.usage")
      }
    ]));
  });

  test("rejects a typography scale bundle masquerading as one semantic role", () => {
    const draft = semanticDraft();
    draft.tokens.semantic.push({
      name: "type-scale-semantic-roles",
      domain: "typography",
      value: {
        fontFamily: "Instrument Sans",
        fontSizeSteps: ["16px", "20px", "24px", "64px", "105px"],
        fontWeight: "limited variation",
        lineHeight: "compact",
        usedFor: "All body, title, and display roles."
      },
      sourceRefs: ["Q01"]
    });

    expect(semanticDraftValidationIssues(draft)).toEqual(expect.arrayContaining([
      {
        path: "tokens.semantic.0.value.fontSizeSteps",
        message: expect.stringContaining("one scalar fontSize")
      }
    ]));
  });

  test("accepts a concrete typography role with one scalar size and one job", () => {
    const draft = semanticDraft();
    draft.tokens.semantic.push({
      name: "typography.body",
      domain: "typography",
      value: {
        fontFamily: "Instrument Sans",
        fontSize: "16px",
        fontWeight: 400,
        lineHeight: 1.4,
        usedFor: "Long-form body copy."
      },
      sourceRefs: ["Q01"]
    });

    expect(semanticDraftValidationIssues(draft)).toEqual([]);
  });

  test("keeps candidate lifecycle state out of visible typography role copy", () => {
    const draft = semanticDraft();
    draft.tokens.semantic.push({
      name: "Candidate Body",
      domain: "typography",
      value: {
        fontSize: "16px",
        usedFor: "Candidate for body copy."
      },
      sourceRefs: ["Q01"]
    });

    expect(semanticDraftValidationIssues(draft)).toEqual(expect.arrayContaining([
      {
        path: "tokens.semantic.0.name",
        message: expect.stringContaining("lifecycle status")
      },
      {
        path: "tokens.semantic.0.value.usedFor",
        message: expect.stringContaining("lifecycle status")
      }
    ]));
  });

  test("allows canonical English Typography identities with Chinese descriptive copy", () => {
    const draft = semanticDraft();
    draft.visualLanguage = {
      description: "以克制留白和清晰层级组织内容。",
      meaning: "精确的编辑设计语言",
      sourceRefs: ["Q01"]
    };
    draft.tokens.semantic.push({
      name: "typography.pageTitle",
      domain: "typography",
      value: {
        fontSize: "37px",
        usedFor: "用于页面和项目的主要标题。"
      },
      sourceRefs: ["Q01"]
    });

    expect(semanticDraftValidationIssues(draft)).toEqual([]);
  });

  test("requires one visible typography role for every observed font size", () => {
    const draft = semanticDraft();
    draft.tokens.primitive.push(
      {
        name: "font-size-16",
        domain: "typography",
        value: "16px",
        sourceRefs: ["Q01"]
      },
      {
        name: "font-size-20",
        domain: "typography",
        value: "20px",
        sourceRefs: ["Q01"]
      },
      {
        name: "font-size-24",
        domain: "typography",
        value: "24px",
        sourceRefs: ["Q01"]
      }
    );
    draft.tokens.semantic.push({
      name: "typography.display",
      domain: "typography",
      value: {
        fontFamily: "Instrument Sans",
        fontSize: "24px",
        usedFor: "Prominent display copy."
      },
      sourceRefs: ["Q01"]
    });

    expect(semanticDraftValidationIssues(draft)).toEqual(expect.arrayContaining([
      {
        path: "tokens.semantic",
        message: expect.stringContaining("16px, 20px")
      }
    ]));
  });

  test("accepts literal and alias roles that cover every observed font size", () => {
    const draft = semanticDraft();
    draft.tokens.primitive.push(
      {
        name: "fontSize.16",
        domain: "typography",
        value: "16px",
        sourceRefs: ["Q01"]
      },
      {
        name: "fontSize.20",
        domain: "typography",
        value: 20,
        sourceRefs: ["Q01"]
      },
      {
        name: "fontFamily.brand",
        domain: "typography",
        value: "Instrument Sans",
        sourceRefs: ["Q01"]
      },
      {
        name: "fontWeight.regular",
        domain: "typography",
        value: 400,
        sourceRefs: ["Q01"]
      },
      {
        name: "lineHeight.compact",
        domain: "typography",
        value: 1.2,
        sourceRefs: ["Q01"]
      }
    );
    draft.tokens.semantic.push(
      {
        name: "typography.body",
        domain: "typography",
        value: {
          fontSize: { alias: "primitive.fontSize.16" },
          usedFor: "Long-form body copy."
        },
        sourceRefs: ["Q01"]
      },
      {
        name: "typography.supporting",
        domain: "typography",
        value: {
          fontSize: "20px",
          usedFor: "Supporting headings."
        },
        sourceRefs: ["Q01"]
      }
    );

    expect(semanticDraftValidationIssues(draft)).toEqual([]);
  });

  test("does not apply typography font-role prefill coverage to other domains", () => {
    const draft = semanticDraft();
    draft.tokens.primitive.push(
      {
        name: "size.16",
        domain: "size",
        value: "16px",
        sourceRefs: ["Q01"]
      },
      {
        name: "color.accent",
        domain: "color",
        value: "#ff3366",
        sourceRefs: ["Q01"]
      },
      {
        name: "fontWeight.regular",
        domain: "typography",
        value: 400,
        sourceRefs: ["Q01"]
      }
    );

    expect(semanticDraftValidationIssues(draft)).toEqual([]);
  });

  test("rejects brace-string references for semantic Color roles", () => {
    const draft = semanticDraft();
    draft.tokens.primitive.push({
      name: "black",
      domain: "color",
      value: "#000000",
      sourceRefs: ["Q01"]
    });
    draft.tokens.semantic.push({
      name: "text-primary",
      domain: "color",
      value: "{color.black}",
      sourceRefs: ["Q01"]
    });

    expect(semanticDraftValidationIssues(draft)).toEqual([
      {
        path: "tokens.semantic.0.value",
        message: expect.stringContaining(
          'Use { alias: "primitive.black", usage: "..." }'
        )
      }
    ]);
  });

  test("accepts structured aliases for semantic Color roles", () => {
    const draft = semanticDraft();
    draft.tokens.primitive.push({
      name: "black",
      domain: "color",
      value: "#000000",
      sourceRefs: ["Q01"]
    });
    draft.tokens.semantic.push({
      name: "text-primary",
      domain: "color",
      value: {
        alias: "primitive.black",
        usage: "主要文字"
      },
      sourceRefs: ["Q01"]
    });

    expect(semanticDraftValidationIssues(draft)).toEqual([]);
  });
});
