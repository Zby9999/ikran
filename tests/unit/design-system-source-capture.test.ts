import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { validateDesignSystemJson } from "../../lib/runtime/design-system-schema";
import { deriveSourceCaptures } from "../../lib/runtime/design-system-source-capture";

const projects: string[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

test("derived source captures satisfy the persisted design-system schema", () => {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-derived-capture-"));
  projects.push(projectPath);
  const artifactPath = "evidence/screenshots/home.png";
  mkdirSync(path.join(projectPath, "evidence/screenshots"), { recursive: true });
  writeFileSync(path.join(projectPath, artifactPath), "png");

  const captures = deriveSourceCaptures({
    projectPath,
    anchorJsons: [
      JSON.stringify({
        kind: "single",
        target: {
          kind: "node",
          seedReferenceId: "seed-1",
          evidenceSurfaceId: "surface-1",
          evidenceVersionId: "surface-1",
          nodeId: "10:2"
        }
      })
    ],
    loadSurface: () => ({
      id: "surface-1",
      screenshot_artifact_path: artifactPath,
      frame_bounds_json: JSON.stringify({ x: 0, y: 0, width: 1200, height: 800 }),
      positional_nodes_json: JSON.stringify([
        {
          id: "10:2",
          parentId: "1:2",
          name: "Metric",
          type: "TEXT",
          depth: 1,
          visible: true,
          bounds: { x: 300, y: 200, width: 240, height: 80 }
        }
      ]),
      created_at: "2026-08-26T00:00:00.000Z"
    }),
    staleOf: () => false
  });

  expect(captures).toHaveLength(1);
  expect(captures?.[0]).not.toHaveProperty("harnessPath");
  expect(captures?.[0]).not.toHaveProperty("codeLinks");
  expect(
    validateDesignSystemJson("layout-rules.json", {
      rules: [
        {
          id: "layout.metric",
          value: "Keep the metric prominent.",
          meaning: "Metric prominence",
          status: "candidate",
          links: ["card-1"],
          sourceCaptures: captures
        }
      ]
    })
  ).toEqual({ ok: true });
});
