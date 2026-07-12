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
  resetFigmaApiClientForTests,
  setFigmaApiClientForTests,
  type FigmaApiClient
} from "../../lib/runtime/figma-api";
import { addSeedReference } from "../../lib/runtime/seed-capture";
import {
  deleteSeedReference,
  listSeedReferences
} from "../../lib/runtime/seed-reference";
import { listFigmaEvidenceSurfaces } from "../../lib/runtime/evidence-package";
import {
  createRegionAnnotation,
  listRegionAnnotations
} from "../../lib/runtime/region-annotation";
import { buildSeedProjectionTargets } from "../../components/workbench/projection/seed-projection";
import { openProjectDb, closeProjectDb } from "../../lib/runtime/db";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const api: FigmaApiClient = {
  async validateToken(token) {
    if (token === "figd_good") {
      return { ok: true, account: { handle: "designer" } };
    }
    return { ok: false, reason: "invalid_token" };
  },
  async capturePositionalEvidence({ nodeId }) {
    return {
      ok: true,
      capture: {
        screenshotDataUrl: TINY_PNG,
        frame: {
          nodeId,
          name: `Frame ${nodeId}`,
          bounds: { x: 0, y: 0, width: 100, height: 80 }
        },
        nodes: [
          {
            id: nodeId,
            parentId: null,
            name: `Frame ${nodeId}`,
            type: "FRAME",
            depth: 0,
            visible: true,
            bounds: { x: 0, y: 0, width: 100, height: 80 }
          }
        ],
        surfaceBounds: { width: 100, height: 80 }
      }
    };
  }
};

let projectDir: string;

beforeEach(async () => {
  resetFigmaCredentialStoreForTests();
  resetFigmaApiClientForTests();
  const store = createMemoryFigmaCredentialStore();
  await store.set("figd_good");
  setFigmaCredentialStoreForTests(store);
  setFigmaApiClientForTests(api);
  projectDir = mkdtempSync(path.join(tmpdir(), "ikran-seed-del-"));
});

afterEach(() => {
  resetFigmaCredentialStoreForTests();
  resetFigmaApiClientForTests();
  rmSync(projectDir, { recursive: true, force: true });
});

test("BUG repro: Runtime still listing a deleted canvas seed recreates it on next projection", async () => {
  // Local tldraw delete does not remove Runtime rows; next sync (e.g. paste)
  // recreates every Runtime seed — including the ones the designer removed.
  const a = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "ui"
  });
  expect(a.ok).toBe(true);
  if (!a.ok) return;

  const b = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=3-4",
    initiator: "ui"
  });
  expect(b.ok).toBe(true);
  if (!b.ok) return;

  const seeds = listSeedReferences(projectDir);
  const surfaces = listFigmaEvidenceSurfaces(projectDir);
  const targets = buildSeedProjectionTargets(seeds, surfaces, "sess");
  expect(targets.map((t) => t.shapeKey).sort()).toEqual(
    [a.record.id, b.record.id].sort()
  );
});

test("deleteSeedReference removes seed+surface so paste projection cannot revive it", async () => {
  const a = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "ui"
  });
  expect(a.ok).toBe(true);
  if (!a.ok) return;

  const b = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=3-4",
    initiator: "ui"
  });
  expect(b.ok).toBe(true);
  if (!b.ok) return;

  const deleted = deleteSeedReference(projectDir, a.record.id);
  expect(deleted).toEqual({ ok: true, id: a.record.id });

  expect(listSeedReferences(projectDir).map((s) => s.id)).toEqual([
    b.record.id
  ]);
  expect(
    listFigmaEvidenceSurfaces(projectDir).map((s) => s.seed_reference_id)
  ).toEqual([b.record.id]);

  const targets = buildSeedProjectionTargets(
    listSeedReferences(projectDir),
    listFigmaEvidenceSurfaces(projectDir),
    "sess"
  );
  expect(targets.map((t) => t.shapeKey)).toEqual([b.record.id]);
});

test("deleteSeedReference cascades designer annotations on the seed's surfaces", async () => {
  const a = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "ui"
  });
  expect(a.ok).toBe(true);
  if (!a.ok) return;

  const created = createRegionAnnotation(projectDir, {
    surfaceArtifactId: a.surface.id,
    author: "designer",
    body: "note",
    rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
  });
  expect(created.ok).toBe(true);

  const deleted = deleteSeedReference(projectDir, a.record.id);
  expect(deleted.ok).toBe(true);
  expect(listRegionAnnotations(projectDir)).toEqual([]);
  expect(listFigmaEvidenceSurfaces(projectDir)).toEqual([]);
});

test("deleteSeedReference is not_found for unknown id", () => {
  const db = openProjectDb(projectDir);
  closeProjectDb(db);
  expect(deleteSeedReference(projectDir, "missing")).toEqual({
    ok: false,
    reason: "not_found"
  });
});
