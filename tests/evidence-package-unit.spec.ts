// Unit tests for evidence package schema validation (Issue 05 Task 1).
// Pure Node — no MCP/Next/DB. Schema only; Runtime never contacts Figma.

import { test, expect } from "@playwright/test";
import { validateEvidencePackage } from "../lib/runtime/evidence-package";

const VALID_FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";

function minimalPackage(overrides: Record<string, unknown> = {}) {
  return {
    figmaSeedReference: VALID_FIGMA,
    frame: { nodeId: "1:2", name: "Checkout" },
    evidenceViews: { rawData: "available", screenshot: "missing" },
    ...overrides
  };
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
