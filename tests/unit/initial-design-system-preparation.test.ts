import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";

import {
  claimAlignmentPreparationCommand,
  finalizeAlignmentPreparation
} from "../../lib/runtime/alignment-agent-command";
import { prepareDesignIntentAlignment } from "../../lib/runtime/alignment-preparation";
import { initializeProjectDb } from "../../lib/runtime/db";
import { getProjectDbPath } from "../../lib/runtime/paths";
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
  recordDesignSystemExtractionManifest,
  type DesignSystemExtractionClaim
} from "../../lib/runtime/initial-design-system-preparation";
import { getDesignSystemView } from "../../lib/runtime/design-system-view";
import { setDesignLanguageDescription } from "../../lib/runtime/project-readiness";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";

const projects: string[] = [];

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
        proposedAnswer,
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
      finalAnswer:
        options.golden && index === 4
          ? "Use Instrument Sans, retain the 16–105 px scale and negative display tracking, and preserve six gray steps."
          : options.golden && index === 8
            ? "CTA is a concise label plus arrow text link; do not introduce a filled button."
            : `Confirmed answer ${index + 1}.`
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
      value: { description: "Sparse, exact, typography-led." },
      meaning: "Editorial visual language",
      status: "candidate",
      links: [card("visual-language").id]
    },
    principles: [
      {
        id: "principle-restraint",
        value: { statement: "Use restraint to preserve hierarchy." },
        meaning: "Restrained hierarchy",
        status: "candidate",
        links: [card("design-principle").id]
      }
    ]
  });
  writeJson(projectPath, "design-system/token.json", {
    primitive: {
      "fontFamily.instrumentSans": {
        domain: "typography",
        value: "Instrument Sans, sans-serif",
        meaning: "Sole interface type family",
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
        value: { rule: "Display titles remain the strongest visual layer." },
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
        value: { rule: "Hover feedback remains quiet." },
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
      [card("design-principle").id, card("visual-language").id]
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

function completeExtractionClaims(
  claimed: Extract<
    ReturnType<typeof claimInitialDesignSystemPreparation>,
    { ok: true }
  >
) {
  const targetForSection: Partial<
    Record<
      string,
      { artifactPath: string; entryId: string; jsonPointer: string }
    >
  > = {
    "design-principle": {
      artifactPath: "design-system/design-system.json",
      entryId: "principle-restraint",
      jsonPointer: "/principles/0"
    },
    "visual-language": {
      artifactPath: "design-system/design-system.json",
      entryId: "visual-language",
      jsonPointer: "/visualLanguage"
    },
    token: {
      artifactPath: "design-system/token.json",
      entryId: "primitive.fontFamily.instrumentSans",
      jsonPointer: "/primitive/fontFamily.instrumentSans"
    },
    layout: {
      artifactPath: "design-system/layout-rules.json",
      entryId: "layout-display-hierarchy",
      jsonPointer: "/rules/0"
    },
    interaction: {
      artifactPath: "design-system/interaction-rules.json",
      entryId: "interaction-quiet-hover",
      jsonPointer: "/rules/0"
    }
  };
  const mappedSections = new Set<string>();
  const questionClaims = claimed.question_cards.map((card, index) => {
    const target = targetForSection[card.section];
    const shouldMap = target !== undefined && !mappedSections.has(card.section);
    if (shouldMap) mappedSections.add(card.section);
    return {
      claimId: `final-question-${index + 1}`,
      section: card.section,
      statement: card.final_answer!,
      sourceRecordIds: [card.id],
      sourceExcerpts: [card.final_answer!],
      confidence: "confirmed" as const,
      outcome: shouldMap ? ("mapped" as const) : ("omitted" as const),
      ...(shouldMap
        ? { targets: [target] }
        : {
            reason: "Redundant with the section's mapped reusable decision.",
            targets: []
          })
    };
  });
  const annotationClaims = claimed.annotations.map((annotation, index) => ({
    claimId: `final-annotation-${index + 1}`,
    section: annotation.section!,
    statement: annotation.body,
    sourceRecordIds: [annotation.id],
    sourceExcerpts: [annotation.body],
    confidence: annotation.inference,
    outcome: "omitted" as const,
    reason: "The answered claim carries the reusable decision.",
    targets: []
  }));
  return [...questionClaims, ...annotationClaims];
}

afterEach(() => {
  for (const projectPath of projects.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

describe("Initial Design System preparation", () => {
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
        schema_version: 2,
        source_root: "design-system",
        token_domains: expect.arrayContaining([
          "color",
          "typography",
          "spacing",
          "motion"
        ]),
        component_spec_fields: expect.arrayContaining([
          "anatomy",
          "variants",
          "stateMatrix",
          "tokenLinks",
          "responsiveBehavior",
          "openGaps"
        ]),
        principle_value_fields: {
          strings: expect.arrayContaining(["statement", "rationale", "scope"]),
          collections: expect.arrayContaining([
            "use",
            "avoid",
            "exceptions"
          ])
        },
        layout_rule_value_fields: expect.arrayContaining([
          "relationship",
          "responsiveBehavior",
          "tokenLinks",
          "acceptanceChecks"
        ]),
        interaction_rule_value_fields: expect.arrayContaining([
          "appliesTo",
          "stateBehavior",
          "motion",
          "accessibility",
          "acceptanceChecks"
        ])
      },
      declared_artifacts: []
    });
    if (!first.ok) return;
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

  test("records a complete attempt-bound extraction manifest idempotently", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);

    const claims = [
      ...claimed.question_cards.map((card, index) => ({
        claimId: `question-claim-${index + 1}`,
        section: card.section,
        statement: card.final_answer!,
        sourceRecordIds: [card.id],
        sourceExcerpts: [card.final_answer!],
        confidence: "confirmed" as const,
        outcome: "mapped" as const,
        targets: [
          {
            artifactPath: "design-system/design-system.json",
            entryId: "visual-language",
            jsonPointer: "/visualLanguage"
          }
        ]
      })),
      ...claimed.annotations.map((annotation, index) => ({
        claimId: `annotation-claim-${index + 1}`,
        section: annotation.section!,
        statement: annotation.body,
        sourceRecordIds: [annotation.id],
        sourceExcerpts: [annotation.body],
        confidence: annotation.inference,
        outcome: "omitted" as const,
        reason: "Redundant with an answered design claim.",
        targets: []
      }))
    ];

    const first = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "manifest-v1",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    expect(first).toMatchObject({
      ok: true,
      reused: false,
      manifest: {
        alignment_attempt_id: fixture.attemptId,
        idempotency_key: "manifest-v1",
        version: 1
      }
    });

    const second = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "manifest-v1",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    expect(second).toMatchObject({
      ok: true,
      reused: true,
      manifest: { version: 1 },
      event_id: null
    });

    const revisedClaims = claims.map((claim, index) =>
      index === 0
        ? { ...claim, statement: `${claim.statement} (clarified)` }
        : claim
    );
    expect(
      recordDesignSystemExtractionManifest(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "manifest-v2",
        claims: revisedClaims,
        audit: {
          status: "passed",
          checkedClaimIds: revisedClaims.map((claim) => claim.claimId),
          issues: []
        }
      })
    ).toMatchObject({
      ok: true,
      reused: false,
      manifest: { version: 2 }
    });

    expect(
      recordDesignSystemExtractionManifest(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "manifest-v1",
        claims,
        audit: {
          status: "passed",
          checkedClaimIds: claims.map((claim) => claim.claimId),
          issues: []
        }
      })
    ).toMatchObject({
      ok: true,
      reused: true,
      manifest: { idempotency_key: "manifest-v1", version: 1 }
    });

    expect(
      claimInitialDesignSystemPreparation(fixture.projectPath)
    ).toMatchObject({
      ok: true,
      reused: true,
      extraction_manifest: {
        idempotency_key: "manifest-v2",
        version: 2
      }
    });
  });

  test("re-claim and manifest validation use the frozen command input", () => {
    const fixture = createCompletedAlignmentFixture();
    const first = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!first.ok) throw new Error(first.reason);
    const removedAnnotationId = first.annotations[0].id;

    const db = new DatabaseSync(getProjectDbPath(fixture.projectPath));
    try {
      db.prepare(
        "DELETE FROM agent_alignment_annotations WHERE id = ?"
      ).run(removedAnnotationId);
    } finally {
      db.close();
    }

    const second = claimInitialDesignSystemPreparation(fixture.projectPath);
    expect(second).toMatchObject({
      ok: true,
      reused: true,
      annotations: expect.arrayContaining([
        expect.objectContaining({ id: removedAnnotationId })
      ])
    });
    if (!second.ok) return;
    const claims = completeExtractionClaims(second);
    expect(
      recordDesignSystemExtractionManifest(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "frozen-after-live-mutation",
        claims,
        audit: {
          status: "passed",
          checkedClaimIds: claims.map((claim) => claim.claimId),
          issues: []
        }
      })
    ).toMatchObject({
      ok: true,
      manifest: { version: 1 }
    });
  });

  test("rejects a manifest that silently omits an answered input record", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    const onlyCard = claimed.question_cards[0];

    expect(
      recordDesignSystemExtractionManifest(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "incomplete-manifest",
        claims: [
          {
            claimId: "only-one-card",
            section: onlyCard.section,
            statement: onlyCard.final_answer!,
            sourceRecordIds: [onlyCard.id],
            sourceExcerpts: [onlyCard.final_answer!],
            confidence: "confirmed",
            outcome: "omitted",
            reason: "Not reusable.",
            targets: []
          }
        ],
        audit: {
          status: "passed",
          checkedClaimIds: ["only-one-card"],
          issues: []
        }
      })
    ).toMatchObject({
      ok: false,
      reason: "input_coverage_incomplete",
      details: {
        missing_question_card_ids: expect.arrayContaining([
          claimed.question_cards[1].id
        ]),
        missing_agent_annotation_ids: expect.arrayContaining([
          claimed.annotations[0].id
        ])
      }
    });
  });

  test("rejects a confirmed claim backed by a reasonable-only annotation", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    const claims = completeExtractionClaims(claimed);
    const reasonableClaim = claims.find((claim) => {
      const annotation = claimed.annotations.find(
        (candidate) => claim.sourceRecordIds.includes(candidate.id)
      );
      return annotation?.inference === "reasonable";
    })!;
    const overstated = claims.map((claim) =>
      claim.claimId === reasonableClaim.claimId
        ? { ...claim, confidence: "confirmed" as const }
        : claim
    );

    expect(
      recordDesignSystemExtractionManifest(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "overstated-confidence",
        claims: overstated,
        audit: {
          status: "passed",
          checkedClaimIds: overstated.map((claim) => claim.claimId),
          issues: []
        }
      })
    ).toMatchObject({
      ok: false,
      reason: "claim_confidence_exceeds_source",
      details: {
        claim_id: reasonableClaim.claimId,
        reasonable_source_record_ids: reasonableClaim.sourceRecordIds
      }
    });
  });

  test("finalizes only after required artifacts, target coverage, and audit pass", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    const claims = completeExtractionClaims(claimed);

    const manifest = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "final-manifest",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    if (!manifest.ok) throw new Error(manifest.reason);

    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "required_artifacts_missing",
      details: {
        missing_artifact_paths: expect.arrayContaining([
          "design-system/token.json"
        ])
      }
    });

    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const finalized = finalizeInitialDesignSystemPreparation(
      fixture.projectPath,
      fixture.attemptId
    );
    expect(finalized).toMatchObject({
      ok: true,
      reused: false,
      command: {
        command_type: "prepare_initial_design_system",
        status: "completed"
      },
      manifest: { version: 1 }
    });
    expect(
      listEvents(
        fixture.projectPath,
        "design_system_extraction_manifest_recorded"
      )
    ).toHaveLength(1);
    expect(
      listEvents(
        fixture.projectPath,
        "initial_design_system_preparation_completed"
      )
    ).toHaveLength(1);
    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: true,
      reused: true,
      command: { status: "completed" },
      event_id: null
    });

    expect(
      recordDesignSystemExtractionManifest(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "final-manifest",
        claims,
        audit: {
          status: "passed",
          checkedClaimIds: claims.map((claim) => claim.claimId),
          issues: []
        }
      })
    ).toMatchObject({
      ok: true,
      reused: true,
      manifest: {
        idempotency_key: "final-manifest",
        version: 1
      },
      event_id: null
    });

    expect(
      recordDesignSystemExtractionManifest(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "final-manifest",
        claims: claims.map((claim, index) =>
          index === 0
            ? {
                ...claim,
                statement: `${claim.statement} Conflicting replay.`
              }
            : claim
        ),
        audit: {
          status: "passed",
          checkedClaimIds: claims.map((claim) => claim.claimId),
          issues: []
        }
      })
    ).toMatchObject({
      ok: false,
      reason: "idempotency_conflict"
    });

    expect(
      recordDesignSystemExtractionManifest(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "new-key-after-completion",
        claims,
        audit: {
          status: "passed",
          checkedClaimIds: claims.map((claim) => claim.claimId),
          issues: []
        }
      })
    ).toMatchObject({
      ok: false,
      reason: "initial_design_system_command_not_claimed"
    });
  });

  test("reports the exact design-system entry omitted by the manifest", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const claims = completeExtractionClaims(claimed).map((claim) =>
      claim.targets.some(
        (target) =>
          target.entryId === "primitive.fontFamily.instrumentSans"
      )
        ? {
            ...claim,
            outcome: "omitted" as const,
            reason: "Incorrectly omitted typography.",
            targets: []
          }
        : claim
    );
    const manifest = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "missing-typography",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    if (!manifest.ok) throw new Error(manifest.reason);

    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "uncovered_design_system_entries",
      details: {
        entries: [
          {
            source_artifact_path: "design-system/token.json",
            entry_id: "primitive.fontFamily.instrumentSans"
          }
        ]
      }
    });
    expect(
      listEvents(
        fixture.projectPath,
        "design_system_extraction_coverage_rejected"
      ).at(-1)?.payload
    ).toMatchObject({
      reason: "uncovered_design_system_entries"
    });
    expect(
      listEvents(
        fixture.projectPath,
        "initial_design_system_preparation_failed"
      ).at(-1)?.payload
    ).toMatchObject({
      reason: "uncovered_design_system_entries"
    });
  });

  test("rejects a manifest target whose JSON pointer drifted", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const claims = completeExtractionClaims(claimed).map((claim) => ({
      ...claim,
      targets: claim.targets.map((target) =>
        target.entryId === "primitive.fontFamily.instrumentSans"
          ? { ...target, jsonPointer: "/primitive/old-font-token" }
          : target
      )
    }));
    const manifest = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "drifted-pointer",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    if (!manifest.ok) throw new Error(manifest.reason);

    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "manifest_target_drift",
      details: {
        targets: [
          {
            entry_id: "primitive.fontFamily.instrumentSans",
            json_pointer: "/primitive/old-font-token",
            expected_json_pointer:
              "/primitive/fontFamily.instrumentSans"
          }
        ]
      }
    });
  });

  test("reports claim identity when artifact re-declaration removes a manifest target", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const claims = completeExtractionClaims(claimed);
    const tokenClaim = claims.find((claim) =>
      claim.targets.some(
        (target) =>
          target.entryId === "primitive.fontFamily.instrumentSans"
      )
    )!;
    const manifest = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "target-before-redeclaration",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    if (!manifest.ok) throw new Error(manifest.reason);

    writeJson(fixture.projectPath, "design-system/token.json", {
      primitive: {},
      semantic: {},
      component: {}
    });
    const redeclared = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "Target drift mutation",
      relatedRecordIds: [
        claimed.question_cards.find((card) => card.section === "token")!.id
      ]
    });
    if (!redeclared.ok) throw new Error(redeclared.reason);

    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "manifest_target_not_found",
      details: {
        targets: [
          {
            claim_id: tokenClaim.claimId,
            artifact_path: "design-system/token.json",
            entry_id: "primitive.fontFamily.instrumentSans",
            json_pointer: "/primitive/fontFamily.instrumentSans"
          }
        ]
      }
    });
  });

  test("requires an explicit domain on tokens generated by the 09B flow", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);

    const tokenCard = claimed.question_cards.find(
      (card) => card.section === "token"
    )!;
    writeJson(fixture.projectPath, "design-system/token.json", {
      primitive: {
        "fontFamily.instrumentSans": {
          value: "Instrument Sans, sans-serif",
          meaning: "Sole interface type family",
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
      semanticPurpose: "Initial Design System fixture without a token domain",
      relatedRecordIds: [tokenCard.id]
    });
    if (!redeclared.ok) throw new Error(redeclared.reason);

    const claims = completeExtractionClaims(claimed);
    const manifest = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "missing-domain",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    if (!manifest.ok) throw new Error(manifest.reason);

    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "token_domain_missing",
      details: {
        entries: [
          {
            source_artifact_path: "design-system/token.json",
            entry_id: "primitive.fontFamily.instrumentSans"
          }
        ]
      }
    });
  });

  test("requires gap claims to target gap entries and mapped claims to target non-gaps", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const claims = completeExtractionClaims(claimed).map((claim) =>
      claim.targets.some(
        (target) =>
          target.entryId === "primitive.fontFamily.instrumentSans"
      )
        ? { ...claim, outcome: "gap" as const }
        : claim
    );
    const manifest = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "gap-status-mismatch",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    if (!manifest.ok) throw new Error(manifest.reason);

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
          {
            entry_id: "primitive.fontFamily.instrumentSans",
            outcome: "gap",
            entry_status: "candidate"
          }
        ]
      }
    });
  });

  test("rejects entry evidence links that are not carried by its targeting claims", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const tokenCard = claimed.question_cards.find(
      (card) => card.section === "token"
    )!;
    const tokenAnnotation = claimed.annotations.find(
      (annotation) => annotation.section === "token"
    )!;

    writeJson(fixture.projectPath, "design-system/token.json", {
      primitive: {
        "fontFamily.instrumentSans": {
          domain: "typography",
          value: "Instrument Sans, sans-serif",
          meaning: "Sole interface type family",
          status: "formalized",
          links: [tokenCard.id, tokenAnnotation.id]
        }
      },
      semantic: {},
      component: {}
    });
    const redeclared = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "Formalized typography with mixed evidence",
      relatedRecordIds: [tokenCard.id, tokenAnnotation.id]
    });
    if (!redeclared.ok) throw new Error(redeclared.reason);

    const claims = completeExtractionClaims(claimed).map((claim) =>
      claim.sourceRecordIds.includes(tokenAnnotation.id)
        ? {
            ...claim,
            targets: [
              {
                artifactPath: "design-system/token.json",
                entryId: "primitive.fontFamily.instrumentSans",
                jsonPointer: "/primitive/fontFamily.instrumentSans"
              }
            ]
          }
        : claim
    );
    const manifest = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "unclaimed-entry-link",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    if (!manifest.ok) throw new Error(manifest.reason);

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
            entry_id: "primitive.fontFamily.instrumentSans",
            unclaimed_link_ids: [tokenAnnotation.id]
          }
        ]
      }
    });
  });

  test("rejects mapped claim sources omitted from the entry evidence links", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const tokenAnnotation = claimed.annotations.find(
      (annotation) => annotation.section === "token"
    )!;
    const claims = completeExtractionClaims(claimed).map((claim) =>
      claim.sourceRecordIds.includes(tokenAnnotation.id)
        ? {
            ...claim,
            outcome: "mapped" as const,
            reason: undefined,
            targets: [
              {
                artifactPath: "design-system/token.json",
                entryId: "primitive.fontFamily.instrumentSans",
                jsonPointer: "/primitive/fontFamily.instrumentSans"
              }
            ]
          }
        : claim
    );
    const manifest = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "mapped-source-not-linked",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    if (!manifest.ok) throw new Error(manifest.reason);

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
            entry_id: "primitive.fontFamily.instrumentSans",
            unlinked_mapped_source_ids: [tokenAnnotation.id]
          }
        ]
      }
    });
  });

  test("requires component inventory/spec pairing and the 09B detail groups", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const componentCard = claimed.question_cards.find(
      (card) => card.section === "component"
    )!;

    writeJson(fixture.projectPath, "design-system/component-list.json", {
      components: [
        {
          id: "component-text-link",
          value: {
            name: "TextLink",
            specPath: "components/text-link.json"
          },
          meaning: "Inline label-and-arrow call to action",
          status: "candidate",
          links: [componentCard.id]
        }
      ]
    });
    const inventoryDeclaration = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/component-list.json",
      artifactType: "component-list.json",
      semanticPurpose: "Initial component inventory",
      relatedRecordIds: [componentCard.id]
    });
    if (!inventoryDeclaration.ok) {
      throw new Error(inventoryDeclaration.reason);
    }

    const baseClaims = completeExtractionClaims(claimed);
    const inventoryClaims = baseClaims.map((claim) =>
      claim.section === "component" && claim.sourceRecordIds.includes(componentCard.id)
        ? {
            ...claim,
            outcome: "mapped" as const,
            reason: undefined,
            targets: [
              {
                artifactPath: "design-system/component-list.json",
                entryId: "component-text-link",
                jsonPointer: "/components/0"
              }
            ]
          }
        : claim
    );
    const firstManifest = recordDesignSystemExtractionManifest(
      fixture.projectPath,
      {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "component-inventory-only",
        claims: inventoryClaims,
        audit: {
          status: "passed",
          checkedClaimIds: inventoryClaims.map((claim) => claim.claimId),
          issues: []
        }
      }
    );
    if (!firstManifest.ok) throw new Error(firstManifest.reason);
    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "component_specs_missing",
      details: {
        components: [
          {
            entry_id: "component-text-link",
            spec_path: "components/text-link.json"
          }
        ]
      }
    });

    const baseSpec = {
      description: "Label-and-arrow CTA",
      props: [{ name: "label", type: "string" }],
      boundaries: ["Never render a filled background."],
      stateMatrix: [{ state: "default", behavior: "Inline text link" }]
    };
    writeJson(
      fixture.projectPath,
      "design-system/components/text-link.json",
      {
        id: "component-text-link-spec",
        name: "TextLink",
        value: baseSpec,
        meaning: "Inline label-and-arrow call to action",
        status: "candidate",
        links: [componentCard.id]
      }
    );
    const specDeclaration = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/components/text-link.json",
      artifactType: "component-spec",
      semanticPurpose: "Initial component contract",
      relatedRecordIds: [componentCard.id]
    });
    if (!specDeclaration.ok) throw new Error(specDeclaration.reason);

    const completeComponentClaims = inventoryClaims.map((claim) => {
      if (
        claim.section === "component" &&
        claim.sourceRecordIds.includes(componentCard.id)
      ) {
        return {
          ...claim,
          targets: [
            ...claim.targets,
            {
              artifactPath: "design-system/components/text-link.json",
              entryId: "component-text-link-spec",
              jsonPointer: ""
            }
          ]
        };
      }
      if (claim.section === "component" && claim.outcome === "omitted") {
        return {
          ...claim,
          reason:
            "This fixture has no code mapping or unresolved component gap.",
          targets: [
            {
              artifactPath: "design-system/components/text-link.json",
              entryId: "component-text-link-spec",
              jsonPointer: "/value/codeLinks"
            },
            {
              artifactPath: "design-system/components/text-link.json",
              entryId: "component-text-link-spec",
              jsonPointer: "/value/openGaps"
            }
          ]
        };
      }
      return claim;
    });
    const secondManifest = recordDesignSystemExtractionManifest(
      fixture.projectPath,
      {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "component-spec-added",
        claims: completeComponentClaims,
        audit: {
          status: "passed",
          checkedClaimIds: completeComponentClaims.map(
            (claim) => claim.claimId
          ),
          issues: []
        }
      }
    );
    if (!secondManifest.ok) throw new Error(secondManifest.reason);
    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "component_spec_fields_missing",
      details: {
        specs: [
          {
            entry_id: "component-text-link-spec",
            missing_fields: expect.arrayContaining([
              "anatomy",
              "variants",
              "sizes",
              "tokenLinks",
              "usageRules",
              "contentRules",
              "responsiveBehavior",
              "codeLinks",
              "verificationTargets",
              "openGaps"
            ])
          }
        ]
      }
    });

    writeJson(
      fixture.projectPath,
      "design-system/components/text-link.json",
      {
        id: "component-text-link-spec",
        name: "TextLink",
        value: {
          ...baseSpec,
          anatomy: [{ part: "label" }, { part: "arrow" }],
          variants: [{ name: "text-link" }],
          sizes: [{ name: "default" }],
          tokenLinks: ["semantic.text.action"],
          usageRules: ["Use for inline calls to action."],
          contentRules: ["Keep labels concise."],
          responsiveBehavior: ["Preserve inline flow."],
          codeLinks: [],
          verificationTargets: ["No filled background."],
          openGaps: []
        },
        meaning: "Inline label-and-arrow call to action",
        status: "candidate",
        links: [componentCard.id]
      }
    );
    const richSpecDeclaration = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/components/text-link.json",
      artifactType: "component-spec",
      semanticPurpose: "Rich initial component contract",
      relatedRecordIds: [componentCard.id]
    });
    if (!richSpecDeclaration.ok) {
      throw new Error(richSpecDeclaration.reason);
    }
    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: true,
      command: { status: "completed" },
      manifest: { version: 2 }
    });
  });

  test("allows an explicitly targeted omitted outcome to explain a missing component spec", () => {
    const fixture = createCompletedAlignmentFixture();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const componentCards = claimed.question_cards.filter(
      (card) => card.section === "component"
    );

    writeJson(fixture.projectPath, "design-system/component-list.json", {
      components: [
        {
          id: "component-text-link",
          value: {
            name: "TextLink",
            specPath: "components/text-link.json"
          },
          meaning: "Inline label-and-arrow call to action",
          status: "candidate",
          links: [componentCards[0].id]
        }
      ]
    });
    const declaration = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/component-list.json",
      artifactType: "component-list.json",
      semanticPurpose: "Initial component inventory",
      relatedRecordIds: [componentCards[0].id]
    });
    if (!declaration.ok) throw new Error(declaration.reason);

    const claims = completeExtractionClaims(claimed).map((claim) => {
      if (claim.sourceRecordIds.includes(componentCards[0].id)) {
        return {
          ...claim,
          outcome: "mapped" as const,
          reason: undefined,
          targets: [
            {
              artifactPath: "design-system/component-list.json",
              entryId: "component-text-link",
              jsonPointer: "/components/0"
            }
          ]
        };
      }
      if (claim.sourceRecordIds.includes(componentCards[1].id)) {
        return {
          ...claim,
          reason:
            "The captured evidence defines the inventory identity but not a reusable component contract.",
          targets: [
            {
              artifactPath: "design-system/components/text-link.json",
              entryId: "component-text-link-spec",
              jsonPointer: ""
            }
          ]
        };
      }
      return claim;
    });
    const manifest = recordDesignSystemExtractionManifest(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "component-spec-explicitly-omitted",
      claims,
      audit: {
        status: "passed",
        checkedClaimIds: claims.map((claim) => claim.claimId),
        issues: []
      }
    });
    if (!manifest.ok) throw new Error(manifest.reason);

    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: true,
      command: { status: "completed" }
    });
  });

  test("golden fixture preserves confirmed typography, gray scale, and text-link CTA facts", () => {
    const fixture = createCompletedAlignmentFixture({ golden: true });
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    declareInitialDesignSystemArtifacts(fixture.projectPath, claimed);
    const tokenCard = claimed.question_cards.find(
      (card) => card.section === "token"
    )!;
    const componentCards = claimed.question_cards.filter(
      (card) => card.section === "component"
    );

    const tokenEntries = {
      "fontFamily.instrumentSans": {
        domain: "typography",
        value: "Instrument Sans, sans-serif",
        meaning: "Sole interface type family",
        status: "candidate",
        links: [tokenCard.id]
      },
      "fontSize.seedRange": {
        domain: "typography",
        value: { min: "16px", max: "105px" },
        meaning: "Observed Seed type scale range",
        status: "candidate",
        links: [tokenCard.id]
      },
      "letterSpacing.display": {
        domain: "typography",
        value: "-0.03em",
        meaning: "Negative display tracking",
        status: "candidate",
        links: [tokenCard.id]
      },
      "gray.seedScale": {
        domain: "color",
        value: ["#111111", "#333333", "#666666", "#999999", "#cccccc", "#f5f5f5"],
        meaning: "Six-step neutral scale",
        status: "candidate",
        links: [tokenCard.id]
      }
    } as const;
    writeJson(fixture.projectPath, "design-system/token.json", {
      primitive: tokenEntries,
      semantic: {},
      component: {}
    });
    const tokenDeclaration = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "Golden typography and gray-scale extraction",
      relatedRecordIds: [tokenCard.id]
    });
    if (!tokenDeclaration.ok) throw new Error(tokenDeclaration.reason);

    writeJson(fixture.projectPath, "design-system/component-list.json", {
      components: [
        {
          id: "component-text-link",
          value: {
            name: "TextLink",
            specPath: "components/text-link.json"
          },
          meaning: "Label-and-arrow inline CTA",
          status: "candidate",
          links: [componentCards[0].id]
        }
      ]
    });
    const inventoryDeclaration = recordSourceArtifact(fixture.projectPath, {
      path: "design-system/component-list.json",
      artifactType: "component-list.json",
      semanticPurpose: "Golden component inventory",
      relatedRecordIds: [componentCards[0].id]
    });
    if (!inventoryDeclaration.ok) {
      throw new Error(inventoryDeclaration.reason);
    }

    const componentValue = (contradictory: boolean) => ({
      description: contradictory
        ? "Filled primary button"
        : "Concise label-and-arrow text link",
      props: [{ name: "label", type: "string" }],
      boundaries: [
        contradictory
          ? "Use a black filled background."
          : "Never introduce a filled button background."
      ],
      stateMatrix: [
        {
          state: "default",
          behavior: contradictory
            ? "Black fill with white label"
            : "Inline label plus arrow"
        }
      ],
      anatomy: [{ part: "label" }, { part: "arrow" }],
      variants: [{ name: "text-link" }],
      sizes: [{ name: "default" }],
      tokenLinks: ["semantic.text.action"],
      usageRules: ["Use for inline calls to action."],
      contentRules: ["Keep the label concise."],
      responsiveBehavior: ["Preserve inline flow."],
      codeLinks: ["components/TextLink.tsx"],
      verificationTargets: ["No filled background."],
      openGaps: []
    });
    const writeAndDeclareSpec = (contradictory: boolean) => {
      writeJson(
        fixture.projectPath,
        "design-system/components/text-link.json",
        {
          id: "component-text-link-spec",
          name: "TextLink",
          value: componentValue(contradictory),
          meaning: "Label-and-arrow inline CTA",
          status: "candidate",
          links: [componentCards[0].id]
        }
      );
      return recordSourceArtifact(fixture.projectPath, {
        path: "design-system/components/text-link.json",
        artifactType: "component-spec",
        semanticPurpose: contradictory
          ? "Contradictory CTA mutation"
          : "Golden text-link CTA contract",
        relatedRecordIds: [componentCards[0].id]
      });
    };
    const contradictoryDeclaration = writeAndDeclareSpec(true);
    if (!contradictoryDeclaration.ok) {
      throw new Error(contradictoryDeclaration.reason);
    }

    const tokenDecisions = [
      {
        claimId: "golden-font-family",
        statement: "Instrument Sans is the sole interface family.",
        name: "fontFamily.instrumentSans"
      },
      {
        claimId: "golden-type-range",
        statement: "The observed type scale spans 16–105 px.",
        name: "fontSize.seedRange"
      },
      {
        claimId: "golden-display-tracking",
        statement: "Display typography uses negative letter spacing.",
        name: "letterSpacing.display"
      },
      {
        claimId: "golden-gray-scale",
        statement: "The neutral palette retains six gray steps.",
        name: "gray.seedScale"
      }
    ] as const;
    const claims = completeExtractionClaims(
      claimed
    ).flatMap<DesignSystemExtractionClaim>((claim) => {
      if (claim.sourceRecordIds.includes(tokenCard.id)) {
        return tokenDecisions.map((decision) => ({
          ...claim,
          claimId: decision.claimId,
          statement: decision.statement,
          sourceExcerpts: [tokenCard.final_answer!],
          outcome: "mapped" as const,
          reason: undefined,
          targets: [
            {
              artifactPath: "design-system/token.json",
              entryId: `primitive.${decision.name}`,
              jsonPointer: `/primitive/${decision.name}`
            }
          ]
        }));
      }
      if (claim.sourceRecordIds.includes(componentCards[0].id)) {
        return [{
          ...claim,
          outcome: "mapped" as const,
          reason: undefined,
          targets: [
            {
              artifactPath: "design-system/component-list.json",
              entryId: "component-text-link",
              jsonPointer: "/components/0"
            },
            {
              artifactPath: "design-system/components/text-link.json",
              entryId: "component-text-link-spec",
              jsonPointer: ""
            }
          ]
        }];
      }
      if (claim.sourceRecordIds.includes(componentCards[1].id)) {
        return [{
          ...claim,
          reason: "The confirmed contract leaves no unresolved component gap.",
          targets: [
            {
              artifactPath: "design-system/components/text-link.json",
              entryId: "component-text-link-spec",
              jsonPointer: "/value/openGaps"
            }
          ]
        }];
      }
      return [claim];
    });
    expect(
      claims.filter((claim) => claim.claimId.startsWith("golden-"))
    ).toMatchObject(
      tokenDecisions.map((decision) => ({
        claimId: decision.claimId,
        statement: decision.statement,
        targets: [
          {
            entryId: `primitive.${decision.name}`
          }
        ]
      }))
    );
    const failedAudit = recordDesignSystemExtractionManifest(
      fixture.projectPath,
      {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "golden-contradiction",
        claims,
        audit: {
          status: "failed",
          checkedClaimIds: claims.map((claim) => claim.claimId),
          issues: [
            "CTA source contradicts the designer-confirmed text-link contract."
          ]
        }
      }
    );
    if (!failedAudit.ok) throw new Error(failedAudit.reason);
    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: false,
      reason: "extraction_audit_failed"
    });

    const correctedDeclaration = writeAndDeclareSpec(false);
    if (!correctedDeclaration.ok) {
      throw new Error(correctedDeclaration.reason);
    }
    const passedAudit = recordDesignSystemExtractionManifest(
      fixture.projectPath,
      {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: "golden-corrected",
        claims,
        audit: {
          status: "passed",
          checkedClaimIds: claims.map((claim) => claim.claimId),
          issues: []
        }
      }
    );
    if (!passedAudit.ok) throw new Error(passedAudit.reason);
    expect(
      finalizeInitialDesignSystemPreparation(
        fixture.projectPath,
        fixture.attemptId
      )
    ).toMatchObject({
      ok: true,
      command: { status: "completed" },
      manifest: { version: 2 }
    });

    const view = getDesignSystemView(fixture.projectPath);
    if (!view.ok) throw new Error(view.reason);
    expect(view.view.tokens.primitive).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entry_id: "primitive.fontFamily.instrumentSans",
          domain: "typography",
          value: "Instrument Sans, sans-serif"
        }),
        expect.objectContaining({
          entry_id: "primitive.fontSize.seedRange",
          value: { min: "16px", max: "105px" }
        }),
        expect.objectContaining({
          entry_id: "primitive.letterSpacing.display",
          value: "-0.03em"
        }),
        expect.objectContaining({
          entry_id: "primitive.gray.seedScale",
          domain: "color",
          value: expect.arrayContaining([
            "#111111",
            "#333333",
            "#666666",
            "#999999",
            "#cccccc",
            "#f5f5f5"
          ])
        })
      ])
    );
    expect(view.view.components.specs[0].value).toMatchObject({
      description: "Concise label-and-arrow text link",
      boundaries: ["Never introduce a filled button background."]
    });
  });
});
