// Task 12 architecture guard: Canvas projection boundaries + no module-global
// annotation create handler.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const WORKBENCH = path.join(ROOT, "components/workbench");
const CANVAS = path.join(WORKBENCH, "workbench-canvas.tsx");
const TOOL = path.join(WORKBENCH, "region-annotation-tool.tsx");
const PROJECTION = path.join(WORKBENCH, "projection");

const REQUIRED_PROJECTION_FILES = [
  "seed-projection.ts",
  "seed-projection-reflow.ts",
  "annotation-projection.ts",
  "seed-projection-sync.tsx",
  "region-annotation-projection-sync.tsx"
] as const;

test.describe("architecture — workbench canvas projection split (Task 12)", () => {
  test("projection modules exist", () => {
    for (const name of REQUIRED_PROJECTION_FILES) {
      expect(
        existsSync(path.join(PROJECTION, name)),
        `missing components/workbench/projection/${name}`
      ).toBe(true);
    }
  });

  test("workbench-canvas.tsx is a thin Tldraw shell (no inline sync/reconcile)", () => {
    const text = readFileSync(CANVAS, "utf8");
    expect(text).not.toMatch(/\bfunction\s+buildProjectionTargets\b/);
    expect(text).not.toMatch(/\bfunction\s+SeedProjectionSync\b/);
    expect(text).not.toMatch(/\bfunction\s+RegionAnnotationProjectionSync\b/);
    expect(text).not.toMatch(/\bfunction\s+syncRegionAnnotationShapes\b/);
    expect(text).not.toMatch(/\bfunction\s+surfaceShapeForAnnotation\b/);
    expect(text).not.toMatch(/\bfunction\s+propsEqual\b/);
    expect(text).not.toMatch(/\bfunction\s+metaEqual\b/);
    expect(text).not.toMatch(/\bfunction\s+annotationMetaEqual\b/);
    // Controllers come from projection modules.
    expect(text).toMatch(/SeedProjectionSync/);
    expect(text).toMatch(/RegionAnnotationProjectionSync/);
    expect(text).toMatch(/from\s+["']\.\/projection\//);
  });

  test("region-annotation-tool has no module-global create handler", () => {
    const text = readFileSync(TOOL, "utf8");
    expect(text).not.toMatch(/\blet\s+createHandler\b/);
    expect(text).not.toMatch(/\bsetRegionAnnotationCreateHandler\b/);
    expect(text).toMatch(/\bcreateRegionAnnotationToolClass\b/);
  });

  test("annotation projection sync filters store listener by seed parent and marker geometry drift", () => {
    const syncPath = path.join(
      PROJECTION,
      "region-annotation-projection-sync.tsx"
    );
    const text = readFileSync(syncPath, "utf8");
    expect(text).toMatch(/shouldResyncAnnotationsForStoreChanges/);
    // Must not blindly resync on every document change callback body.
    expect(text).toMatch(/store\.listen/);
  });

  test("annotation projection deletes use mergeRemoteChanges to bypass user Agent guard", () => {
    const syncPath = path.join(
      PROJECTION,
      "region-annotation-projection-sync.tsx"
    );
    const deletePath = path.join(WORKBENCH, "region-annotation-delete.tsx");
    const guardPath = path.join(WORKBENCH, "region-annotation-delete-guard.ts");
    const sync = readFileSync(syncPath, "utf8");
    const del = readFileSync(deletePath, "utf8");
    const guard = readFileSync(guardPath, "utf8");

    expect(sync).toMatch(/mergeRemoteChanges/);
    expect(del).toMatch(/allowRegionAnnotationDelete/);
    expect(del).toMatch(/source/);
    expect(guard).toMatch(/source\s*!==\s*["']user["']/);
  });

  test("alignment projection stays mounted with empty authoritative records", () => {
    const text = readFileSync(CANVAS, "utf8");

    // An abandoned attempt makes alignment null without remounting Tldraw.
    // The sync controller must receive [] so it can delete the old attempt's
    // projected cards, targets, and connectors from the existing store.
    expect(text).toMatch(/questions=\{alignment\?\.question_cards\s*\?\?\s*\[\]\}/);
    expect(text).toMatch(/annotations=\{alignment\?\.annotations\s*\?\?\s*\[\]\}/);
    expect(text).not.toMatch(/\{alignment\s*\?\s*\(\s*<AlignmentProjectionSync/);
  });
});
