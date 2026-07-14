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
import {
  getAnnotationNodeCandidatesContext,
  getCapturedNodeCorrespondence,
  getSeedReferenceContext
} from "../../lib/runtime/figma-context";

let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ikran-context-"));
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

test("seed context returns source/current evidence identity and Figma link without PAT", async () => {
  const captured = await addSeedReference(dir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2&t=share",
    initiator: "agent"
  });
  expect(captured.ok).toBe(true);
  if (!captured.ok) return;

  const result = getSeedReferenceContext(dir, captured.record.id);
  expect(result).toMatchObject({
    ok: true,
    source: { fileKey: "AbCdEf", nodeId: "1:2" },
    figmaLink:
      "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2&t=share",
    currentEvidence: {
      surfaceId: captured.surface.id,
      frameNodeId: "1:2"
    }
  });
  expect(JSON.stringify(result)).not.toContain("figd_ok_secret_never_return");
});

test("candidate context returns deterministic candidates and no primary node", async () => {
  const captured = await addSeedReference(dir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2",
    initiator: "ui"
  });
  expect(captured.ok).toBe(true);
  if (!captured.ok) return;

  const result = getAnnotationNodeCandidatesContext(dir, {
    surfaceId: captured.surface.id,
    rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.candidates[0]?.nodeId).toBe("1:2");
  expect(result).not.toHaveProperty("primaryNodeId");
});

test("captured node correspondence checks the seed's current positional index", async () => {
  const captured = await addSeedReference(dir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2",
    initiator: "agent"
  });
  expect(captured.ok).toBe(true);
  if (!captured.ok) return;

  expect(
    getCapturedNodeCorrespondence(dir, {
      seedReferenceId: captured.record.id,
      capturedNodeId: "1:2"
    })
  ).toMatchObject({ ok: true, correspondence: { status: "corresponding" } });
  expect(
    getCapturedNodeCorrespondence(dir, {
      seedReferenceId: captured.record.id,
      capturedNodeId: "removed:1"
    })
  ).toEqual({
    ok: true,
    currentSurfaceId: captured.surface.id,
    correspondence: {
      status: "missing",
      capturedNodeId: "removed:1"
    }
  });
});
