// Issue 30 — prototype_validation rebuild context: seed source identity +
// current evidence surface ids + design-system version + rebuild contract.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  createMemoryFigmaCredentialStore,
  resetFigmaCredentialStoreForTests,
  setFigmaCredentialStoreForTests
} from "../../lib/runtime/figma-credential-store";
import {
  createMockFigmaApiClient,
  resetFigmaApiClientForTests,
  setFigmaApiClientForTests
} from "../../lib/runtime/figma-api";
import { addSeedReference } from "../../lib/runtime/seed-capture";
import { openProjectDb, closeProjectDb } from "../../lib/runtime/db";
import {
  getPrototypeRebuildContext,
  PROTOTYPE_REBUILD_CONTRACT
} from "../../lib/runtime/prototype-rebuild-context";

let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ikran-rebuild-context-"));
  const store = createMemoryFigmaCredentialStore();
  await store.set("figd_ok_secret_never_return");
  setFigmaCredentialStoreForTests(store);
  setFigmaApiClientForTests(createMockFigmaApiClient());
});

afterEach(() => {
  resetFigmaCredentialStoreForTests();
  resetFigmaApiClientForTests();
  rmSync(dir, { recursive: true, force: true });
});

function setPhase(phase: string): void {
  const db = openProjectDb(dir);
  try {
    db.prepare(
      `UPDATE project_phase SET phase = ?, updated_at = ? WHERE singleton = 1`
    ).run(phase, "2026-08-07T00:00:00.000Z");
  } finally {
    closeProjectDb(db);
  }
}

test("rejects outside prototype_validation with phase_gate", () => {
  const result = getPrototypeRebuildContext(dir);
  expect(result).toEqual({ ok: false, reason: "phase_gate", phase: "seed" });
});

test("rejects with no_seed_reference inside prototype_validation when no seeds", () => {
  setPhase("prototype_validation");
  expect(getPrototypeRebuildContext(dir)).toEqual({
    ok: false,
    reason: "no_seed_reference"
  });
});

