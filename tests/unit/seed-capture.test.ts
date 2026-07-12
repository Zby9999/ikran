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

type CaptureFailReason =
  | "not_found"
  | "forbidden"
  | "rate_limited"
  | "screenshot_missing"
  | "malformed_figma_response";

/** Node ids (post-normalize `:`) that force a capture failure from the double. */
const CAPTURE_FAIL_BY_NODE: Record<string, CaptureFailReason> = {
  missing: "not_found",
  forbidden: "forbidden",
  "rate:limited": "rate_limited",
  "no:shot": "screenshot_missing",
  malformed: "malformed_figma_response"
};

const api: FigmaApiClient = {
  async validateToken(token) {
    if (token === "figd_good") {
      return { ok: true, account: { handle: "designer" } };
    }
    return { ok: false, reason: "invalid_token" };
  },
  async capturePositionalEvidence({ nodeId }) {
    const fail = CAPTURE_FAIL_BY_NODE[nodeId];
    if (fail) {
      return { ok: false, reason: fail };
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

async function withConnectedStore(): Promise<void> {
  const store = createMemoryFigmaCredentialStore();
  await store.set("figd_good");
  setFigmaCredentialStoreForTests(store);
}

function expectNoHalfWritten(dir: string): void {
  expect(listSeedReferences(dir)).toEqual([]);
  expect(listFigmaEvidenceSurfaces(dir)).toEqual([]);
}

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
  expectNoHalfWritten(projectDir);
});

test("atomic capture writes seed + surface + positional index", async () => {
  await withConnectedStore();

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

test.each([
  { nodeIdParam: "missing", reason: "not_found" as const },
  { nodeIdParam: "forbidden", reason: "forbidden" as const },
  { nodeIdParam: "rate-limited", reason: "rate_limited" as const },
  { nodeIdParam: "no-shot", reason: "screenshot_missing" as const },
  { nodeIdParam: "malformed", reason: "malformed_figma_response" as const }
])(
  "capture failure ($reason) leaves no half-written state",
  async ({ nodeIdParam, reason }) => {
    await withConnectedStore();

    const result = await addSeedReference(projectDir, {
      figmaSeedReference: `https://www.figma.com/design/AbCdEf/X?node-id=${nodeIdParam}`,
      initiator: "agent"
    });
    expect(result).toEqual({ ok: false, reason });
    expectNoHalfWritten(projectDir);
  }
);

test("invalid URL is rejected with no half-written state", async () => {
  await withConnectedStore();

  const result = await addSeedReference(projectDir, {
    figmaSeedReference: "not-a-url",
    initiator: "ui"
  });
  expect(result).toEqual({ ok: false, reason: "invalid_figma_url" });
  expectNoHalfWritten(projectDir);
});

test("missing node-id is rejected with no half-written state", async () => {
  await withConnectedStore();

  const result = await addSeedReference(projectDir, {
    figmaSeedReference: "https://www.figma.com/design/AbCdEf/Checkout",
    initiator: "ui"
  });
  expect(result).toEqual({ ok: false, reason: "missing_node_id" });
  expectNoHalfWritten(projectDir);
});

test("legacy pending seed (no surface) is fulfilled instead of unique-key db_error", async () => {
  await withConnectedStore();

  const { registerSeedReference, listSeedReferences } = await import(
    "../../lib/runtime/seed-reference"
  );
  const registered = registerSeedReference(projectDir, {
    figmaSeedReference: "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    originalDesignIntent: "legacy pending",
    registeredVia: "agent"
  });
  expect(registered.ok).toBe(true);
  if (!registered.ok) return;
  expect(registered.record.current_surface_id).toBeNull();

  const captured = await addSeedReference(projectDir, {
    figmaSeedReference: "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "ui"
  });
  expect(captured.ok).toBe(true);
  if (!captured.ok) return;
  expect(captured.fulfilled_pending).toBe(true);
  expect(captured.record.id).toBe(registered.record.id);
  expect(captured.record.current_surface_id).toBe(captured.surface.id);
  expect(captured.event_id).not.toBe(captured.record.id);
  expect(listSeedReferences(projectDir)).toHaveLength(1);
  expect(listFigmaEvidenceSurfaces(projectDir)).toHaveLength(1);
});

test("reuse returns real seed_reference_registered event_id", async () => {
  await withConnectedStore();

  const first = await addSeedReference(projectDir, {
    figmaSeedReference: "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "ui"
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  const second = await addSeedReference(projectDir, {
    figmaSeedReference: "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "agent"
  });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.reused).toBe(true);
  expect(second.event_id).toBe(first.event_id);
  expect(second.event_id).not.toBe(second.record.id);
});
