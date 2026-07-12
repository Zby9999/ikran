// Issue 05B — project-level Design Language Description + readiness.
// Empty Description must not block capture; readiness reports description_missing.

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
import {
  getDesignLanguageDescription,
  getProjectReadiness,
  setDesignLanguageDescription
} from "../../lib/runtime/project-readiness";
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
  projectDir = mkdtempSync(path.join(tmpdir(), "ikran-readiness-"));
});

afterEach(() => {
  resetFigmaCredentialStoreForTests();
  resetFigmaApiClientForTests();
  rmSync(projectDir, { recursive: true, force: true });
});

test("empty Description reports description_missing and does not block capture", async () => {
  const readiness = getProjectReadiness(projectDir);
  expect(readiness.preconditions).toContain("description_missing");
  expect(getDesignLanguageDescription(projectDir)).toBe("");

  const capture = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "ui"
  });
  expect(capture.ok).toBe(true);
  expect(listSeedReferences(projectDir)).toHaveLength(1);

  expect(getProjectReadiness(projectDir).preconditions).toContain(
    "description_missing"
  );
});

test("non-empty Description clears description_missing; update is project-scoped only", async () => {
  const first = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    referenceNote: "seed-a note",
    initiator: "ui"
  });
  expect(first.ok).toBe(true);

  const set = setDesignLanguageDescription(
    projectDir,
    "Shared editorial portfolio language"
  );
  expect(set.ok).toBe(true);
  expect(getDesignLanguageDescription(projectDir)).toBe(
    "Shared editorial portfolio language"
  );
  expect(getProjectReadiness(projectDir).preconditions).not.toContain(
    "description_missing"
  );

  const seeds = listSeedReferences(projectDir);
  expect(seeds).toHaveLength(1);
  expect(seeds[0].original_design_intent).toBe("seed-a note");

  // Description must not be copied onto seed rows.
  const db = openProjectDb(projectDir);
  try {
    const row = db
      .prepare(
        `SELECT original_design_intent FROM seed_references WHERE id = ?`
      )
      .get(seeds[0].id) as { original_design_intent: string };
    expect(row.original_design_intent).toBe("seed-a note");
  } finally {
    closeProjectDb(db);
  }

  const cleared = setDesignLanguageDescription(projectDir, "   ");
  expect(cleared.ok).toBe(true);
  expect(getDesignLanguageDescription(projectDir)).toBe("");
  expect(getProjectReadiness(projectDir).preconditions).toContain(
    "description_missing"
  );
});

test("whitespace-only Description counts as missing", () => {
  setDesignLanguageDescription(projectDir, "\t  \n");
  expect(getDesignLanguageDescription(projectDir)).toBe("");
  expect(getProjectReadiness(projectDir).preconditions).toContain(
    "description_missing"
  );
});
