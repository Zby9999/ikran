// Unit tests for evidence package schema validation + record path (Issue 05).
// Pure Node — no MCP/Next. Runtime never contacts Figma.

import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import {
  validateEvidencePackage,
  recordEvidencePackage,
  listFigmaEvidenceSurfaces,
  assertArtifactPathInProject,
  resolveProjectArtifactPath
} from "../../lib/runtime/evidence-package";
import { registerSeedReference, listSeedReferences } from "../../lib/runtime/seed-reference";
import { listEvents } from "../../lib/runtime/events";
import { initializeProjectDb } from "../../lib/runtime/db";
import {
  EVIDENCE_MEDIA_RETENTION_MS,
  maintainEvidenceMedia
} from "../../lib/runtime/evidence-media";

const VALID_FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
        screenshot: {
          dataUrl: `data:image/png;base64,${"A".repeat(2_000_001)}`
        }
      })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("screenshot_too_large");
  });

  test("invalid: dataUrl must be image data URL (reject https)", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        evidenceViews: { rawData: "missing", screenshot: "available" },
        screenshot: {
          dataUrl: "https://www.figma.com/file/abc/preview.png"
        }
      })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_screenshot_data_url");
  });

  test("invalid: dataUrl rejects non-image data: schemes", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        evidenceViews: { rawData: "missing", screenshot: "available" },
        screenshot: { dataUrl: "data:text/plain;base64,YQ==" }
      })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_screenshot_data_url");
  });

  test("valid: tiny png dataUrl accepted", () => {
    const res = validateEvidencePackage(
      minimalPackage({
        evidenceViews: { rawData: "missing", screenshot: "available" },
        screenshot: {
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        }
      })
    );
    expect(res.ok).toBe(true);
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
  test("happy path: URL-only resolves unique seed, inserts surface + event", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const res = recordEvidencePackage(dir, minimalPackage());
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(typeof res.event_id).toBe("string");
      expect(res.event_id).toBeTruthy();
      expect(res.record.id).toBeTruthy();
      expect(res.record.figma_seed_reference).toBe(VALID_FIGMA);
      expect(res.record.frame_node_id).toBe("1:2");
      expect(res.record.frame_name).toBe("Checkout");
      expect(res.record.seed_reference_id).toBe(seed.record.id);
      expect(res.record.superseded_by).toBeNull();
      expect(JSON.parse(res.record.evidence_views_json)).toEqual({
        rawData: "available",
        screenshot: "missing"
      });

      const listed = listFigmaEvidenceSurfaces(dir);
      expect(listed.length).toBe(1);
      expect(listed[0].id).toBe(res.record.id);

      const seeds = listSeedReferences(dir);
      expect(seeds[0].current_surface_id).toBe(res.record.id);

      const ev = listEvents(dir, "evidence_package_recorded");
      expect(ev.length).toBe(1);
      expect(eventPayload(ev[0]).surface_id).toBe(res.record.id);
    });
  });

  test("URL-only without matching seed → seed_reference_not_found", () => {
    withTempProject((dir) => {
      const res = recordEvidencePackage(dir, minimalPackage());
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("seed_reference_not_found");
      expect(countSurfaces(dir)).toBe(0);
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
      expect(res.record.superseded_by).toBeNull();
    });
  });

  test("append-only lineage: second record supersedes first; current points to new", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const first = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "First" }
        })
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const second = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "Second" },
          evidenceViews: { rawData: "available", screenshot: "available" },
          screenshot: { artifactPath: "artifacts/second.png" }
        })
      );
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      const listed = listFigmaEvidenceSurfaces(dir);
      expect(listed.length).toBe(2);
      expect(listed.map((r) => r.id)).toEqual([first.record.id, second.record.id]);

      const oldRow = listed.find((r) => r.id === first.record.id)!;
      const newRow = listed.find((r) => r.id === second.record.id)!;
      expect(oldRow.superseded_by).toBe(second.record.id);
      expect(newRow.superseded_by).toBeNull();

      const seeds = listSeedReferences(dir);
      expect(seeds[0].current_surface_id).toBe(second.record.id);

      // New declaration is current even when first had no screenshot.
      expect(first.record.screenshot_artifact_path).toBeNull();
      expect(second.record.screenshot_artifact_path).toBe("artifacts/second.png");
    });
  });

  test("corrupt old current already superseded: returns db_error and rolls back", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const first = recordEvidencePackage(
        dir,
        minimalPackage({
          figmaSeedReference: undefined,
          seedReferenceId: seed.record.id,
          frame: { nodeId: "1:2", name: "First" }
        })
      );
      const second = recordEvidencePackage(
        dir,
        minimalPackage({
          figmaSeedReference: undefined,
          seedReferenceId: seed.record.id,
          frame: { nodeId: "1:2", name: "Second" }
        })
      );
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
      db.exec("PRAGMA foreign_keys = ON");
      db.prepare(
        `UPDATE seed_references SET current_surface_id = ? WHERE id = ?`
      ).run(first.record.id, seed.record.id);
      db.close();

      const beforeEvents = listEvents(dir, "evidence_package_recorded").length;
      const result = recordEvidencePackage(
        dir,
        minimalPackage({
          figmaSeedReference: undefined,
          seedReferenceId: seed.record.id,
          frame: { nodeId: "1:2", name: "Rejected fork" }
        })
      );

      expect(result).toEqual({ ok: false, reason: "db_error" });
      expect(countSurfaces(dir)).toBe(2);
      expect(listEvents(dir, "evidence_package_recorded")).toHaveLength(
        beforeEvents
      );
      const surfaces = listFigmaEvidenceSurfaces(dir);
      expect(
        surfaces.find((surface) => surface.id === first.record.id)
          ?.superseded_by
      ).toBe(second.record.id);
      expect(listSeedReferences(dir)[0].current_surface_id).toBe(
        first.record.id
      );
    });
  });

  test("seed pointer changes after resolve: CAS fails and rolls back transaction", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const first = recordEvidencePackage(
        dir,
        minimalPackage({
          figmaSeedReference: undefined,
          seedReferenceId: seed.record.id,
          frame: { nodeId: "1:2", name: "First" }
        })
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TRIGGER stale_seed_pointer_after_surface_insert
        AFTER INSERT ON figma_evidence_surfaces
        BEGIN
          UPDATE seed_references
          SET current_surface_id = NULL
          WHERE id = NEW.seed_reference_id;
        END;
      `);
      db.close();

      const beforeEvents = listEvents(dir, "evidence_package_recorded").length;
      const result = recordEvidencePackage(
        dir,
        minimalPackage({
          figmaSeedReference: undefined,
          seedReferenceId: seed.record.id,
          frame: { nodeId: "1:2", name: "Stale CAS" }
        })
      );

      expect(result).toEqual({ ok: false, reason: "db_error" });
      expect(countSurfaces(dir)).toBe(1);
      expect(listEvents(dir, "evidence_package_recorded")).toHaveLength(
        beforeEvents
      );
      expect(listFigmaEvidenceSurfaces(dir)[0].superseded_by).toBeNull();
      expect(listSeedReferences(dir)[0].current_surface_id).toBe(
        first.record.id
      );
    });
  });

  test("both refs with different t= but same canonical identity succeed", () => {
    withTempProject((dir) => {
      const seedUrl =
        "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2&t=seed-aaa";
      const declareUrl =
        "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2&t=declare-bbb";
      const seed = registerSeedReference(dir, {
        figmaSeedReference: seedUrl,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const res = recordEvidencePackage(
        dir,
        minimalPackage({
          figmaSeedReference: declareUrl,
          seedReferenceId: seed.record.id
        })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.seed_reference_id).toBe(seed.record.id);
      expect(res.record.figma_seed_reference).toBe(declareUrl);
    });
  });

  test("happy path with artifactPath: stores path without requiring file to exist", () => {
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
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
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

  test("inline screenshot input is externalized into a Runtime-owned artifact", () => {
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
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          evidenceViews: { rawData: "available", screenshot: "available" },
          screenshot: { dataUrl: TINY_PNG }
        })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.screenshot_data_url).toBeNull();
      expect(res.record.screenshot_artifact_path).toMatch(
        /^\.ikran\/artifacts\/evidence-media\/.+\.png$/
      );
      expect(
        existsSync(path.join(dir, res.record.screenshot_artifact_path!))
      ).toBe(true);
    });
  });

  test("retention clears but never unlinks an explicitly declared user artifact", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;
      const userPath = ".ikran/artifacts/evidence-media/user-owned.png";
      mkdirSync(path.dirname(path.join(dir, userPath)), { recursive: true });
      writeFileSync(path.join(dir, userPath), "user-owned");

      const first = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          evidenceViews: { rawData: "available", screenshot: "available" },
          screenshot: { artifactPath: userPath }
        })
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "Second" }
        })
      );
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      maintainEvidenceMedia(dir, {
        now: new Date(Date.now() + EVIDENCE_MEDIA_RETENTION_MS + 1_000)
      });
      const retired = listFigmaEvidenceSurfaces(dir).find(
        (surface) => surface.id === first.record.id
      )!;
      expect(retired.screenshot_artifact_path).toBeNull();
      expect(existsSync(path.join(dir, userPath))).toBe(true);
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
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const res = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
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

  test("fail-closed: symlink escape → artifact_path_escape (write + resolve)", () => {
    withTempProject((dir) => {
      const outside = mkdtempSync(path.join(tmpdir(), "ikran-artifact-outside-"));
      try {
        const outsideFile = path.join(outside, "secret.png");
        writeFileSync(outsideFile, "secret");

        mkdirSync(path.join(dir, "artifacts"), { recursive: true });
        const linkPath = path.join(dir, "artifacts", "escape.png");
        symlinkSync(outsideFile, linkPath);

        expect(assertArtifactPathInProject(dir, "artifacts/escape.png")).toBe(
          "artifact_path_escape"
        );
        expect(resolveProjectArtifactPath(dir, "artifacts/escape.png")).toBeNull();

        // Directory symlink: lexical path stays under project, realpath escapes.
        const outDir = path.join(outside, "outdir");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(path.join(outDir, "shot.png"), "x");
        symlinkSync(outDir, path.join(dir, "artifacts", "outdir-link"));
        expect(
          assertArtifactPathInProject(dir, "artifacts/outdir-link/shot.png")
        ).toBe("artifact_path_escape");
        expect(
          resolveProjectArtifactPath(dir, "artifacts/outdir-link/shot.png")
        ).toBeNull();

        const seed = registerSeedReference(dir, {
          figmaSeedReference: VALID_FIGMA,
          originalDesignIntent: "checkout trust"
        });
        expect(seed.ok).toBe(true);
        if (!seed.ok) return;

        const res = recordEvidencePackage(
          dir,
          minimalPackage({
            seedReferenceId: seed.record.id,
            figmaSeedReference: undefined,
            evidenceViews: { rawData: "available", screenshot: "available" },
            screenshot: { artifactPath: "artifacts/escape.png" }
          })
        );
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.reason).toBe("artifact_path_escape");
        expect(countSurfaces(dir)).toBe(0);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  test("assertArtifactPathInProject allows missing in-project path (declare-before-write)", () => {
    withTempProject((dir) => {
      expect(
        assertArtifactPathInProject(dir, "artifacts/future-shot.png")
      ).toBeNull();
      const resolved = resolveProjectArtifactPath(
        dir,
        "artifacts/future-shot.png"
      );
      expect(resolved).not.toBeNull();
      // Compare against realpath: macOS tmp may be /var → /private/var.
      const projectReal = realpathSync(dir);
      expect(resolved!.startsWith(projectReal + path.sep)).toBe(true);
      expect(existsSync(resolved!)).toBe(false);
    });
  });

  test("accepts in-project path that starts with '..' but is not a parent escape", () => {
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
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          evidenceViews: { rawData: "available", screenshot: "available" },
          screenshot: { artifactPath: "..hidden/shot.png" }
        })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.screenshot_artifact_path).toBe("..hidden/shot.png");
      expect(countSurfaces(dir)).toBe(1);
    });
  });

  test("fail-closed: both seed refs with mismatched canonical identity → seed_reference_mismatch", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const otherUrl =
        "https://www.figma.com/design/OtherFile/Other?node-id=9:9";
      const res = recordEvidencePackage(
        dir,
        minimalPackage({
          figmaSeedReference: otherUrl,
          seedReferenceId: seed.record.id
        })
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("seed_reference_mismatch");
      expect(countSurfaces(dir)).toBe(0);

      const invalid = listEvents(dir, "invalid_output");
      expect(invalid.length).toBe(1);
      expect(eventPayload(invalid[0])).toMatchObject({
        tool: "record_evidence_package",
        reason: "seed_reference_mismatch"
      });
    });
  });

  test("fail-closed: frame.nodeId ≠ seed node_id → frame_node_mismatch; no surface / no tip advance", () => {
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
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "9:9", name: "Wrong Node" }
        })
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("frame_node_mismatch");
      expect(countSurfaces(dir)).toBe(0);
      expect(listSeedReferences(dir)[0].current_surface_id).toBeNull();

      const invalid = listEvents(dir, "invalid_output");
      expect(invalid.length).toBe(1);
      expect(eventPayload(invalid[0])).toMatchObject({
        tool: "record_evidence_package",
        reason: "frame_node_mismatch"
      });
      expect(listEvents(dir, "evidence_package_recorded")).toEqual([]);
    });
  });

  test("accepts when frame.nodeId matches seed canonical node_id", () => {
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
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "Checkout" }
        })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.frame_node_id).toBe("1:2");
      expect(listSeedReferences(dir)[0].current_surface_id).toBe(res.record.id);
      expect(countSurfaces(dir)).toBe(1);
    });
  });

  test("accepts hyphenated frame.nodeId that normalizes to seed node_id", () => {
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
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1-2", name: "Checkout" }
        })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.frame_node_id).toBe("1-2");
    });
  });

  test("fail-closed: frame.fileKey ≠ seed file_key → frame_node_mismatch", () => {
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
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "Checkout", fileKey: "OtherFile" }
        })
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("frame_node_mismatch");
      expect(countSurfaces(dir)).toBe(0);
      expect(listSeedReferences(dir)[0].current_surface_id).toBeNull();
    });
  });

  test("event INSERT failure: surface rolls back; ok:false + db_error", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
      db.exec(`
        CREATE TRIGGER fail_event_insert
        BEFORE INSERT ON events
        BEGIN
          SELECT RAISE(ABORT, 'forced_event_insert_failure');
        END;
      `);
      db.close();

      const res = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined
        })
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("db_error");
      expect(countSurfaces(dir)).toBe(0);
      expect(listEvents(dir, "evidence_package_recorded").length).toBe(0);
      const seeds = listSeedReferences(dir);
      expect(seeds[0].current_surface_id).toBeNull();
    });
  });

  test("listFigmaEvidenceSurfaces: oldest-first append history", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "checkout trust"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const a = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "A" }
        })
      );
      const b = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "B" }
        })
      );
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;

      const listed = listFigmaEvidenceSurfaces(dir);
      expect(listed.map((r) => r.frame_name)).toEqual(["A", "B"]);
      expect(listed[0].superseded_by).toBe(b.record.id);
      expect(listed[1].superseded_by).toBeNull();
    });
  });
});
