// Task 10: HTTP and MCP share the command kernel — invalid payloads must
// surface the SAME domain reason. Shared Zod transport schemas must accept
// those payloads so the MCP SDK does not reject before domain validation.
//
// Active seed path uses addSeedReferenceCommand (+ Figma Connection). Retired
// Agent-supplied seed/evidence write contracts are absent from this suite.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initializeProjectDb } from "../../lib/runtime/db";
import {
  parseCommandInput,
  createRegionAnnotationInputSchema,
  addSeedReferenceInputSchema,
  addSeedReferenceInputShape
} from "../../lib/runtime/commands/schemas";
import {
  createRegionAnnotationCommand,
  addSeedReferenceCommand
} from "../../lib/runtime/commands";
import {
  createMemoryFigmaCredentialStore,
  resetFigmaCredentialStoreForTests,
  setFigmaCredentialStoreForTests
} from "../../lib/runtime/figma-credential-store";
import {
  resetFigmaApiClientForTests,
  setFigmaApiClientForTests,
  createMockFigmaApiClient
} from "../../lib/runtime/figma-api";

const tmpDirs: string[] = [];

beforeEach(() => {
  resetFigmaCredentialStoreForTests();
  resetFigmaApiClientForTests();
  // Isolate from macOS Keychain / env — gate-closed cases must see empty store.
  setFigmaCredentialStoreForTests(createMemoryFigmaCredentialStore());
  setFigmaApiClientForTests(createMockFigmaApiClient());
});

afterEach(() => {
  resetFigmaCredentialStoreForTests();
  resetFigmaApiClientForTests();
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function freshProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-cmd-parity-"));
  tmpDirs.push(dir);
  initializeProjectDb(dir);
  return dir;
}

async function connectMockFigma(): Promise<void> {
  const store = createMemoryFigmaCredentialStore();
  await store.set("figd_ok_unit");
  setFigmaCredentialStoreForTests(store);
  setFigmaApiClientForTests(createMockFigmaApiClient());
}

describe("HTTP/MCP command parity — shared domain reasons", () => {
  test("shared parser rejects structural errors as invalid_params", () => {
    const parsed = parseCommandInput(addSeedReferenceInputSchema, {
      figmaSeedReference: 42
    });
    expect(parsed).toMatchObject({ ok: false, reason: "invalid_params" });
  });

  test("Active add_seed_reference schema does not expose registeredVia / initiator", () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        addSeedReferenceInputShape,
        "registeredVia"
      )
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(addSeedReferenceInputShape, "initiator")
    ).toBe(false);
  });

  test("Active seed-capture: gate closed + URL reasons match", async () => {
    const projectPath = freshProject();
    const schema = addSeedReferenceInputSchema;

    const closed = await addSeedReferenceCommand(projectPath, {
      figmaSeedReference:
        "https://www.figma.com/design/abc123/X?node-id=1:2"
    });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.reason).toBe("figma_connection_required");

    await connectMockFigma();

    const cases: Array<{ payload: Record<string, unknown>; reason: string }> = [
      {
        payload: { figmaSeedReference: "" },
        reason: "missing_figma_seed_reference"
      },
      {
        payload: {
          figmaSeedReference: "http://www.figma.com/design/abc/X?node-id=1:2"
        },
        reason: "invalid_figma_url"
      },
      {
        payload: {
          figmaSeedReference: "https://example.com/design/abc/X?node-id=1:2"
        },
        reason: "not_figma_host"
      },
      {
        payload: {
          figmaSeedReference: "https://www.figma.com/other/abc/X?node-id=1:2"
        },
        reason: "not_figma_design_path"
      },
      {
        payload: {
          figmaSeedReference: "https://www.figma.com/design/abc123/Checkout"
        },
        reason: "missing_node_id"
      }
    ];

    for (const c of cases) {
      expect(schema.safeParse(c.payload).success, c.reason).toBe(true);
      const result = await addSeedReferenceCommand(projectPath, c.payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(c.reason);
    }
  });

  test("region: transport schema accepts domain-invalid payloads; command reason matches", () => {
    const projectPath = freshProject();
    const schema = createRegionAnnotationInputSchema;

    const cases: Array<{ payload: Record<string, unknown>; reason: string }> = [
      {
        payload: {
          target: {
            kind: "figma-region",
            rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
          },
          author: "agent",
          body: "x"
        },
        reason: "missing_surface_anchor"
      },
      {
        payload: {
          target: {
            kind: "figma-region",
            surfaceArtifactId: "surf-1",
            rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
          },
          body: "x"
        },
        reason: "missing_author"
      },
      {
        payload: {
          target: {
            kind: "figma-region",
            surfaceArtifactId: "surf-1",
            rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
          },
          author: "robot",
          body: "x"
        },
        reason: "invalid_author"
      },
      {
        payload: {
          target: {
            kind: "figma-region",
            surfaceArtifactId: "surf-1"
          },
          author: "agent",
          body: "x"
        },
        reason: "missing_rect"
      },
      {
        payload: {
          target: {
            kind: "figma-region",
            surfaceArtifactId: "missing-surface",
            rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
          },
          author: "agent"
        },
        reason: "surface_not_found"
      }
    ];

    for (const c of cases) {
      expect(schema.safeParse(c.payload).success, c.reason).toBe(true);
      const result = createRegionAnnotationCommand(projectPath, c.payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(c.reason);
    }

    expect(
      schema.safeParse({
        target: {
          kind: "figma-node",
          evidenceVersionId: "surface-v1"
        },
        author: "agent"
      }).success
    ).toBe(false);
  });
});

describe("MCP direct command — no loopback fetch", () => {
  test("addSeedReferenceCommand succeeds with fetch disabled; list sees record", async () => {
    const projectPath = freshProject();
    await connectMockFigma();

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async (..._args: unknown[]) => {
      fetchCalls += 1;
      throw new Error("loopback fetch must not be used by command kernel");
    }) as typeof fetch;

    try {
      const result = await addSeedReferenceCommand(projectPath, {
        figmaSeedReference:
          "https://www.figma.com/design/parityKey001/NoLoop?node-id=3:4",
        referenceNote: "parity no-loopback",
        initiator: "agent"
      });
      expect(result.ok).toBe(true);
      expect(fetchCalls).toBe(0);

      const { listSeedReferencesCommand } = await import(
        "../../lib/runtime/commands"
      );
      const listed = listSeedReferencesCommand(projectPath);
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.records.length).toBe(1);
        expect(listed.records[0].figma_seed_reference).toContain("parityKey001");
        expect(listed.records[0].current_surface_id).toBeTruthy();
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
