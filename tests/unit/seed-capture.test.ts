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
import { listSeedReferences } from "../../lib/runtime/seed-reference";
import { listFigmaEvidenceSurfaces } from "../../lib/runtime/evidence-package";

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
    if (nodeId === "missing") {
      return { ok: false, reason: "not_found" };
    }
    return {
      ok: true,
      capture: {
        screenshotDataUrl: TINY_PNG,
        frame: {
          nodeId,
          name: "Home",
          bounds: { x: 0, y: 0, width: 100, height: 80 }
        },
        nodes: [
          {
            id: nodeId,
            parentId: null,
            name: "Home",
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
  setFigmaCredentialStoreForTests(store);
  setFigmaApiClientForTests(api);
  projectDir = mkdtempSync(path.join(tmpdir(), "ikran-capture-"));
});

afterEach(() => {
  resetFigmaCredentialStoreForTests();
  resetFigmaApiClientForTests();
  rmSync(projectDir, { recursive: true, force: true });
});

test("fail closed without Figma Connection — no seed or surface rows", async () => {
  const result = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "ui"
  });
  expect(result).toEqual({ ok: false, reason: "figma_connection_required" });
  expect(listSeedReferences(projectDir)).toEqual([]);
  expect(listFigmaEvidenceSurfaces(projectDir)).toEqual([]);
});

test("atomic capture writes seed + surface + positional index", async () => {
  const store = createMemoryFigmaCredentialStore();
  await store.set("figd_good");
  setFigmaCredentialStoreForTests(store);

  const result = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=1-2&t=noise",
    initiator: "ui"
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.record.file_key).toBe("AbCdEf");
  expect(result.record.node_id).toBe("1:2");
  expect(result.surface.screenshot_data_url).toMatch(/^data:image\/png/);
  expect(result.surface.positional_nodes_json).toContain('"FRAME"');
  expect(listSeedReferences(projectDir)).toHaveLength(1);
  expect(listFigmaEvidenceSurfaces(projectDir)).toHaveLength(1);
});

test("capture failure leaves no half-written state", async () => {
  const store = createMemoryFigmaCredentialStore();
  await store.set("figd_good");
  setFigmaCredentialStoreForTests(store);

  const result = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=missing",
    initiator: "agent"
  });
  expect(result).toEqual({ ok: false, reason: "not_found" });
  expect(listSeedReferences(projectDir)).toEqual([]);
  expect(listFigmaEvidenceSurfaces(projectDir)).toEqual([]);
});

test("missing node-id is rejected", async () => {
  const store = createMemoryFigmaCredentialStore();
  await store.set("figd_good");
  setFigmaCredentialStoreForTests(store);

  const result = await addSeedReference(projectDir, {
    figmaSeedReference: "https://www.figma.com/design/AbCdEf/Checkout",
    initiator: "ui"
  });
  expect(result).toEqual({ ok: false, reason: "missing_node_id" });
});
