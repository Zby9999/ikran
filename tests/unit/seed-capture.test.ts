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
import {
  addSeedReference,
  refreshSeedReference
} from "../../lib/runtime/seed-capture";
import { listSeedReferences } from "../../lib/runtime/seed-reference";
import { listFigmaEvidenceSurfaces } from "../../lib/runtime/evidence-package";
import { listEvents } from "../../lib/runtime/events";
import { closeProjectDb, openProjectDb } from "../../lib/runtime/db";

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

test("explicit refresh appends a surface, advances current, and preserves history", async () => {
  await withConnectedStore();
  const first = await addSeedReference(projectDir, {
    figmaSeedReference: "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "ui"
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  const refreshed = await refreshSeedReference(projectDir, {
    seedReferenceId: first.record.id,
    initiator: "ui"
  });
  expect(refreshed.ok).toBe(true);
  if (!refreshed.ok) return;

  expect(refreshed.surface.id).not.toBe(first.surface.id);
  expect(refreshed.previous_surface_id).toBe(first.surface.id);
  expect(refreshed.record.current_surface_id).toBe(refreshed.surface.id);
  const surfaces = listFigmaEvidenceSurfaces(projectDir);
  expect(surfaces).toHaveLength(2);
  expect(surfaces.find((surface) => surface.id === first.surface.id)).toMatchObject({
    superseded_by: refreshed.surface.id
  });
  expect(surfaces.find((surface) => surface.id === refreshed.surface.id)).toMatchObject({
    superseded_by: null
  });
});

test("failed explicit refresh leaves current and history unchanged", async () => {
  await withConnectedStore();
  const first = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=forbidden",
    initiator: "ui"
  });
  // The fixture fails this id on initial capture, so create a normal seed then
  // switch the API double to fail only for the refresh call.
  expect(first.ok).toBe(false);

  const normal = await addSeedReference(projectDir, {
    figmaSeedReference: "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "ui"
  });
  expect(normal.ok).toBe(true);
  if (!normal.ok) return;

  setFigmaApiClientForTests({
    ...api,
    async capturePositionalEvidence() {
      return { ok: false, reason: "rate_limited" };
    }
  });
  const eventsBefore = listEvents(projectDir);
  const failed = await refreshSeedReference(projectDir, {
    seedReferenceId: normal.record.id,
    initiator: "ui"
  });
  expect(failed).toEqual({ ok: false, reason: "rate_limited" });
  expect(listSeedReferences(projectDir)[0].current_surface_id).toBe(
    normal.surface.id
  );
  expect(listFigmaEvidenceSurfaces(projectDir)).toEqual([normal.surface]);
  expect(listEvents(projectDir)).toEqual(eventsBefore);
});

