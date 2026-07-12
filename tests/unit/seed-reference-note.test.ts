// Issue 05B — per-Reference Note save / modify / clear with isolation.

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
  listSeedReferences,
  updateSeedReferenceNote
} from "../../lib/runtime/seed-reference";

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
  projectDir = mkdtempSync(path.join(tmpdir(), "ikran-note-"));
});

afterEach(() => {
  resetFigmaCredentialStoreForTests();
  resetFigmaApiClientForTests();
  rmSync(projectDir, { recursive: true, force: true });
});

test("save, modify, and clear Reference Note without touching identity or siblings", async () => {
  const a = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=1-1",
    referenceNote: "initial-a",
    initiator: "ui"
  });
  const b = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=2-2",
    referenceNote: "keep-b",
    initiator: "agent"
  });
  expect(a.ok && b.ok).toBe(true);
  if (!a.ok || !b.ok) return;

  const modified = updateSeedReferenceNote(projectDir, {
    id: a.record.id,
    referenceNote: "updated-a"
  });
  expect(modified.ok).toBe(true);
  if (!modified.ok) return;
  expect(modified.record.original_design_intent).toBe("updated-a");
  expect(modified.record.file_key).toBe(a.record.file_key);
  expect(modified.record.node_id).toBe(a.record.node_id);
  expect(modified.record.figma_seed_reference).toBe(
    a.record.figma_seed_reference
  );
  expect(modified.record.registered_via).toBe("ui");

  const cleared = updateSeedReferenceNote(projectDir, {
    id: a.record.id,
    referenceNote: ""
  });
  expect(cleared.ok).toBe(true);
  if (!cleared.ok) return;
  expect(cleared.record.original_design_intent).toBe("");

  const records = listSeedReferences(projectDir);
  const rowA = records.find((r) => r.id === a.record.id);
  const rowB = records.find((r) => r.id === b.record.id);
  expect(rowA?.original_design_intent).toBe("");
  expect(rowB?.original_design_intent).toBe("keep-b");
  expect(rowB?.file_key).toBe("AbCdEf");
  expect(rowB?.node_id).toBe("2:2");
});

test("unknown seed id fails closed", () => {
  const result = updateSeedReferenceNote(projectDir, {
    id: "missing-seed",
    referenceNote: "nope"
  });
  expect(result).toEqual({ ok: false, reason: "not_found" });
});

test("HTTP schema requires referenceNote so omit cannot wipe", async () => {
  const { updateSeedReferenceNoteInputSchema, parseCommandInput } =
    await import("../../lib/runtime/commands/schemas");
  expect(
    parseCommandInput(updateSeedReferenceNoteInputSchema, {
      id: "seed-1"
    }).ok
  ).toBe(false);
  expect(
    parseCommandInput(updateSeedReferenceNoteInputSchema, {
      id: "seed-1",
      referenceNote: ""
    }).ok
  ).toBe(true);
});
