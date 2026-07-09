// Unit tests for evidence package schema validation + record path (Issue 05).
// Pure Node — no MCP/Next. Runtime never contacts Figma.

import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  validateEvidencePackage,
  recordEvidencePackage,
  listFigmaEvidenceSurfaces
} from "../lib/runtime/evidence-package";
import { registerSeedReference } from "../lib/runtime/seed-reference";
import { listEvents } from "../lib/runtime/events";
import { initializeProjectDb } from "../lib/runtime/db";

const VALID_FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";

function minimalPackage(overrides: Record<string, unknown> = {}) {
  return {
    figmaSeedReference: VALID_FIGMA,
    frame: { nodeId: "1:2", name: "Checkout" },
    evidenceViews: { rawData: "available", screenshot: "missing" },
    ...overrides
  };
}

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-evidence-unit-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function countSurfaces(dir: string): number {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM figma_evidence_surfaces")
      .get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

function eventPayload(ev: { payload: unknown }): Record<string, unknown> {
  if (typeof ev.payload === "string") {
    return JSON.parse(ev.payload) as Record<string, unknown>;
  }
  return ev.payload as Record<string, unknown>;
}

test.describe("validateEvidencePackage (unit)", () => {
  test("valid minimal: raw available, screenshot missing, no screenshot payload", () => {
    const res = validateEvidencePackage(minimalPackage());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.package.figmaSeedReference).toBe(VALID_FIGMA);
    expect(res.package.frame.nodeId).toBe("1:2");
    expect(res.package.frame.name).toBe("Checkout");
    expect(res.package.evidenceViews).toEqual({
      rawData: "available",
      screenshot: "missing"
    });
    expect(res.package.screenshot).toBeUndefined();
  });

  test("valid with screenshot artifactPath when screenshot available", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        evidenceViews: { rawData: "available", screenshot: "available" },
        screenshot: { artifactPath: "artifacts/checkout.png" }
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.package.screenshot?.artifactPath).toBe("artifacts/checkout.png");
  });

  test("valid with seedReferenceId only (no figma URL)", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        figmaSeedReference: undefined,
        seedReferenceId: "seed-abc-123"
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.package.seedReferenceId).toBe("seed-abc-123");
    expect(res.package.figmaSeedReference).toBeUndefined();
  });

  test("explicit missing markers accepted (do not invent content)", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        evidenceViews: { rawData: "missing", screenshot: "missing" }
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.package.evidenceViews.rawData).toBe("missing");
    expect(res.package.evidenceViews.screenshot).toBe("missing");
    expect(res.package.screenshot).toBeUndefined();
  });

  test("invalid: screenshot available but no payload", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        evidenceViews: { rawData: "available", screenshot: "available" }
      })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("screenshot_required_when_available");
  });

  test("invalid: screenshot payload present while screenshot missing", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        evidenceViews: { rawData: "available", screenshot: "missing" },
        screenshot: { artifactPath: "artifacts/x.png" }
      })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("screenshot_payload_when_missing");
  });

  test("invalid: bad figma URL", () => {
    const res = validateEvidencePackage(
      minimalPackage({ figmaSeedReference: "https://example.com/design/x" })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_figma_host");
  });

  test("invalid: missing frame.nodeId", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        frame: { nodeId: "", name: "Checkout" }
      })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_frame_node_id");
  });

  test("invalid: dataUrl too large", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        evidenceViews: { rawData: "missing", screenshot: "available" },
        screenshot: { dataUrl: "x".repeat(2_000_001) }
      })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("screenshot_too_large");
  });

  test("invalid: neither figmaSeedReference nor seedReferenceId", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        figmaSeedReference: undefined,
        seedReferenceId: undefined
      })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_seed_reference");
  });
});

