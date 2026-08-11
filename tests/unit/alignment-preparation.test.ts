import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import {
  getAlignmentPreparation,
  prepareDesignIntentAlignment
} from "../../lib/runtime/alignment-preparation";
import {
  getDesignLanguageDescription,
  setDesignLanguageDescription
} from "../../lib/runtime/project-readiness";
import {
  registerSeedReference,
  updateSeedReferenceNote
} from "../../lib/runtime/seed-reference";

const FIGMA =
  "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";

function withProject(run: (projectPath: string) => void): void {
  const projectPath = mkdtempSync(
    path.join(tmpdir(), "ikran-alignment-preparation-")
  );
  try {
    initializeProjectDb(projectPath);
    run(projectPath);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

describe("Alignment preparation Runtime command", () => {
  test("Next phase freezes one immutable snapshot and creates one durable pending command", () => {
    withProject((projectPath) => {
      const seed = registerSeedReference(projectPath, {
        figmaSeedReference: FIGMA,
        originalDesignIntent: "Initial reference note"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const evidence = recordEvidencePackage(projectPath, {
        seedReferenceId: seed.record.id,
        frame: { nodeId: "1:2", name: "Checkout" },
        evidenceViews: { rawData: "available", screenshot: "missing" }
      });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) return;

      expect(
        setDesignLanguageDescription(
          projectPath,
          "A calm, precise product language"
        ).ok
      ).toBe(true);

      const prepared = prepareDesignIntentAlignment(projectPath);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.reused).toBe(false);
      expect(prepared.workflow.stage).toBe("alignment-preparing");
      expect(prepared.attempt).toMatchObject({ status: "preparing" });
      expect(prepared.command).toMatchObject({
        command_type: "prepare_design_intent_alignment",
        status: "pending",
        scope: {
          kind: "alignment_attempt",
          id: prepared.attempt.id
        },
        alignment_attempt_id: prepared.attempt.id
      });
      expect(prepared.input_snapshot.data).toEqual({
        design_language_description: "A calm, precise product language",
        seed_references: [
          {
            id: seed.record.id,
            figma_seed_reference: FIGMA,
            file_key: "AbCdEf",
            node_id: "1:2",
            reference_note: "Initial reference note",
            evidence_version: {
              id: evidence.record.id,
              frame_node_id: "1:2",
              frame_name: "Checkout",
              created_at: evidence.record.created_at
            }
          }
        ]
      });

      const retry = prepareDesignIntentAlignment(projectPath);
      expect(retry.ok).toBe(true);
      if (!retry.ok) return;
      expect(retry).toMatchObject({
        reused: true,
        attempt: { id: prepared.attempt.id },
        command: { id: prepared.command.id },
        input_snapshot: { id: prepared.input_snapshot.id }
      });

      expect(
        updateSeedReferenceNote(projectPath, {
          id: seed.record.id,
          referenceNote: "Changed after Next phase"
        }).ok
      ).toBe(true);
      expect(
        setDesignLanguageDescription(projectPath, "Changed after Next phase").ok
      ).toBe(true);
      expect(getDesignLanguageDescription(projectPath)).toBe(
        "Changed after Next phase"
      );

      const restored = getAlignmentPreparation(projectPath);
      expect(restored.workflow.stage).toBe("alignment-preparing");
      expect(restored.current_attempt?.id).toBe(prepared.attempt.id);
      expect(restored.input_snapshot).toEqual(prepared.input_snapshot);
      expect(restored.commands).toHaveLength(1);
      expect(restored.input_snapshot?.data.design_language_description).toBe(
        "A calm, precise product language"
      );
      expect(
        restored.input_snapshot?.data.seed_references[0]?.reference_note
      ).toBe("Initial reference note");
    });
  });

  test("failed preconditions leave workflow at Seed Reference registration", () => {
    withProject((projectPath) => {
      expect(prepareDesignIntentAlignment(projectPath)).toEqual({
        ok: false,
        reason: "design_language_description_required"
      });

      expect(
        setDesignLanguageDescription(projectPath, "A shared design language").ok
      ).toBe(true);
      expect(prepareDesignIntentAlignment(projectPath)).toEqual({
        ok: false,
        reason: "seed_reference_required"
      });

      const seed = registerSeedReference(projectPath, {
        figmaSeedReference: FIGMA,
        originalDesignIntent: "No captured evidence yet"
      });
      expect(seed.ok).toBe(true);
      expect(prepareDesignIntentAlignment(projectPath)).toEqual({
        ok: false,
        reason: "seed_evidence_required"
      });

      expect(getAlignmentPreparation(projectPath)).toEqual({
        workflow: {
          stage: "seed-reference-registration",
          current_alignment_attempt_id: null,
          updated_at: null
        },
        current_attempt: null,
        input_snapshot: null,
        commands: []
      });
    });
  });
});