test("late refresh transaction failure rolls back surface, lineage, current, and events", async () => {
  await withConnectedStore();
  const normal = await addSeedReference(projectDir, {
    figmaSeedReference: "https://www.figma.com/design/AbCdEf/X?node-id=1-2",
    initiator: "ui"
  });
  expect(normal.ok).toBe(true);
  if (!normal.ok) return;

  const db = openProjectDb(projectDir);
  try {
    db.exec(`
      CREATE TRIGGER fail_refresh_success_event
      BEFORE INSERT ON events
      WHEN NEW.type = 'figma_evidence_refreshed'
      BEGIN
        SELECT RAISE(ABORT, 'forced late refresh failure');
      END;
    `);
  } finally {
    closeProjectDb(db);
  }

  const seedsBefore = listSeedReferences(projectDir);
  const surfacesBefore = listFigmaEvidenceSurfaces(projectDir);
  const eventsBefore = listEvents(projectDir);
  const failed = await refreshSeedReference(projectDir, {
    seedReferenceId: normal.record.id,
    initiator: "agent"
  });

  expect(failed).toEqual({ ok: false, reason: "db_error" });
  expect(listSeedReferences(projectDir)).toEqual(seedsBefore);
  expect(listFigmaEvidenceSurfaces(projectDir)).toEqual(surfacesBefore);
  expect(listEvents(projectDir)).toEqual(eventsBefore);
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

test("three distinct canonical refs get independent surfaces and lineages", async () => {
  await withConnectedStore();

  const urls = [
    "https://www.figma.com/design/AbCdEf/X?node-id=1-1",
    "https://www.figma.com/design/AbCdEf/X?node-id=2-2",
    "https://www.figma.com/design/OtherKey/Y?node-id=3-3"
  ];
  const results = [];
  for (const url of urls) {
    const result = await addSeedReference(projectDir, {
      figmaSeedReference: url,
      initiator: "ui"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    results.push(result);
  }

  const seeds = listSeedReferences(projectDir);
  const surfaces = listFigmaEvidenceSurfaces(projectDir);
  expect(seeds).toHaveLength(3);
  expect(surfaces).toHaveLength(3);

  const identities = new Set(seeds.map((s) => `${s.file_key}|${s.node_id}`));
  expect(identities).toEqual(
    new Set(["AbCdEf|1:1", "AbCdEf|2:2", "OtherKey|3:3"])
  );

  const surfaceIds = new Set(surfaces.map((s) => s.id));
  expect(surfaceIds.size).toBe(3);
  for (const result of results) {
    expect(result.record.current_surface_id).toBe(result.surface.id);
    expect(surfaceIds.has(result.surface.id)).toBe(true);
  }
});

test("duplicate submit preserves first initiator and does not grow the collection", async () => {
  await withConnectedStore();

  const first = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=0-81&t=first",
    referenceNote: "keep-me",
    initiator: "ui"
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.record.registered_via).toBe("ui");

  const duplicate = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=0:81&t=other",
    referenceNote: "must-not-overwrite",
    initiator: "agent"
  });
  expect(duplicate.ok).toBe(true);
  if (!duplicate.ok) return;
  expect(duplicate.reused).toBe(true);
  expect(duplicate.record.id).toBe(first.record.id);
  expect(duplicate.record.registered_via).toBe("ui");
  expect(duplicate.record.original_design_intent).toBe("keep-me");
  expect(duplicate.surface.id).toBe(first.surface.id);
  expect(listSeedReferences(projectDir)).toHaveLength(1);
  expect(listFigmaEvidenceSurfaces(projectDir)).toHaveLength(1);
});

test("ui and agent first captures differ only by initiator for the same URL", async () => {
  await withConnectedStore();

  const uiDir = mkdtempSync(path.join(tmpdir(), "ikran-capture-ui-"));
  const agentDir = mkdtempSync(path.join(tmpdir(), "ikran-capture-agent-"));
  try {
    const url =
      "https://www.figma.com/design/AbCdEf/X?node-id=9-9&t=share";
    const ui = await addSeedReference(uiDir, {
      figmaSeedReference: url,
      referenceNote: "same-note",
      initiator: "ui"
    });
    const agent = await addSeedReference(agentDir, {
      figmaSeedReference: url,
      referenceNote: "same-note",
      initiator: "agent"
    });
    expect(ui.ok && agent.ok).toBe(true);
    if (!ui.ok || !agent.ok) return;

    expect(ui.record.file_key).toBe(agent.record.file_key);
    expect(ui.record.node_id).toBe(agent.record.node_id);
    expect(ui.record.original_design_intent).toBe(
      agent.record.original_design_intent
    );
    expect(ui.surface.frame_name).toBe(agent.surface.frame_name);
    expect(ui.record.registered_via).toBe("ui");
    expect(agent.record.registered_via).toBe("agent");
  } finally {
    rmSync(uiDir, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("percent-encoded node-id canonicalizes to the same Reference", async () => {
  await withConnectedStore();

  const first = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=0%3A81",
    initiator: "agent"
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.record.node_id).toBe("0:81");

  const second = await addSeedReference(projectDir, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/X?node-id=0-81",
    initiator: "ui"
  });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.reused).toBe(true);
  expect(second.record.id).toBe(first.record.id);
  expect(listSeedReferences(projectDir)).toHaveLength(1);
});
