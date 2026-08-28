import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  claimAlignmentPreparationCommand,
  finalizeAlignmentPreparation
} from "../../lib/runtime/alignment-agent-command";
import { prepareDesignIntentAlignment } from "../../lib/runtime/alignment-preparation";
import { initializeProjectDb } from "../../lib/runtime/db";
import {
  ALIGNMENT_SECTIONS,
  completeDesignIntentAlignment,
  createAgentAnnotation,
  createQuestionCard,
  recordDesignerAnswer
} from "../../lib/runtime/design-intent-alignment";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { listEvents } from "../../lib/runtime/events";
import {
  claimInitialDesignSystemPreparation,
  finalizeInitialDesignSystemPreparation,
  INITIAL_DESIGN_SYSTEM_FILE_SCAFFOLDS,
  INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT,
  INITIAL_DESIGN_SYSTEM_WORK_UNIT_EXAMPLES,
  recordDesignSystemExtractionAudit,
  recordDesignSystemExtractionWorkUnit
} from "../../lib/runtime/initial-design-system-preparation";
import {
  RICH_COMPONENT_SPEC_FIELDS,
  validateDesignSystemJson,
  type DesignSystemFileKind
} from "../../lib/runtime/design-system-schema";
import { getDesignSystemView } from "../../lib/runtime/design-system-view";
import { approveDesignSystemEntry } from "../../lib/runtime/design-system-approval";
import { editDesignSystemEntry } from "../../lib/runtime/design-system-edit";
import { setDesignLanguageDescription } from "../../lib/runtime/project-readiness";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import { recordDesignSystemExtractionWorkUnitInputSchema } from "../../lib/runtime/commands/schemas";

const projects: string[] = [];
const COMPLETE_TOKENS_WORK_UNIT = {
  kind: "tokens" as const,
  reviewedFoundationOwners: [
    "color",
    "typography",
    "material"
  ] as ["color", "typography", "material"]
};

function createCompletedAlignmentFixture(
  options: { golden?: boolean } = {}
) {
  const projectPath = mkdtempSync(
    path.join(tmpdir(), "ikran-initial-design-system-")
  );
  projects.push(projectPath);
  initializeProjectDb(projectPath);

  const seed = registerSeedReference(projectPath, {
    figmaSeedReference:
      "https://www.figma.com/design/InitialDs/Seed?node-id=10:20",
    originalDesignIntent: "Typography-led editorial system"
  });
  if (!seed.ok) throw new Error(seed.reason);
  const evidence = recordEvidencePackage(projectPath, {
    seedReferenceId: seed.record.id,
    frame: { nodeId: "10:20", name: "Editorial Seed" },
    evidenceViews: { rawData: "available", screenshot: "missing" }
  });
  if (!evidence.ok) throw new Error(evidence.reason);
  const description = setDesignLanguageDescription(
    projectPath,
    "A sparse editorial system led by exact typography."
  );
  if (!description.ok) throw new Error(description.reason);

  const prepared = prepareDesignIntentAlignment(projectPath);
  if (!prepared.ok) throw new Error(prepared.reason);
  const claimed = claimAlignmentPreparationCommand(projectPath);
  if (!claimed.ok) throw new Error(claimed.reason);

  const questionIds: string[] = [];
  for (const section of ALIGNMENT_SECTIONS) {
    const annotation = createAgentAnnotation(projectPath, {
      alignmentAttemptId: prepared.attempt.id,
      idempotencyKey: `annotation-${section}`,
      section,
      inference: section === "token" ? "confirmed" : "reasonable",
      title: `${section} evidence`,
      body:
        section === "token"
          ? options.golden
            ? "The seed uses Instrument Sans, a 16–105 px type range, negative display tracking, and six gray steps."
            : "The seed uses Instrument Sans."
          : `The ${section} treatment appears intentional.`,
      anchor: {
        kind: "single",
        target: {
          kind: "surface",
          seedReferenceId: seed.record.id,
          evidenceSurfaceId: evidence.record.id,
          evidenceVersionId: evidence.record.id
        }
      }
    });
    if (!annotation.ok) throw new Error(annotation.reason);

    for (let index = 1; index <= 2; index += 1) {
      const proposedAnswer =
        options.golden && section === "token" && index === 1
          ? "Use Instrument Sans, preserve the 16–105 px scale and negative display tracking, and keep six gray steps."
          : options.golden && section === "component" && index === 1
            ? "Use a label-and-arrow text link CTA without a filled button."
        : section === "token" && index === 1
          ? "Use Instrument Sans."
          : `Confirmed ${section} answer ${index}.`;
      const question = createQuestionCard(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: `question-${section}-${index}`,
        section,
        observation: `${section} ${index}`,
        question: `Confirm ${section} decision ${index}?`,
        answerOptions: [
          proposedAnswer,
          `Use an alternative ${section} decision ${index}.`
        ],
        anchor: {
          kind: "single",
          target: {
            kind: "surface",
            seedReferenceId: seed.record.id,
            evidenceSurfaceId: evidence.record.id,
            evidenceVersionId: evidence.record.id
          }
        }
      });
      if (!question.ok) throw new Error(question.reason);
      questionIds.push(question.record.id);
    }
  }

  const finalized = finalizeAlignmentPreparation(projectPath, prepared.attempt.id);
  if (!finalized.ok) throw new Error(finalized.reason);

  for (const [index, questionId] of questionIds.entries()) {
    const answer = recordDesignerAnswer(projectPath, {
      questionCardId: questionId,
      answer: {
        kind: "custom",
        text:
          options.golden && index === 4
            ? "Use Instrument Sans, retain the 16–105 px scale and negative display tracking, and preserve six gray steps."
            : options.golden && index === 8
              ? "CTA is a concise label plus arrow text link; do not introduce a filled button."
              : `Confirmed answer ${index + 1}.`
      }
    });
    if (!answer.ok) throw new Error(answer.reason);
  }

  const completed = completeDesignIntentAlignment(projectPath);
  if (!completed.ok) throw new Error(completed.reason);

  return {
    projectPath,
    attemptId: prepared.attempt.id,
    snapshotId: prepared.input_snapshot.id,
    seedId: seed.record.id,
    evidenceId: evidence.record.id,
    commandId: completed.command.id
  };
}

