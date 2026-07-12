import { test, expect } from "vitest";
import { DEFAULT_EMBED_DEFINITIONS } from "tldraw";
import {
  extractFigmaDesignUrl,
  isFigmaDesignUrl,
  isFigmaEmbedUrl,
  isMalformedFigmaPaste,
  WORKBENCH_EMBED_DEFINITIONS
} from "../../components/workbench/workbench-embeds";
import {
  buildInFlightSeedProjectionTargets,
  buildSeedProjectionTargets
} from "../../components/workbench/projection/seed-projection";
import type { SeedReferenceRecord } from "../../lib/runtime/seed-reference";

test.describe("workbench embeds — no Figma iframe on paste", () => {
  test("WORKBENCH_EMBED_DEFINITIONS excludes figma", () => {
    expect(
      WORKBENCH_EMBED_DEFINITIONS.some((d) => d.type === "figma")
    ).toBe(false);
    expect(
      DEFAULT_EMBED_DEFINITIONS.some((d) => d.type === "figma")
    ).toBe(true);
    const types = new Set(WORKBENCH_EMBED_DEFINITIONS.map((d) => d.type));
    for (const def of DEFAULT_EMBED_DEFINITIONS) {
      if (def.type === "figma") continue;
      expect(types.has(def.type)).toBe(true);
    }
  });

  test("extract / isFigmaDesignUrl covers design + file only", () => {
    const design =
      "https://www.figma.com/design/AbCd/File?node-id=1-2";
    const file = "https://www.figma.com/file/AbCd/File?node-id=1-2";
    const proto = "https://www.figma.com/proto/AbCd/File?node-id=1-2";
    expect(isFigmaDesignUrl(design)).toBe(true);
    expect(extractFigmaDesignUrl(`paste ${design} here`)).toBe(design);
    expect(extractFigmaDesignUrl(file)).toBe(file);
    expect(isFigmaDesignUrl(proto)).toBe(false);
    expect(isFigmaDesignUrl("https://example.com")).toBe(false);
    expect(extractFigmaDesignUrl("no link")).toBeNull();
  });

  test("isMalformedFigmaPaste flags figma.com without design/file path", () => {
    expect(isMalformedFigmaPaste("https://www.figma.com/proto/AbCd/File")).toBe(
      true
    );
    expect(isMalformedFigmaPaste("see figma.com docs")).toBe(true);
    expect(
      isMalformedFigmaPaste(
        "https://www.figma.com/design/AbCd/File?node-id=1-2"
      )
    ).toBe(false);
    expect(isMalformedFigmaPaste("hello world")).toBe(false);
  });

  test("isFigmaEmbedUrl matches embed player URLs", () => {
    expect(
      isFigmaEmbedUrl(
        "https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fwww.figma.com%2Fdesign%2Fx"
      )
    ).toBe(true);
    expect(isFigmaEmbedUrl("https://codesandbox.io/embed/xyz")).toBe(false);
  });
});

test.describe("in-flight paste capture projection", () => {
  test("buildInFlightSeedProjectionTargets is awaiting spinner frame", () => {
    const [t] = buildInFlightSeedProjectionTargets([
      {
        id: "p1",
        figmaSeedReference:
          "https://www.figma.com/design/AbCd/File?node-id=1-2"
      }
    ]);
    expect(t.shapeKey).toBe("inflight-capture:p1");
    expect(t.awaitingEvidence).toBe(true);
    expect(t.awaitingUx).toBe("spinner");
    expect(t.frameName).toBe("Capturing…");
    expect(t.screenshotDataUrl).toBe("");
  });

  test("in-flight + real targets can coexist briefly without colliding keys", () => {
    const pending = buildInFlightSeedProjectionTargets([
      {
        id: "p1",
        figmaSeedReference:
          "https://www.figma.com/design/AbCd/File?node-id=1-2"
      }
    ]);
    const seed: SeedReferenceRecord = {
      id: "seed-1",
      figma_seed_reference:
        "https://www.figma.com/design/AbCd/File?node-id=1-2",
      original_design_intent: "",
      registered_via: "ui",
      created_at: "2026-01-01T00:00:00.000Z",
      file_key: "AbCd",
      node_id: "1:2",
      current_surface_id: null
    };
    const real = buildSeedProjectionTargets([seed], [], "sess");
    const keys = [...pending, ...real].map((t) => t.shapeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