test.describe("recordEvidencePackage (unit)", () => {
  test("happy path: inserts surface + evidence_package_recorded; list returns row", () => {
    withTempProject((dir) => {
      const res = recordEvidencePackage(dir, minimalPackage());
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(typeof res.event_id).toBe("string");
      expect(res.event_id).toBeTruthy();
      expect(res.audit_warning).toBeUndefined();
      expect(res.record.id).toBeTruthy();
      expect(res.record.figma_seed_reference).toBe(VALID_FIGMA);
      expect(res.record.frame_node_id).toBe("1:2");
      expect(res.record.frame_name).toBe("Checkout");
      expect(res.record.seed_reference_id).toBeNull();
      expect(JSON.parse(res.record.evidence_views_json)).toEqual({
        rawData: "available",
        screenshot: "missing"
      });

      const listed = listFigmaEvidenceSurfaces(dir);
      expect(listed.length).toBe(1);
      expect(listed[0].id).toBe(res.record.id);

      const ev = listEvents(dir, "evidence_package_recorded");
      expect(ev.length).toBe(1);
      expect(eventPayload(ev[0]).surface_id).toBe(res.record.id);
      expect(existsSync(path.join(dir, ".ikran", "events.jsonl"))).toBe(true);
    });
  });

  test("happy path with seedReferenceId: resolves URL from seed_references", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const res = recordEvidencePackage(
        dir,
        minimalPackage({
          figmaSeedReference: undefined,
          seedReferenceId: seed.record.id
        })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.seed_reference_id).toBe(seed.record.id);
      expect(res.record.figma_seed_reference).toBe(VALID_FIGMA);
    });
  });

  test("happy path with artifactPath: stores path without requiring file to exist", () => {
    withTempProject((dir) => {
      const res = recordEvidencePackage(
        dir,
        minimalPackage({
          evidenceViews: { rawData: "available", screenshot: "available" },
          screenshot: { artifactPath: "artifacts/checkout.png" }
        })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.screenshot_artifact_path).toBe("artifacts/checkout.png");
      // File need not exist yet (Agent may declare before write).
      expect(existsSync(path.join(dir, "artifacts/checkout.png"))).toBe(false);
    });
  });

  test("fail-closed: validation failure writes invalid_output and NO surface row", () => {
    withTempProject((dir) => {
      const res = recordEvidencePackage(
        dir,
        minimalPackage({
          evidenceViews: { rawData: "available", screenshot: "available" }
        })
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("screenshot_required_when_available");

      expect(countSurfaces(dir)).toBe(0);
      expect(listFigmaEvidenceSurfaces(dir)).toEqual([]);

      const invalid = listEvents(dir, "invalid_output");
      expect(invalid.length).toBe(1);
      expect(eventPayload(invalid[0])).toMatchObject({
        tool: "record_evidence_package",
        reason: "screenshot_required_when_available"
      });

      expect(listEvents(dir, "evidence_package_recorded")).toEqual([]);
    });
  });

  test("fail-closed: missing seed_reference_id → seed_reference_not_found + invalid_output", () => {
    withTempProject((dir) => {
      const res = recordEvidencePackage(
        dir,
        minimalPackage({
          figmaSeedReference: undefined,
          seedReferenceId: "does-not-exist"
        })
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("seed_reference_not_found");
      expect(countSurfaces(dir)).toBe(0);

      const invalid = listEvents(dir, "invalid_output");
      expect(invalid.length).toBe(1);
      expect(eventPayload(invalid[0])).toMatchObject({
        tool: "record_evidence_package",
        reason: "seed_reference_not_found"
      });
    });
  });

  test("fail-closed: artifact path escape → artifact_path_escape + invalid_output", () => {
    withTempProject((dir) => {
      const res = recordEvidencePackage(
        dir,
        minimalPackage({
          evidenceViews: { rawData: "available", screenshot: "available" },
          screenshot: { artifactPath: "../outside.png" }
        })
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("artifact_path_escape");
      expect(countSurfaces(dir)).toBe(0);

      const invalid = listEvents(dir, "invalid_output");
      expect(invalid.length).toBe(1);
      expect(eventPayload(invalid[0])).toMatchObject({
        tool: "record_evidence_package",
        reason: "artifact_path_escape"
      });
    });
  });

  test("audit write failure: surface still saved; ok:true + event_id:null + audit_warning", () => {
    withTempProject((dir) => {
      mkdirSync(path.join(dir, ".ikran", "events.jsonl"));

      const res = recordEvidencePackage(dir, minimalPackage());
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.event_id).toBeNull();
      expect(res.audit_warning).toBe("event_write_failed");
      expect(res.record.figma_seed_reference).toBe(VALID_FIGMA);

      expect(countSurfaces(dir)).toBe(1);
      expect(listFigmaEvidenceSurfaces(dir).length).toBe(1);
    });
  });

  test("listFigmaEvidenceSurfaces: oldest-first (matches listSeedReferences)", () => {
    withTempProject((dir) => {
      const a = recordEvidencePackage(
        dir,
        minimalPackage({ frame: { nodeId: "1:1", name: "A" } })
      );
      const b = recordEvidencePackage(
        dir,
        minimalPackage({ frame: { nodeId: "2:2", name: "B" } })
      );
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;

      const listed = listFigmaEvidenceSurfaces(dir);
      expect(listed.map((r) => r.frame_name)).toEqual(["A", "B"]);
    });
  });
});
