// Task 12: annotation create handler is per tool-class / editor instance —
// never a module-global singleton.

import { test, expect } from "vitest";
import * as toolMod from "../../components/workbench/region-annotation-tool";
import type { RegionAnnotationCreatePayload } from "../../components/workbench/region-annotation-tool";

const PAYLOAD_A: RegionAnnotationCreatePayload = {
  surfaceArtifactId: "surf-a",
  rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
};

const PAYLOAD_B: RegionAnnotationCreatePayload = {
  surfaceArtifactId: "surf-b",
  rect: { x: 0.3, y: 0.3, w: 0.1, h: 0.1 }
};

test.describe("region annotation tool handler isolation", () => {
  test("setRegionAnnotationCreateHandler is not exported (no module global)", () => {
    expect("setRegionAnnotationCreateHandler" in toolMod).toBe(false);
    expect("createRegionAnnotationToolClass" in toolMod).toBe(true);
  });

  test("two factory classes keep independent handlers", () => {
    const createRegionAnnotationToolClass = toolMod.createRegionAnnotationToolClass;
    expect(createRegionAnnotationToolClass).toBeTypeOf("function");

    const callsA: RegionAnnotationCreatePayload[] = [];
    const callsB: RegionAnnotationCreatePayload[] = [];
    let handlerA: ((p: RegionAnnotationCreatePayload) => void) | null = (p) => {
      callsA.push(p);
    };
    let handlerB: ((p: RegionAnnotationCreatePayload) => void) | null = (p) => {
      callsB.push(p);
    };

    const ToolA = createRegionAnnotationToolClass(() => handlerA, () => null);
    const ToolB = createRegionAnnotationToolClass(() => handlerB, () => null);

    expect(ToolA).not.toBe(ToolB);

    const instanceA = Object.create(ToolA.prototype) as {
      commitCreate: (p: RegionAnnotationCreatePayload) => void;
    };
    const instanceB = Object.create(ToolB.prototype) as {
      commitCreate: (p: RegionAnnotationCreatePayload) => void;
    };

    instanceA.commitCreate(PAYLOAD_A);
    instanceB.commitCreate(PAYLOAD_B);

    expect(callsA).toEqual([PAYLOAD_A]);
    expect(callsB).toEqual([PAYLOAD_B]);

    // Clearing one registry must not affect the other.
    handlerA = null;
    instanceA.commitCreate(PAYLOAD_A);
    instanceB.commitCreate(PAYLOAD_B);
    expect(callsA).toEqual([PAYLOAD_A]);
    expect(callsB).toEqual([PAYLOAD_B, PAYLOAD_B]);
  });
});
