import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  FocusTargetMask,
  focusTargetsForSurface
} from "../../components/workbench/focus-target-mask";
import type { FocusTarget } from "../../components/workbench/focus-mode";

const targets: FocusTarget[] = [
  {
    targetId: "same-surface-version-second",
    surfaceArtifactId: "surface-a",
    evidenceVersionId: "version-2",
    rect: { x: 0.55, y: 0.1, width: 0.15, height: 0.2 }
  },
  {
    targetId: "same-surface-version",
    surfaceArtifactId: "surface-a",
    evidenceVersionId: "version-2",
    rect: { x: 0.1, y: 0.2, width: 0.25, height: 0.15 }
  },
  {
    targetId: "historical-version",
    surfaceArtifactId: "surface-a",
    evidenceVersionId: "version-1",
    rect: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }
  },
  {
    targetId: "other-surface",
    surfaceArtifactId: "surface-b",
    evidenceVersionId: "version-2",
    rect: { x: 0.6, y: 0.7, width: 0.1, height: 0.1 }
  }
];

test("mask projection opens only targets linked to the rendered surface and evidence version", () => {
  expect(
    focusTargetsForSurface(targets, "surface-a", "version-2").map(
      (target) => target.targetId
    )
  ).toEqual(["same-surface-version-second", "same-surface-version"]);

  const markup = renderToStaticMarkup(
    createElement(FocusTargetMask, {
      phase: "active",
      surfaceArtifactId: "surface-a",
      evidenceVersionId: "version-2",
      targets
    })
  );
  expect(markup).toContain('data-focus-target-id="same-surface-version"');
  expect(markup).toContain(
    'data-focus-target-id="same-surface-version-second"'
  );
  expect(markup).not.toContain("historical-version");
  expect(markup).not.toContain("other-surface");
});

test("mask holes use a 2px screenshot-space corner radius", () => {
  const markup = renderToStaticMarkup(
    createElement(FocusTargetMask, {
      phase: "active",
      surfaceArtifactId: "surface-a",
      evidenceVersionId: "version-2",
      mediaWidth: 695,
      mediaHeight: 1851,
      targets
    })
  );

  expect(markup).toContain(`rx="${String(2 / 695)}"`);
  expect(markup).toContain(`ry="${String(2 / 1851)}"`);
});

test("a screenshot without a linked target receives no focus mask", () => {
  const markup = renderToStaticMarkup(
    createElement(FocusTargetMask, {
      phase: "active",
      surfaceArtifactId: "surface-unrelated",
      evidenceVersionId: "version-2",
      targets
    })
  );

  expect(markup).toBe("");
});