test("pending seed (no current surface) returns null currentEvidence", () => {
  const db = openProjectDb(dir);
  try {
    db.prepare(
      `INSERT INTO seed_references
       (id, figma_seed_reference, original_design_intent, created_at,
        registered_via, file_key, node_id)
       VALUES ('seed-pending', 'https://www.figma.com/design/AbCdEf/X?node-id=9-9',
               '', '2026-08-07T00:00:00.000Z', 'agent', 'AbCdEf', '9:9')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
  setPhase("prototype_validation");

  const result = getPrototypeRebuildContext(dir);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.seeds).toEqual([
    {
      seedReferenceId: "seed-pending",
      figmaLink: "https://www.figma.com/design/AbCdEf/X?node-id=9-9",
      source: { fileKey: "AbCdEf", nodeId: "9:9" },
      currentEvidence: null
    }
  ]);
});

test("returns seeds, design-system version, and the rebuild contract", async () => {
  const captured = await addSeedReference(dir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2&t=share",
    initiator: "agent"
  });
  expect(captured.ok).toBe(true);
  if (!captured.ok) return;
  setPhase("prototype_validation");

  const result = getPrototypeRebuildContext(dir);
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.seeds).toEqual([
    {
      seedReferenceId: captured.record.id,
      figmaLink:
        "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2&t=share",
      source: { fileKey: "AbCdEf", nodeId: "1:2" },
      currentEvidence: {
        surfaceId: captured.surface.id,
        frameNodeId: "1:2",
        frameName: expect.any(String),
        capturedAt: expect.any(String)
      }
    }
  ]);
  expect(typeof result.design_system_version).toBe("string");
  expect(result.design_system_version.length).toBeGreaterThan(0);
  expect(result.rebuild_contract).toBe(PROTOTYPE_REBUILD_CONTRACT);
  expect(result.rebuild_contract).toContain("get_design_context");
  expect(result.rebuild_contract).toContain("record_preview");
  expect(result.preview_contract).toEqual({
    sequence: [
      "write_complete_prototype",
      "declare_prototype_and_package_artifacts",
      "record_preview_once",
      "verify_ready_surface"
    ],
    server: {
      processOwner: "runtime",
      host: "127.0.0.1",
      portEnvironmentVariable: "PORT"
    },
    declaration: {
      sourceArtifactPath: "declared prototype/code entry artifact",
      prototypeRoot: "directory containing package.json",
      routePath: "explicit absolute page path, such as /",
      packageMetadata: ["scripts.dev", "dependencies", "devDependencies"]
    },
    completion: { readiness: "ready", stale: false },
    repair: {
      error: "preview_not_ready",
      retryIdentity: "same runId and surfaceKey"
    },
    componentPreview: {
      supportedAdapters: ["next-app-router", "vite-react"],
      adapterSelection: "runtime-detected from prototype structure and package metadata",
      styles: {
        componentImports: "loaded normally",
        viteEntryCss: "direct CSS imports from the index.html module entry are included automatically"
      },
      versionPolicy: "framework package version changes do not select an adapter",
      recipeRules: {
        entryId: "use the exact entryId from component_preview_targets",
        stateArgs:
          "keys must come from allowedStateNames; omit stateArgs for alternative examples not declared by the Design System contract"
      },
      completionGate: "before Prototype confirmation every code-linked candidate component must be registered for live verification or retain a resolved Open Gap; formalization additionally requires verification"
    }
  });
  expect(JSON.stringify(result)).not.toContain("figd_ok_secret_never_return");
});

test("returns exact component Preview identities and only contract-declared states", async () => {
  const captured = await addSeedReference(dir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2",
    initiator: "agent"
  });
  expect(captured.ok).toBe(true);
  const db = openProjectDb(dir);
  try {
    const now = "2026-08-28T00:00:00.000Z";
    const insert = db.prepare(
      `INSERT INTO design_system_entries
       (id, source_artifact_path, file_kind, section, entry_id, name,
        value_json, meaning, status, links_json, source_captures_json,
        position, created_at, updated_at)
       VALUES (?, ?, 'component-spec', 'components.spec', ?, ?, ?, ?,
               'candidate', '[]', '[]', ?, ?, ?)`
    );
    insert.run(
      "row-text-link",
      "design-system/components/text-link.json",
      "component-spec-textlink",
      "Text Link",
      JSON.stringify({
        description: "Text Link",
        props: [],
        variants: [],
        stateMatrix: [],
        guidelines: [],
        tokenLinks: [],
        codeLinks: []
      }),
      "Text Link",
      0,
      now,
      now
    );
    insert.run(
      "row-navigation",
      "design-system/components/navigation.json",
      "component-spec-navigation",
      "Navigation",
      JSON.stringify({
        description: "Navigation",
        props: [],
        variants: [],
        stateMatrix: [{ state: "expanded" }, { state: "default" }],
        guidelines: [],
        tokenLinks: [],
        codeLinks: []
      }),
      "Navigation",
      1,
      now,
      now
    );
  } finally {
    closeProjectDb(db);
  }
  setPhase("prototype_validation");

  const result = getPrototypeRebuildContext(dir);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.component_preview_targets).toEqual([
    {
      entryId: "component-spec-textlink",
      name: "Text Link",
      sourceArtifactPath: "design-system/components/text-link.json",
      allowedStateNames: []
    },
    {
      entryId: "component-spec-navigation",
      name: "Navigation",
      sourceArtifactPath: "design-system/components/navigation.json",
      allowedStateNames: ["expanded"]
    }
  ]);
  expect(result.preview_contract.componentPreview.recipeRules).toEqual({
    entryId: "use the exact entryId from component_preview_targets",
    stateArgs:
      "keys must come from allowedStateNames; omit stateArgs for alternative examples not declared by the Design System contract"
  });
});