function writeJson(
  projectPath: string,
  relativePath: string,
  value: unknown
): void {
  const absolutePath = path.join(projectPath, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function declareInitialDesignSystemArtifacts(
  projectPath: string,
  claimed: Extract<
    ReturnType<typeof claimInitialDesignSystemPreparation>,
    { ok: true }
  >
) {
  const card = (section: string) =>
    claimed.question_cards.find((candidate) => candidate.section === section)!;

  writeJson(projectPath, "design-system/design-system.json", {
    name: "Editorial Fixture",
    visualLanguage: {
      id: "visual-language",
      kind: "global-rule",
      value: { description: "Sparse, exact, typography-led." },
      meaning: "Editorial visual language",
      status: "candidate",
      links: [card("visual-language").id]
    },
    concepts: [
      {
        id: "principle-restraint",
        kind: "global-rule",
        value: "Use restraint to preserve hierarchy.",
        meaning: "Restrained hierarchy",
        status: "candidate",
        links: [card("design-concept").id]
      }
    ]
  });
  writeJson(projectPath, "design-system/token.json", {
    primitive: {
      "fontFamily.instrumentSans": {
        kind: "token",
        domain: "typography",
        value: "Instrument Sans, sans-serif",
        status: "candidate",
        links: [card("token").id]
      }
    },
    semantic: {},
    component: {}
  });
  writeJson(projectPath, "design-system/component-list.json", {
    components: []
  });
  writeJson(projectPath, "design-system/layout-rules.json", {
    rules: [
      {
        id: "layout-display-hierarchy",
        kind: "domain-rule",
        value: "Display titles remain the strongest visual layer.",
        meaning: "Display hierarchy",
        status: "candidate",
        links: [card("layout").id]
      }
    ]
  });
  writeJson(projectPath, "design-system/interaction-rules.json", {
    rules: [
      {
        id: "interaction-quiet-hover",
        kind: "domain-rule",
        value: "Hover feedback remains quiet.",
        meaning: "Quiet hover",
        status: "candidate",
        links: [card("interaction").id]
      }
    ]
  });

  const declarations = [
    [
      "design-system/design-system.json",
      "design-system.json",
      [card("design-concept").id, card("visual-language").id]
    ],
    ["design-system/token.json", "token.json", [card("token").id]],
    [
      "design-system/component-list.json",
      "component-list.json",
      [card("component").id]
    ],
    [
      "design-system/layout-rules.json",
      "layout-rules.json",
      [card("layout").id]
    ],
    [
      "design-system/interaction-rules.json",
      "interaction-rules.json",
      [card("interaction").id]
    ]
  ] as const;
  for (const [artifactPath, artifactType, relatedRecordIds] of declarations) {
    const declared = recordSourceArtifact(projectPath, {
      path: artifactPath,
      artifactType,
      semanticPurpose: "Initial Design System fixture",
      relatedRecordIds: [...relatedRecordIds]
    });
    if (!declared.ok) throw new Error(declared.reason);
  }
}


function recordCompleteProgressiveExtraction(
  fixture: ReturnType<typeof createCompletedAlignmentFixture>,
  claimed: Extract<
    ReturnType<typeof claimInitialDesignSystemPreparation>,
    { ok: true }
  >
) {
  const recordsFor = (section: string) => [
    ...claimed.question_cards.filter((card) => card.section === section),
    ...claimed.annotations.filter((annotation) => annotation.section === section)
  ];
  const targetFor = {
    "visual-language": {
      artifactPath: "design-system/design-system.json",
      entryId: "visual-language"
    },
    "design-concept": {
      artifactPath: "design-system/design-system.json",
      entryId: "principle-restraint"
    },
    token: {
      artifactPath: "design-system/token.json",
      entryId: "primitive.fontFamily.instrumentSans"
    },
    layout: {
      artifactPath: "design-system/layout-rules.json",
      entryId: "layout-display-hierarchy"
    },
    interaction: {
      artifactPath: "design-system/interaction-rules.json",
      entryId: "interaction-quiet-hover"
    }
  } as const;
  const claimsFor = (section: keyof typeof targetFor) =>
    recordsFor(section).map((record, index) => ({
      claimId: `progressive-${section}-${index + 1}`,
      statement:
        "final_answer" in record && record.final_answer
          ? record.final_answer
          : "body" in record
            ? record.body
            : `Evidence for ${section}`,
      sourceRecordIds: [record.id],
      sourceExcerpts: [
        "final_answer" in record && record.final_answer
          ? record.final_answer
          : "body" in record
            ? record.body
            : `Evidence for ${section}`
      ],
      confidence:
        "inference" in record ? record.inference : ("confirmed" as const),
      outcome: index === 0 ? ("mapped" as const) : ("omitted" as const),
      ...(index === 0
        ? { targets: [targetFor[section]] }
        : {
            reason: "The first source record already carries this output decision.",
            targets: []
          })
    }));
  const units = [
    {
      key: "global",
      workUnit: { kind: "global" as const },
      claims: [
        ...claimsFor("visual-language"),
        ...claimsFor("design-concept")
      ]
    },
    {
      key: "tokens",
      workUnit: COMPLETE_TOKENS_WORK_UNIT,
      claims: claimsFor("token")
    },
    {
      key: "layout",
      workUnit: { kind: "layout" as const },
      claims: claimsFor("layout")
    },
    {
      key: "interaction",
      workUnit: { kind: "interaction" as const },
      claims: claimsFor("interaction")
    }
  ];
  for (const unit of units) {
    const recorded = recordDesignSystemExtractionWorkUnit(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: `progressive-unit-${unit.key}`,
      workUnit: unit.workUnit,
      claims: unit.claims
    });
    if (!recorded.ok) throw new Error(recorded.reason);
  }
  const residualClaims = recordsFor("component").map((record, index) => ({
    claimId: `progressive-component-residual-${index + 1}`,
    statement:
      "final_answer" in record && record.final_answer
        ? record.final_answer
        : "body" in record
          ? record.body
          : "Component evidence",
    sourceRecordIds: [record.id],
    sourceExcerpts: [
      "final_answer" in record && record.final_answer
        ? record.final_answer
        : "body" in record
          ? record.body
          : "Component evidence"
    ],
    confidence:
      "inference" in record ? record.inference : ("confirmed" as const),
    outcome: "omitted" as const,
    reason: "The fixture intentionally contains no reusable component.",
    targets: []
  }));
  const checkedClaimIds = [
    ...units.flatMap((unit) => unit.claims.map((claim) => claim.claimId)),
    ...residualClaims.map((claim) => claim.claimId)
  ];
  const audit = recordDesignSystemExtractionAudit(fixture.projectPath, {
    alignmentAttemptId: fixture.attemptId,
    idempotencyKey: "progressive-audit-complete",
    residualClaims,
    audit: { status: "passed", checkedClaimIds, issues: [] }
  });
  if (!audit.ok) throw new Error(audit.reason);
  return audit;
}

function recordAuditForCurrentProgress(
  fixture: ReturnType<typeof createCompletedAlignmentFixture>,
  idempotencyKey: string
) {
  const recovered = claimInitialDesignSystemPreparation(fixture.projectPath);
  if (!recovered.ok) throw new Error(recovered.reason);
  const remainingRecords = [
    ...recovered.question_cards.filter((record) =>
      recovered.extraction_progress.remainingQuestionCardIds.includes(record.id)
    ),
    ...recovered.annotations.filter((record) =>
      recovered.extraction_progress.remainingAgentAnnotationIds.includes(record.id)
    ),
    ...recovered.designer_annotations.filter((record) =>
      recovered.extraction_progress.remainingDesignerAnnotationIds.includes(record.id)
    )
  ];
  const residualClaims = remainingRecords.map((record, index) => ({
    claimId: `${idempotencyKey}-residual-${index + 1}`,
    statement: "body" in record ? record.body : record.final_answer!,
    sourceRecordIds: [record.id],
    sourceExcerpts: ["body" in record ? record.body : record.final_answer!],
    confidence:
      "inference" in record ? record.inference : ("confirmed" as const),
    outcome: "omitted" as const,
    reason: "No additional reusable Design System decision remains.",
    targets: []
  }));
  const checkedClaimIds = [
    ...recovered.extraction_work_units.flatMap((workUnit) =>
      workUnit.claims.map((claim) => claim.claimId)
    ),
    ...residualClaims.map((claim) => claim.claimId)
  ];
  const audit = recordDesignSystemExtractionAudit(fixture.projectPath, {
    alignmentAttemptId: fixture.attemptId,
    idempotencyKey,
    residualClaims,
    audit: { status: "passed", checkedClaimIds, issues: [] }
  });
  if (!audit.ok) throw new Error(audit.reason);
  return audit;
}

afterEach(() => {
  for (const projectPath of projects.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

describe("Initial Design System preparation", () => {
  test("requires all three Draft foundation reviews before recording tokens", () => {
    expect(
      recordDesignSystemExtractionWorkUnitInputSchema.safeParse({
        alignmentAttemptId: "attempt-1",
        idempotencyKey: "tokens-complete",
        workUnit: COMPLETE_TOKENS_WORK_UNIT,
        claims: []
      }).success
    ).toBe(true);

    expect(
      recordDesignSystemExtractionWorkUnit("/unused", {
        alignmentAttemptId: "attempt-1",
        idempotencyKey: "tokens-incomplete",
        workUnit: { kind: "tokens" },
        claims: []
      })
    ).toEqual({
      ok: false,
      reason: "foundation_review_incomplete",
      details: {
        expected_owners: ["color", "typography", "material"],
        reviewed_owners: [],
        missing_owners: ["color", "typography", "material"]
      }
    });
  });

  test("models active and retired component work units as mutually exclusive MCP inputs", () => {
    const base = {
      alignmentAttemptId: "attempt-1",
      idempotencyKey: "retire-component-1"
    };
    expect(
      recordDesignSystemExtractionWorkUnitInputSchema.safeParse({
        ...base,
        workUnit: {
          kind: "component",
          componentEntryId: "component-text-link",
          retire: true
        },
        claims: []
      }).success
    ).toBe(true);
    expect(
      recordDesignSystemExtractionWorkUnitInputSchema.safeParse({
        ...base,
        workUnit: {
          kind: "component",
          componentEntryId: "component-text-link",
          specArtifactPath: "design-system/components/text-link.json",
          retire: true
        },
        claims: []
      }).success
    ).toBe(false);
  });

  test("records one output work unit from evidence spanning Alignment sections", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);

    const visualLanguageCard = claimed.question_cards.find(
      (card) => card.section === "visual-language"
    )!;
    const principleCard = claimed.question_cards.find(
      (card) => card.section === "design-concept"
    )!;
    const input = {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "global-work-unit-v1",
      workUnit: { kind: "global" } as const,
      claims: [
          {
            claimId: "global-editorial-language",
            statement:
              "The visual language and restraint principle form one editorial direction.",
            sourceRecordIds: [visualLanguageCard.id, principleCard.id],
            sourceExcerpts: [
              visualLanguageCard.final_answer!,
              principleCard.final_answer!
            ],
            confidence: "confirmed" as const,
            outcome: "mapped" as const,
            targets: [
              {
                artifactPath: "design-system/design-system.json",
                entryId: "visual-language"
              },
              {
                artifactPath: "design-system/design-system.json",
                entryId: "principle-restraint"
              }
            ]
          }
        ]
    };
    const recorded = recordDesignSystemExtractionWorkUnit(
      fixture.projectPath,
      input
    );

    expect(recorded).toMatchObject({
      ok: true,
      reused: false,
      work_unit: {
        key: "global",
        kind: "global",
        claims: [
          {
            claimId: "global-editorial-language",
            targets: [
              { entryId: "visual-language", jsonPointer: "/visualLanguage" },
              { entryId: "principle-restraint", jsonPointer: "/concepts/0" }
            ]
          }
        ]
      },
      progress: {
        completedWorkUnitKeys: ["global"],
        consumedSourceRecordIds: expect.arrayContaining([
          visualLanguageCard.id,
          principleCard.id
        ]),
        remainingQuestionCardIds: expect.not.arrayContaining([
          visualLanguageCard.id,
          principleCard.id
        ]),
        auditStatus: "pending",
        readyToFinalize: false
      }
    });

    expect(
      recordDesignSystemExtractionWorkUnit(fixture.projectPath, input)
    ).toMatchObject({
      ok: true,
      reused: true,
      work_unit: { key: "global", version: 1 }
    });

    const resumed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!resumed.ok) throw new Error(resumed.reason);
    expect(resumed).toMatchObject({
      extraction_work_units: [
        {
          key: "global",
          version: 1,
          claims: [
            {
              claimId: "global-editorial-language",
              targets: [
                { jsonPointer: "/visualLanguage" },
                { jsonPointer: "/concepts/0" }
              ]
            }
          ]
        }
      ],
      extraction_progress: {
        completedWorkUnitKeys: ["global"],
        auditStatus: "pending"
      }
    });
  });

  test("rejects non-foundation domains from the tokens storage work unit", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const tokenCard = claimed.question_cards.find(
      (card) => card.section === "token"
    )!;

    writeJson(fixture.projectPath, "design-system/token.json", {
      primitive: {
        "duration.fast": {
          kind: "token",
          domain: "motion",
          value: "120ms",
          status: "candidate",
          links: [tokenCard.id]
        }
      },
      semantic: {},
      component: {}
    });
    const redeclared = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "Exercise Draft foundation ownership routing",
      relatedRecordIds: [tokenCard.id]
    });
    if (!redeclared.ok) throw new Error(redeclared.reason);

    expect(
      recordDesignSystemExtractionWorkUnit(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "tokens-motion-mismatch",
        workUnit: COMPLETE_TOKENS_WORK_UNIT,
        claims: [
          {
            claimId: "motion-token",
            statement: "Feedback uses a short transition.",
            sourceRecordIds: [tokenCard.id],
            sourceExcerpts: [tokenCard.final_answer!],
            confidence: "confirmed",
            outcome: "mapped",
            targets: [
              {
                artifactPath: "design-system/token.json",
                entryId: "primitive.duration.fast"
              }
            ]
          }
        ]
      })
    ).toMatchObject({
      ok: false,
      reason: "foundation_owner_mismatch",
      details: {
        claim_id: "motion-token",
        domain: "motion",
        recommended_owner: "interaction",
        recommended_work_unit: "interaction"
      }
    });
  });

  test("replaces one work unit without disturbing other work units and recomputes coverage", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const card = (section: string) =>
      claimed.question_cards.find((candidate) => candidate.section === section)!;

    const globalV1 = recordDesignSystemExtractionWorkUnit(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "replace-global-v1",
      workUnit: { kind: "global" },
      claims: [
        {
          claimId: "global-v1",
          statement: "The global direction combines language and restraint.",
          sourceRecordIds: [
            card("visual-language").id,
            card("design-concept").id
          ],
          sourceExcerpts: [
            card("visual-language").final_answer!,
            card("design-concept").final_answer!
          ],
          confidence: "confirmed",
          outcome: "mapped",
          targets: [
            {
              artifactPath: "design-system/design-system.json",
              entryId: "visual-language"
            }
          ]
        }
      ]
    });
    if (!globalV1.ok) throw new Error(globalV1.reason);
    const tokens = recordDesignSystemExtractionWorkUnit(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "replace-tokens-v1",
      workUnit: COMPLETE_TOKENS_WORK_UNIT,
      claims: [
        {
          claimId: "token-family",
          statement: "Instrument Sans is the interface family.",
          sourceRecordIds: [card("token").id],
          sourceExcerpts: [card("token").final_answer!],
          confidence: "confirmed",
          outcome: "mapped",
          targets: [
            {
              artifactPath: "design-system/token.json",
              entryId: "primitive.fontFamily.instrumentSans"
            }
          ]
        }
      ]
    });
    if (!tokens.ok) throw new Error(tokens.reason);

    const replaced = recordDesignSystemExtractionWorkUnit(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "replace-global-v2",
      workUnit: { kind: "global" },
      claims: [
        {
          claimId: "global-v2",
          statement: "Restraint preserves hierarchy.",
          sourceRecordIds: [card("design-concept").id],
          sourceExcerpts: [card("design-concept").final_answer!],
          confidence: "confirmed",
          outcome: "mapped",
          targets: [
            {
              artifactPath: "design-system/design-system.json",
              entryId: "principle-restraint"
            }
          ]
        }
      ]
    });

    expect(replaced).toMatchObject({
      ok: true,
      work_unit: { key: "global", version: 2 },
      progress: {
        completedWorkUnitKeys: ["tokens", "global"],
        consumedSourceRecordIds: expect.arrayContaining([
          card("design-concept").id,
          card("token").id
        ]),
        remainingQuestionCardIds: expect.arrayContaining([
          card("visual-language").id
        ])
      }
    });
    expect(replaced.ok && replaced.progress.consumedSourceRecordIds).not.toContain(
      card("visual-language").id
    );
  });

  test("re-claim reports a typed recovery error when an artifact removes a recorded target", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const tokenCard = claimed.question_cards.find(
      (card) => card.section === "token"
    )!;
    const recorded = recordDesignSystemExtractionWorkUnit(
      fixture.projectPath,
      {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "recovery-token-v1",
        workUnit: COMPLETE_TOKENS_WORK_UNIT,
        claims: [
          {
            claimId: "recovery-token-family",
            statement: tokenCard.final_answer!,
            sourceRecordIds: [tokenCard.id],
            sourceExcerpts: [tokenCard.final_answer!],
            confidence: "confirmed",
            outcome: "mapped",
            targets: [
              {
                artifactPath: "design-system/token.json",
                entryId: "primitive.fontFamily.instrumentSans"
              }
            ]
          }
        ]
      }
    );
    if (!recorded.ok) throw new Error(recorded.reason);

    writeJson(fixture.projectPath, "design-system/token.json", {
      primitive: {},
      semantic: {},
      component: {}
    });
    const redeclared = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "Remove the recorded token target",
      relatedRecordIds: [tokenCard.id]
    });
    if (!redeclared.ok) throw new Error(redeclared.reason);

    const recovered = claimInitialDesignSystemPreparation(fixture.projectPath);
    expect(recovered).toMatchObject({
      ok: true,
      extraction_work_units: [
        {
          key: "tokens",
          resolutionError: {
            reason: "manifest_target_not_found",
            details: {
              claim_id: "recovery-token-family",
              artifact_path: "design-system/token.json",
              entry_id: "primitive.fontFamily.instrumentSans"
            }
          }
        }
      ]
    });
  });

  test("records component inventory, spec, and field omissions as one work unit", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const componentCard = claimed.question_cards.find(
      (card) => card.section === "component"
    )!;
    const interactionCard = claimed.question_cards.find(
      (card) => card.section === "interaction"
    )!;

    writeJson(fixture.projectPath, "design-system/component-list.json", {
      components: [
        {
          id: "component-text-link",
          value: { name: "TextLink", specPath: "components/text-link.json" },
          meaning: "Inline label-and-arrow call to action",
          status: "candidate",
          links: [componentCard.id]
        }
      ]
    });
    const inventory = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/component-list.json",
      artifactType: "component-list.json",
      semanticPurpose: "Component work-unit inventory",
      relatedRecordIds: [componentCard.id]
    });
    if (!inventory.ok) throw new Error(inventory.reason);

    const workUnitInput = {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "component-text-link-v1",
      workUnit: {
        kind: "component" as const,
        componentEntryId: "component-text-link",
        specArtifactPath: "design-system/components/text-link.json"
      },
      claims: [
        {
          claimId: "component-text-link-contract",
          statement:
            "TextLink combines the component identity with its interaction behavior.",
          sourceRecordIds: [componentCard.id, interactionCard.id],
          sourceExcerpts: [
            componentCard.final_answer!,
            interactionCard.final_answer!
          ],
          confidence: "confirmed" as const,
          outcome: "mapped" as const,
          targets: [
            {
              artifactPath: "design-system/component-list.json",
              entryId: "component-text-link"
            },
            {
              artifactPath: "design-system/components/text-link.json",
              entryId: "component-text-link-spec"
            }
          ]
        },
        {
          claimId: "component-text-link-code-gap",
          statement: "No implementation code link exists yet.",
          sourceRecordIds: [componentCard.id],
          sourceExcerpts: [componentCard.final_answer!],
          confidence: "confirmed" as const,
          outcome: "omitted" as const,
          reason: "Initial extraction has no prototype implementation.",
          targets: [
            {
              artifactPath: "design-system/components/text-link.json",
              entryId: "component-text-link-spec",
              fieldPath: ["value", "codeLinks"]
            }
          ]
        }
      ]
    };

    expect(
      recordDesignSystemExtractionWorkUnit(
        fixture.projectPath,
        workUnitInput
      )
    ).toMatchObject({
      ok: false,
      reason: "work_unit_artifact_not_ingested",
      details: {
        artifact_path: "design-system/components/text-link.json"
      }
    });

    writeJson(
      fixture.projectPath,
      "design-system/components/text-link.json",
      {
        id: "component-text-link-spec",
        name: "TextLink",
        value: {
          description: "Label-and-arrow CTA",
          props: [],
          variants: [],
          stateMatrix: [],
          guidelines: [],
          tokenLinks: [],
          codeLinks: [],
          sourceCaptures: {}
        },
        status: "candidate",
        links: [componentCard.id]
      }
    );
    expect(
      recordSourceArtifact(fixture.projectPath, {
        path: "design-system/components/text-link.json",
        artifactType: "component-spec",
        semanticPurpose: "Invalid component capture fixture",
        relatedRecordIds: [componentCard.id]
      })
    ).toMatchObject({
      ok: false,
      reason: "invalid_field_type",
      details: { field: "value.sourceCaptures", expected: "array" }
    });

    writeJson(
      fixture.projectPath,
      "design-system/captures/text-link.png",
      "png"
    );
    writeJson(
      fixture.projectPath,
      "design-system/components/text-link.json",
      {
        id: "component-text-link-spec",
        name: "TextLink",
        value: {
          description: "Label-and-arrow CTA",
          props: [{ name: "label", type: "string" }],
          variants: [{ axis: "style", name: "text-link" }],
          stateMatrix: [
            { state: "default", behavior: "Inline text link" },
            { state: "hover", behavior: "Arrow shifts right" }
          ],
          guidelines: [
            { kind: "dont", text: "Never render a filled background." }
          ],
          tokenLinks: ["semantic.text.action"],
          codeLinks: [],
          group: "component",
          sourceCaptures: [
            {
              nodeName: "TextLink",
              artifactPath: "design-system/captures/text-link.png",
              capturedAt: "2026-08-05T00:00:00.000Z"
            }
          ]
        },
        status: "candidate",
        links: [componentCard.id, interactionCard.id]
      }
    );
    const spec = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/components/text-link.json",
      artifactType: "component-spec",
      semanticPurpose: "Component work-unit spec",
      relatedRecordIds: [componentCard.id, interactionCard.id]
    });
    if (!spec.ok) throw new Error(spec.reason);

    expect(
      recordDesignSystemExtractionWorkUnit(fixture.projectPath, {
        ...workUnitInput,
        idempotencyKey: "component-mismatched-identity",
        workUnit: {
          ...workUnitInput.workUnit,
          componentEntryId: "component-other"
        }
      })
    ).toMatchObject({
      ok: false,
      reason: "component_work_unit_mismatch"
    });
    const capturePath = path.join(
      fixture.projectPath,
      "design-system/captures/text-link.png"
    );
    mkdirSync(path.dirname(capturePath), { recursive: true });
    writeFileSync(capturePath, "fixture-png", "utf8");
    expect(
      recordDesignSystemExtractionWorkUnit(fixture.projectPath, {
        ...workUnitInput,
        idempotencyKey: "component-foreign-inventory-target",
        claims: [
          {
            ...workUnitInput.claims[0],
            targets: [
              ...workUnitInput.claims[0].targets,
              {
                artifactPath: "design-system/component-list.json",
                entryId: "component-other"
              }
            ]
          },
          workUnitInput.claims[1]
        ]
      })
    ).toMatchObject({
      ok: false,
      reason: "component_work_unit_mismatch",
      details: { problem: "target_owned_by_another_component" }
    });
    rmSync(capturePath, { force: true });

    expect(
      recordDesignSystemExtractionWorkUnit(
        fixture.projectPath,
        workUnitInput
      )
    ).toMatchObject({
      ok: false,
      reason: "component_capture_missing",
      details: {
        captures: [
          {
            entry_id: "component-text-link-spec",
            artifact_path: "design-system/captures/text-link.png"
          }
        ]
      }
    });
    writeFileSync(capturePath, "fixture-png", "utf8");

    const recorded = recordDesignSystemExtractionWorkUnit(
      fixture.projectPath,
      workUnitInput
    );
    expect(recorded).toMatchObject({
      ok: true,
      work_unit: {
        key: "component:component-text-link",
        kind: "component",
        claims: [
          {
            claimId: "component-text-link-contract",
            targets: [
              { jsonPointer: "/components/0" },
              { jsonPointer: "" }
            ]
          },
          {
            claimId: "component-text-link-code-gap",
            targets: [{ jsonPointer: "/value/codeLinks" }]
          }
        ]
      }
    });

    writeJson(fixture.projectPath, "design-system/component-list.json", {
      components: []
    });
    const removedInventory = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/component-list.json",
      artifactType: "component-list.json",
      semanticPurpose: "Component inventory after TextLink removal",
      relatedRecordIds: [componentCard.id]
    });
    if (!removedInventory.ok) throw new Error(removedInventory.reason);

    const recoveryWithObsoleteUnit = claimInitialDesignSystemPreparation(
      fixture.projectPath
    );
    expect(recoveryWithObsoleteUnit).toMatchObject({
      ok: true,
      extraction_work_units: [
        {
          key: "component:component-text-link",
          resolutionError: { reason: "manifest_target_not_found" }
        }
      ],
      extraction_progress: { readyToFinalize: false }
    });

    const retirementInput = {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "component-text-link-retire",
      workUnit: {
        kind: "component" as const,
        componentEntryId: "component-text-link",
        retire: true
      },
      claims: []
    };
    expect(
      recordDesignSystemExtractionWorkUnit(fixture.projectPath, {
        ...retirementInput,
        idempotencyKey: "component-text-link-invalid-retire-claims",
        claims: [workUnitInput.claims[0]]
      })
    ).toEqual({ ok: false, reason: "invalid_work_unit" });
    const retired = recordDesignSystemExtractionWorkUnit(
      fixture.projectPath,
      retirementInput
    );
    expect(retired).toMatchObject({
      ok: true,
      reused: false,
      retired: true,
      work_unit_key: "component:component-text-link",
      progress: {
        completedWorkUnitKeys: [],
        auditStatus: "pending",
        readyToFinalize: false
      }
    });
    expect(
      recordDesignSystemExtractionWorkUnit(
        fixture.projectPath,
        retirementInput
      )
    ).toMatchObject({
      ok: true,
      reused: true,
      retired: true,
      work_unit_key: "component:component-text-link"
    });

    const recoveredAfterRetirement = claimInitialDesignSystemPreparation(
      fixture.projectPath
    );
    expect(recoveredAfterRetirement).toMatchObject({
      ok: true,
      extraction_work_units: [],
      extraction_residual_claims: [],
      extraction_audit: null,
      extraction_progress: {
        completedWorkUnitKeys: [],
        auditStatus: "pending",
        readyToFinalize: false
      }
    });
    const viewAfterRetirement = getDesignSystemView(fixture.projectPath);
    expect(viewAfterRetirement).toMatchObject({ ok: true });
    if (!viewAfterRetirement.ok) throw new Error(viewAfterRetirement.reason);
    expect(viewAfterRetirement.view.components.specs).toEqual([]);

    const auditAfterRetirement = recordCompleteProgressiveExtraction(
      fixture,
      claimed
    );
    expect(auditAfterRetirement.progress.readyToFinalize).toBe(true);
    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: true,
      command: { status: "completed" },
      extraction_progress: { readyToFinalize: true }
    });
  });

  test("records the residual audit only after every frozen input is consumed", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const card = (section: string) =>
      claimed.question_cards.find((candidate) => candidate.section === section)!;
    const units = [
      {
        definition: { kind: "global" as const },
        idempotencyKey: "audit-global",
        claimId: "audit-global-claim",
        sources: [card("visual-language"), card("design-concept")],
        targets: [
          {
            artifactPath: "design-system/design-system.json",
            entryId: "visual-language"
          },
          {
            artifactPath: "design-system/design-system.json",
            entryId: "principle-restraint"
          }
        ]
      },
      {
        definition: COMPLETE_TOKENS_WORK_UNIT,
        idempotencyKey: "audit-tokens",
        claimId: "audit-token-claim",
        sources: [card("token")],
        targets: [
          {
            artifactPath: "design-system/token.json",
            entryId: "primitive.fontFamily.instrumentSans"
          }
        ]
      },
      {
        definition: { kind: "layout" as const },
        idempotencyKey: "audit-layout",
        claimId: "audit-layout-claim",
        sources: [card("layout")],
        targets: [
          {
            artifactPath: "design-system/layout-rules.json",
            entryId: "layout-display-hierarchy"
          }
        ]
      },
      {
        definition: { kind: "interaction" as const },
        idempotencyKey: "audit-interaction",
        claimId: "audit-interaction-claim",
        sources: [card("interaction")],
        targets: [
          {
            artifactPath: "design-system/interaction-rules.json",
            entryId: "interaction-quiet-hover"
          }
        ]
      }
    ];
    for (const unit of units) {
      const result = recordDesignSystemExtractionWorkUnit(
        fixture.projectPath,
        {
          alignmentAttemptId: fixture.attemptId,
          idempotencyKey: unit.idempotencyKey,
          workUnit: unit.definition,
          claims: [
            {
              claimId: unit.claimId,
              statement: unit.sources.map((source) => source.final_answer).join(" "),
              sourceRecordIds: unit.sources.map((source) => source.id),
              sourceExcerpts: unit.sources.map((source) => source.final_answer!),
              confidence: "confirmed",
              outcome: "mapped",
              targets: unit.targets
            }
          ]
        }
      );
      if (!result.ok) throw new Error(result.reason);
    }

    expect(
      recordDesignSystemExtractionAudit(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "audit-incomplete",
        residualClaims: [],
        audit: {
          status: "passed",
          checkedClaimIds: units.map((unit) => unit.claimId),
          issues: []
        }
      })
    ).toMatchObject({
      ok: false,
      reason: "input_coverage_incomplete",
      details: {
        missing_question_card_ids: expect.any(Array),
        missing_agent_annotation_ids: expect.any(Array)
      }
    });

    const resumed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!resumed.ok) throw new Error(resumed.reason);
    const remainingRecords = [
      ...resumed.question_cards.filter((record) =>
        resumed.extraction_progress.remainingQuestionCardIds.includes(record.id)
      ),
      ...resumed.annotations.filter((record) =>
        resumed.extraction_progress.remainingAgentAnnotationIds.includes(record.id)
      ),
      ...resumed.designer_annotations.filter((record) =>
        resumed.extraction_progress.remainingDesignerAnnotationIds.includes(record.id)
      )
    ];
    const residualClaims = remainingRecords.map((record, index) => ({
      claimId: `residual-${index + 1}`,
      statement: "body" in record ? record.body : record.final_answer!,
      sourceRecordIds: [record.id],
      sourceExcerpts: ["body" in record ? record.body : record.final_answer!],
      confidence:
        "inference" in record ? record.inference : ("confirmed" as const),
      outcome: "omitted" as const,
      reason: "No additional reusable Design System decision remains.",
      targets: []
    }));
    const checkedClaimIds = [
      ...units.map((unit) => unit.claimId),
      ...residualClaims.map((claim) => claim.claimId)
    ];
    const audit = recordDesignSystemExtractionAudit(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "audit-complete",
      residualClaims,
      audit: {
        status: "passed",
        checkedClaimIds,
        issues: []
      }
    });
    expect(audit).toMatchObject({
      ok: true,
      reused: false,
      audit: { status: "passed", checkedClaimIds },
      progress: {
        completedWorkUnitKeys: ["global", "tokens", "layout", "interaction"],
        remainingQuestionCardIds: [],
        remainingAgentAnnotationIds: [],
        remainingDesignerAnnotationIds: [],
        auditStatus: "passed",
        readyToFinalize: true
      }
    });

    const recoveredAudit = claimInitialDesignSystemPreparation(
      fixture.projectPath
    );
    if (!recoveredAudit.ok) throw new Error(recoveredAudit.reason);
    expect(recoveredAudit.extraction_residual_claims).toEqual(residualClaims);

    const interactionUnit = units.find(
      (unit) => unit.definition.kind === "interaction"
    )!;
    const replaced = recordDesignSystemExtractionWorkUnit(
      fixture.projectPath,
      {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "audit-interaction-replaced",
        workUnit: interactionUnit.definition,
        claims: [
          {
            claimId: interactionUnit.claimId,
            statement: interactionUnit.sources
              .map((source) => source.final_answer)
              .join(" "),
            sourceRecordIds: interactionUnit.sources.map((source) => source.id),
            sourceExcerpts: interactionUnit.sources.map(
              (source) => source.final_answer!
            ),
            confidence: "confirmed",
            outcome: "mapped",
            targets: interactionUnit.targets
          }
        ]
      }
    );
    expect(replaced).toMatchObject({
      ok: true,
      progress: {
        auditStatus: "pending",
        readyToFinalize: false
      }
    });
    if (!replaced.ok) throw new Error(replaced.reason);
    expect(replaced.progress.remainingQuestionCardIds.length).toBeGreaterThan(0);
    const recoveredReplacement = claimInitialDesignSystemPreparation(
      fixture.projectPath
    );
    if (!recoveredReplacement.ok) throw new Error(recoveredReplacement.reason);
    expect(recoveredReplacement.extraction_residual_claims).toEqual([]);
    expect(
      recoveredReplacement.extraction_progress.remainingQuestionCardIds.length
    ).toBeGreaterThan(0);
  });

  test("publishes the extraction writing contract through the claim payload source_contract", () => {
    // Issue 18: the writing contract's single home is the source_contract
    // payload (sourced from the schema validators), not the MCP instructions.
    const contract = INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT;
    expect(contract.entry_kind_file_ownership).toEqual({
      token: ["token.json"],
      "domain-rule": ["token.json", "layout-rules.json", "interaction-rules.json"],
      "global-rule": ["design-system.json"]
    });
    expect(contract.token_domains).toContain("color");
    expect(contract.token_domains).toContain("typography");
    expect(contract.foundation_ownership).toMatchObject({
      owners: ["color", "typography", "material"],
      token_domains: {
        color: ["color"],
        typography: ["typography"],
        material: expect.arrayContaining(["spacing", "radius", "shadow"])
      },
      reroute: {
        motion: { owner: "interaction", work_unit: "interaction" },
        breakpoint: { owner: "layout", work_unit: "layout" },
        other: { owner: "unresolved", work_unit: null }
      }
    });
    expect(contract.token_open_gap_policy).toEqual({
      representation: "domain-rule",
      status: "gap",
      links: "Open-gap rules carry an empty links array.",
      guidance: expect.stringContaining("Never infer a gap from an unconsumed primitive")
    });
    expect(contract.rule_taxonomy).toEqual({
      interaction_rules: "Cross-component interaction and motion strategies.",
      component_specs: "Component-bound behavior, states, and motion.",
      layout_rules: "Spatial composition and layout behavior.",
      self_audit:
        "When writing a rule, inspect existing rules in that file for placement. Propose misplaced-rule moves through the rule-update proposal channel; never move rules silently."
    });

    expect(contract.rule_body).toEqual({
      applies_to: ["global-rule", "domain-rule"],
      field: "value",
      type: "non-empty prose string"
    });
    const style = contract.rule_body_writing_style;
    expect(style.shape).toContain("non-empty prose string");
    expect(style.rules.join(" ")).toContain("complete reusable decision");
    expect(style.rules.join(" ")).toContain("stable rule title in meaning");
    expect(style.rules.join(" ")).toContain("designer's source text");
    expect(style.rules.join(" ")).toContain("generalize beyond the evidence");
    expect(style.examples.layout.good.meaning).toBe("横向画廊用于连续浏览项目。");
    expect(typeof style.examples.layout.good.value).toBe("string");
    expect(typeof style.examples.interaction.good.value).toBe("string");
    expect(style.examples.layout.bad.value).toEqual(expect.any(Object));

    const typography = contract.typography_role_writing_style;
    expect(typography.rules.join(" ")).toContain("complete composite");
    expect(typography.examples.bad.value.usedFor).toBe(
      "Connect call-to-action heading size role."
    );

    expect(contract.omitted_component_spec_fields).toEqual([
      ...RICH_COMPONENT_SPEC_FIELDS
    ]);
    expect(contract.file_scaffolds).toEqual(INITIAL_DESIGN_SYSTEM_FILE_SCAFFOLDS);
    expect(contract.work_unit_examples).toEqual(
      INITIAL_DESIGN_SYSTEM_WORK_UNIT_EXAMPLES
    );
  });

  test("publishes schema-valid file scaffolds and a codeLinks omitted work-unit example", () => {
    for (const [fileKind, scaffold] of Object.entries(
      INITIAL_DESIGN_SYSTEM_FILE_SCAFFOLDS
    ) as Array<[DesignSystemFileKind, unknown]>) {
      expect(
        validateDesignSystemJson(fileKind, scaffold),
        `${fileKind} scaffold must pass the current schema validator`
      ).toEqual({ ok: true });
    }

    const example = INITIAL_DESIGN_SYSTEM_WORK_UNIT_EXAMPLES.component;
    expect(example.omitted_field_path).toEqual(["value", "codeLinks"]);
    expect(example.workUnit).toEqual({
      kind: "component",
      componentEntryId: "component-example",
      specArtifactPath: "design-system/components/example.json"
    });
    expect(example.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimId: "component-example-code-gap",
          outcome: "omitted",
          targets: [
            expect.objectContaining({
              artifactPath: "design-system/components/example.json",
              entryId: "component-example-spec",
              fieldPath: ["value", "codeLinks"]
            })
          ]
        })
      ])
    );

    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    expect(claimed).toMatchObject({
      ok: true,
      source_contract: {
        omitted_component_spec_fields: [...RICH_COMPONENT_SPEC_FIELDS],
        file_scaffolds: INITIAL_DESIGN_SYSTEM_FILE_SCAFFOLDS,
        work_unit_examples: INITIAL_DESIGN_SYSTEM_WORK_UNIT_EXAMPLES
      }
    });
  });

  test("claims the durable command idempotently with the complete immutable context", () => {
    const fixture = createCompletedAlignmentFixture();

    const first = claimInitialDesignSystemPreparation(fixture.projectPath);
    expect(first).toMatchObject({
      ok: true,
      reused: false,
      command: {
        id: fixture.commandId,
        command_type: "prepare_initial_design_system",
        status: "claimed"
      },
      attempt: {
        id: fixture.attemptId,
        status: "completed",
        input_snapshot_id: fixture.snapshotId
      },
      input_snapshot: {
        id: fixture.snapshotId,
        data: {
          design_language_description:
            "A sparse editorial system led by exact typography.",
          seed_references: [
            {
              id: fixture.seedId,
              evidence_version: { id: fixture.evidenceId }
            }
          ]
        }
      },
      required_artifacts: [
        "design-system/design-system.json",
        "design-system/token.json",
        "design-system/component-list.json",
        "design-system/layout-rules.json",
        "design-system/interaction-rules.json"
      ],
      source_contract: {
        schema_version: 3,
        source_root: "design-system",
        entry_envelope: expect.arrayContaining([
          "kind",
          "value",
          "meaning",
          "status",
          "links"
        ]),
        entry_envelope_policy: {
          meaning: expect.stringContaining("rules only")
        },
        entry_kinds: ["token", "domain-rule", "global-rule"],
        entry_kind_file_ownership: {
          token: ["token.json"],
          "domain-rule": [
            "token.json",
            "layout-rules.json",
            "interaction-rules.json"
          ],
          "global-rule": ["design-system.json"]
        },
        token_domains: expect.arrayContaining([
          "color",
          "typography",
          "spacing",
          "motion"
        ]),
        token_usage_policy: {
          primitive: expect.stringContaining("neither meaning nor a usage field"),
          typography: expect.stringContaining("value.usedFor"),
          other_domains: expect.stringContaining("value.usage"),
          fail_closed: expect.stringContaining("Token meaning is forbidden")
        },
        token_open_gap_policy: {
          representation: "domain-rule",
          status: "gap",
          links: expect.stringContaining("empty"),
          guidance: expect.stringContaining("unconsumed primitive")
        },
        component_spec_fields: expect.arrayContaining([
          "description",
          "props",
          "variants",
          "stateMatrix",
          "guidelines",
          "tokenLinks",
          "codeLinks"
        ]),
        component_spec_writing_policy: {
          value_keys: expect.stringContaining("closed"),
          description: expect.stringContaining("do not write meaning"),
          variants: expect.stringContaining('axis: "size"'),
          states: expect.stringContaining("stateMatrix"),
          guidelines: expect.stringContaining("do/dont"),
          unresolved_questions: expect.stringContaining("residual extraction claims")
        },
        rule_body: {
          applies_to: ["global-rule", "domain-rule"],
          field: "value",
          type: "non-empty prose string"
        },
        layout_rule_capture_field: {
          field: "sourceCaptures",
          item_required: expect.arrayContaining([
            "nodeName",
            "artifactPath",
            "capturedAt"
          ]),
          item_optional: expect.arrayContaining(["nodeId", "surfaceId"]),
          guidance: expect.stringContaining("Runtime derives")
        },
        interaction_entry_split: {
          interaction_rules:
            "Cross-component interaction and motion strategies only.",
          component_specs:
            "Component-bound behavior and motion belong on stateMatrix rows in the matching component spec."
        },
        typography_role_writing_style: {
          role_value_fields: expect.arrayContaining([
            "fontFamily",
            "fontSize",
            "fontWeight",
            "lineHeight",
            "letterSpacing",
            "textTransform"
          ]),
          rules: expect.arrayContaining([
            expect.stringContaining("composite token"),
            expect.stringContaining("usage context"),
            expect.stringContaining("Do not invent")
          ]),
          examples: {
            good: expect.objectContaining({
              name: "typography.connectHeading",
              value: expect.objectContaining({
                usedFor: "Closing-section call to action."
              })
            }),
            bad: expect.objectContaining({
              value: expect.objectContaining({
                usedFor: "Connect call-to-action heading size role."
              })
            })
          }
        },
        rule_body_writing_style: {
          shape: expect.stringContaining("prose string"),
          rules: expect.arrayContaining([
            expect.stringContaining("complete reusable decision"),
            expect.stringContaining("stable rule title"),
            expect.stringContaining("language of the designer's source text")
          ]),
          examples: {
            layout: {
              good: expect.any(Object),
              bad: expect.any(Object)
            },
            interaction: {
              good: expect.any(Object),
              bad: expect.any(Object)
            }
          }
        }
      },
      declared_artifacts: []
    });
    if (!first.ok) return;
    expect(first.source_contract.component_spec_fields).not.toContain("states");
    expect(first.question_cards).toHaveLength(12);
    expect(first.question_cards.every((card) => card.status === "answered")).toBe(
      true
    );
    expect(first.annotations).toHaveLength(6);
    expect(first.designer_annotations).toEqual([]);

    const second = claimInitialDesignSystemPreparation(fixture.projectPath);
    expect(second).toMatchObject({
      ok: true,
      reused: true,
      command: { id: fixture.commandId, status: "claimed" },
      event_id: null
    });
  });

  test("keeps Browser writes open during progressive extraction", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);

    // The designer's approve/edit stay available while extraction is in
    // flight. Conflicts are handled by the optimistic concurrency guards,
    // not by locking writes.
    expect(
      approveDesignSystemEntry(fixture.projectPath, {
        sourceArtifactPath: "design-system/design-system.json",
        entryId: "visual-language",
        targetStatus: "formalized"
      })
    ).toMatchObject({ ok: true, entry: { status: "formalized" } });
    const edit = editDesignSystemEntry(fixture.projectPath, {
      sourceArtifactPath: "design-system/design-system.json",
      entryId: "visual-language",
      field: "value.description",
      text: "Designer-edited mid-extraction."
    });
    expect(edit).toMatchObject({ ok: true });
    if (!edit.ok) throw new Error(edit.reason);

    const audit = recordCompleteProgressiveExtraction(fixture, claimed);
    expect(audit.progress.readyToFinalize).toBe(true);

    // The conflict surfaces explicitly at finalize instead of being locked
    // out up front: the designer's edit appended its event id to the entry
    // links, which the extraction claims do not cover, so the lineage audit
    // fails with a typed, retryable reason naming the entry and the exact
    // unclaimed link (the edit event id).
    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "entry_claim_lineage_mismatch",
      details: {
        entries: [
          {
            source_artifact_path: "design-system/design-system.json",
            entry_id: "visual-language",
            unclaimed_link_ids: [edit.event_id]
          }
        ]
      }
    });
  });

  test("finalize preserves uncovered-entry and bidirectional-lineage gates", () => {
    for (const scenario of ["uncovered", "lineage"] as const) {
      const fixture = createCompletedAlignmentFixture();
      const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
      if (!claimed.ok) throw new Error(claimed.reason);
      declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
      recordCompleteProgressiveExtraction(fixture, claimed);
      const tokenCards = claimed.question_cards.filter(
        (card) => card.section === "token"
      );
      const primitive: Record<string, unknown> = {
        "fontFamily.instrumentSans": {
          kind: "token",
          domain: "typography",
          value: "Instrument Sans, sans-serif",
          status: "candidate",
          links:
            scenario === "lineage"
              ? [tokenCards[0]!.id, tokenCards[1]!.id]
              : [tokenCards[0]!.id]
        }
      };
      if (scenario === "uncovered") {
        primitive["fontSize.body"] = {
          kind: "token",
          domain: "typography",
          value: "16px",
          status: "candidate",
          links: [tokenCards[0]!.id]
        };
      }
      writeJson(fixture.projectPath, "design-system/token.json", {
        primitive,
        semantic: {},
        component: {}
      });
      const redeclared = recordSourceArtifact(fixture.projectPath, {
        path: "design-system/token.json",
        artifactType: "token.json",
        semanticPurpose: `${scenario} finalize fixture`,
        relatedRecordIds: tokenCards.map((card) => card.id)
      });
      if (!redeclared.ok) throw new Error(redeclared.reason);


      expect(
        finalizeInitialDesignSystemPreparation(
          fixture.projectPath,
          fixture.attemptId
        )
      ).toMatchObject(
        scenario === "uncovered"
          ? {
              ok: false,
              reason: "uncovered_design_system_entries",
              details: {
                entries: [
                  {
                    source_artifact_path: "design-system/token.json",
                    entry_id: "primitive.fontSize.body"
                  }
                ]
              }
            }
          : {
              ok: false,
              reason: "entry_claim_lineage_mismatch",
              details: {
                entries: [
                  expect.objectContaining({
                    source_artifact_path: "design-system/token.json",
                    entry_id: "primitive.fontFamily.instrumentSans",
                    unclaimed_link_ids: [tokenCards[1]!.id]
                  })
                ]
              }
            }
      );
    }
  });

  test("finalize returns lineage and empty-codeLinks blockers together", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);

    const componentCard = claimed.question_cards.find(
      (card) => card.section === "component"
    )!;
    const tokenCards = claimed.question_cards.filter(
      (card) => card.section === "token"
    );
    writeJson(fixture.projectPath, "design-system/component-list.json", {
      components: [
        {
          id: "component-example",
          value: { name: "Example", specPath: "components/example.json" },
          meaning: "Example component",
          status: "candidate",
          links: [componentCard.id]
        }
      ]
    });
    writeJson(fixture.projectPath, "design-system/components/example.json", {
      id: "component-example-spec",
      name: "Example",
      value: {
        description: "Example contract",
        props: [{ name: "label", type: "string" }],
        variants: [{ axis: "style", name: "default" }],
        stateMatrix: [{ state: "default", behavior: "Default presentation" }],
        guidelines: [{ kind: "do", text: "Use for its documented job." }],
        tokenLinks: ["primitive.fontFamily.instrumentSans"],
        codeLinks: []
      },
      status: "candidate",
      links: [componentCard.id]
    });
    const inventory = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/component-list.json",
      artifactType: "component-list.json",
      semanticPurpose: "Combined blocker inventory",
      relatedRecordIds: [componentCard.id]
    });
    if (!inventory.ok) throw new Error(inventory.reason);
    const spec = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/components/example.json",
      artifactType: "component-spec",
      semanticPurpose: "Combined blocker spec",
      relatedRecordIds: [componentCard.id]
    });
    if (!spec.ok) throw new Error(spec.reason);

    recordCompleteProgressiveExtraction(fixture, claimed);
    const componentUnit = recordDesignSystemExtractionWorkUnit(
      fixture.projectPath,
      {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "combined-blocker-component",
        workUnit: {
          kind: "component",
          componentEntryId: "component-example",
          specArtifactPath: "design-system/components/example.json"
        },
        claims: [
          {
            claimId: "component-example-mapped",
            statement: componentCard.final_answer!,
            sourceRecordIds: [componentCard.id],
            sourceExcerpts: [componentCard.final_answer!],
            confidence: "confirmed",
            outcome: "mapped",
            targets: [
              {
                artifactPath: "design-system/component-list.json",
                entryId: "component-example"
              },
              {
                artifactPath: "design-system/components/example.json",
                entryId: "component-example-spec"
              }
            ]
          }
        ]
      }
    );
    if (!componentUnit.ok) throw new Error(componentUnit.reason);

    writeJson(fixture.projectPath, "design-system/token.json", {
      primitive: {
        "fontFamily.instrumentSans": {
          kind: "token",
          domain: "typography",
          value: "Instrument Sans, sans-serif",
          status: "candidate",
          links: [tokenCards[0]!.id, tokenCards[1]!.id]
        }
      },
      semantic: {},
      component: {}
    });
    const redeclared = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "Combined blocker lineage",
      relatedRecordIds: tokenCards.map((card) => card.id)
    });
    if (!redeclared.ok) throw new Error(redeclared.reason);

    recordAuditForCurrentProgress(fixture, "combined-blocker-audit");

    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "entry_claim_lineage_mismatch",
      details: {
        entries: [
          expect.objectContaining({
            source_artifact_path: "design-system/token.json",
            entry_id: "primitive.fontFamily.instrumentSans",
            unclaimed_link_ids: [tokenCards[1]!.id]
          })
        ],
        blockers: [
          {
            reason: "entry_claim_lineage_mismatch",
            details: {
              entries: [
                expect.objectContaining({
                  entry_id: "primitive.fontFamily.instrumentSans"
                })
              ]
            }
          },
          {
            reason: "component_spec_fields_missing",
            details: {
              specs: [
                expect.objectContaining({
                  source_artifact_path: "design-system/components/example.json",
                  entry_id: "component-example-spec",
                  unexplained_empty_fields: ["codeLinks"]
                })
              ]
            }
          }
        ]
      }
    });
  });

  test("finalize preserves target, kind, and token-domain gates", () => {
    for (const scenario of ["target", "kind", "domain"] as const) {
      const fixture = createCompletedAlignmentFixture();
      const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
      if (!claimed.ok) throw new Error(claimed.reason);
      declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
      recordCompleteProgressiveExtraction(fixture, claimed);
      const tokenCard = claimed.question_cards.find(
        (card) => card.section === "token"
      )!;
      const tokenEntry = {
        ...(scenario === "kind" ? {} : { kind: "token" }),
        ...(scenario === "domain" ? {} : { domain: "typography" }),
        value: "Instrument Sans, sans-serif",
        status: "candidate",
        links: [tokenCard.id]
      };
      writeJson(fixture.projectPath, "design-system/token.json", {
        primitive:
          scenario === "target"
            ? {}
            : { "fontFamily.instrumentSans": tokenEntry },
        semantic: {},
        component: {}
      });
      const redeclared = recordSourceArtifact(fixture.projectPath, {
        path: "design-system/token.json",
        artifactType: "token.json",
        semanticPurpose: `${scenario} finalize gate fixture`,
        relatedRecordIds: [tokenCard.id]
      });
      if (!redeclared.ok) throw new Error(redeclared.reason);

      if (scenario === "target") {
        const recovered = claimInitialDesignSystemPreparation(
          fixture.projectPath
        );
        expect(recovered).toMatchObject({
          ok: true,
          extraction_progress: {
            auditStatus: "passed",
            readyToFinalize: false
          },
          extraction_work_units: expect.arrayContaining([
            expect.objectContaining({
              key: "tokens",
              resolutionError: expect.objectContaining({
                reason: "manifest_target_not_found"
              })
            })
          ])
        });
      }

      expect(
        finalizeInitialDesignSystemPreparation(
          fixture.projectPath,
          fixture.attemptId
        )
      ).toMatchObject({
        ok: false,
        reason:
          scenario === "target"
            ? "manifest_target_not_found"
            : scenario === "kind"
              ? "entry_kind_missing"
              : "token_domain_missing"
      });
    }
  });

  test("finalize rejects a gap claim targeting a candidate entry", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    recordCompleteProgressiveExtraction(fixture, claimed);
    const tokenRecords = [
      ...claimed.question_cards.filter((record) => record.section === "token"),
      ...claimed.annotations.filter((record) => record.section === "token")
    ];
    const replacement = recordDesignSystemExtractionWorkUnit(
      fixture.projectPath,
      {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "gap-outcome-token-unit",
        workUnit: COMPLETE_TOKENS_WORK_UNIT,
        claims: tokenRecords.map((record, index) => ({
          claimId: `gap-outcome-token-${index + 1}`,
          statement:
            "body" in record ? record.body : record.final_answer!,
          sourceRecordIds: [record.id],
          sourceExcerpts: [
            "body" in record ? record.body : record.final_answer!
          ],
          confidence:
            "inference" in record ? record.inference : ("confirmed" as const),
          outcome: index === 0 ? ("gap" as const) : ("omitted" as const),
          ...(index === 0
            ? {
                targets: [
                  {
                    artifactPath: "design-system/token.json",
                    entryId: "primitive.fontFamily.instrumentSans"
                  }
                ]
              }
            : {
                reason: "The first token record carries the tested outcome.",
                targets: []
              })
        }))
      }
    );
    if (!replacement.ok) throw new Error(replacement.reason);
    recordAuditForCurrentProgress(fixture, "gap-outcome-audit");

    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "manifest_outcome_status_mismatch",
      details: {
        targets: [
          expect.objectContaining({
            entry_id: "primitive.fontFamily.instrumentSans",
            outcome: "gap",
            entry_status: "candidate"
          })
        ]
      }
    });
  });

});
