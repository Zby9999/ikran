import { describe, expect, test } from "vitest";

import {
  semanticDraftValidationIssues
} from "../../lib/runtime/initial-design-system-semantic-schema";
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
});
