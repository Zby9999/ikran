// Task 10: HTTP and MCP share the command kernel — invalid payloads must
// surface the SAME domain reason. Shared Zod transport schemas must accept
// those payloads so the MCP SDK does not reject before domain validation.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { initializeProjectDb } from "../../lib/runtime/db";
import {
  parseCommandInput,
  registerSeedReferenceInputSchema,
  registerSeedReferenceInputShape,
  recordEvidencePackageInputSchema,
  createRegionAnnotationInputSchema
} from "../../lib/runtime/commands/schemas";
import {
  registerSeedReferenceCommand,
  recordEvidencePackageCommand,
  createRegionAnnotationCommand
} from "../../lib/runtime/commands";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function freshProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-cmd-parity-"));
  tmpDirs.push(dir);
  initializeProjectDb(dir);
  return dir;
}

describe("HTTP/MCP command parity — shared domain reasons", () => {
  test("shared parser rejects structural errors as invalid_params", () => {
    const parsed = parseCommandInput(registerSeedReferenceInputSchema, {
      figmaSeedReference: 42,
      originalDesignIntent: "intent"
    });
    expect(parsed).toMatchObject({ ok: false, reason: "invalid_params" });
  });

  test("Agent seed schema does not expose registeredVia", () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        registerSeedReferenceInputShape,
        "registeredVia"
      )
    ).toBe(false);
  });

  test("seed: transport schema accepts domain-invalid payloads; command reason matches", () => {
    const projectPath = freshProject();
    const schema = registerSeedReferenceInputSchema;

    const cases: Array<{ payload: Record<string, unknown>; reason: string }> = [
      {
        payload: { figmaSeedReference: "", originalDesignIntent: "intent" },
        reason: "missing_figma_seed_reference"
      },
      {
        payload: {
          figmaSeedReference: "https://www.figma.com/design/abc/X",
          originalDesignIntent: ""
        },
        reason: "missing_original_design_intent"
      },
      {
        payload: {
          figmaSeedReference: "http://www.figma.com/design/abc/X",
          originalDesignIntent: "intent"
        },
        reason: "invalid_figma_url"
      },
      {
        payload: {
          figmaSeedReference: "https://example.com/design/abc/X",
          originalDesignIntent: "intent"
        },
        reason: "not_figma_host"
      },
      {
        payload: {
          figmaSeedReference: "https://www.figma.com/other/abc/X",
          originalDesignIntent: "intent"
        },
        reason: "not_figma_design_path"
      }
    ];

    for (const c of cases) {
      expect(schema.safeParse(c.payload).success, c.reason).toBe(true);
      const result = registerSeedReferenceCommand(projectPath, c.payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(c.reason);
    }
  });

  test("evidence: transport schema accepts domain-invalid payloads; command reason matches", () => {
    const projectPath = freshProject();
    const schema = recordEvidencePackageInputSchema;

    const base = {
      figmaSeedReference:
        "https://www.figma.com/design/abc123/Parity?node-id=1:2",
      frame: { nodeId: "1:2", name: "Frame" },
      evidenceViews: { rawData: "missing", screenshot: "available" }
    };

    const cases: Array<{ payload: Record<string, unknown>; reason: string }> = [
      {
        payload: {
          frame: base.frame,
          evidenceViews: base.evidenceViews
        },
        reason: "missing_seed_reference"
      },
      {
        payload: {
          ...base,
          figmaSeedReference: "https://example.com/design/abc/X"
        },
        reason: "not_figma_host"
      },
      {
        payload: {
          ...base,
          evidenceViews: { rawData: "nope", screenshot: "available" }
        },
        reason: "invalid_evidence_views"
      },
      {
        payload: {
          ...base,
          screenshot: undefined
        },
        reason: "screenshot_required_when_available"
      }
    ];

    for (const c of cases) {
      expect(schema.safeParse(c.payload).success, c.reason).toBe(true);
      const result = recordEvidencePackageCommand(projectPath, c.payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(c.reason);
    }
  });

  test("region: transport schema accepts domain-invalid payloads; command reason matches", () => {
    const projectPath = freshProject();
    const schema = createRegionAnnotationInputSchema;

    const cases: Array<{ payload: Record<string, unknown>; reason: string }> = [
      {
        payload: {
          author: "agent",
          body: "x",
          rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
        },
        reason: "missing_surface_anchor"
      },
      {
        payload: {
          surfaceArtifactId: "surf-1",
          body: "x",
          rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
        },
        reason: "missing_author"
      },
      {
        payload: {
          surfaceArtifactId: "surf-1",
          author: "robot",
          body: "x",
          rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
        },
        reason: "invalid_author"
      },
      {
        payload: {
          surfaceArtifactId: "surf-1",
          author: "agent",
          body: "x"
        },
        reason: "missing_rect"
      }
    ];

    for (const c of cases) {
      expect(schema.safeParse(c.payload).success, c.reason).toBe(true);
      const result = createRegionAnnotationCommand(projectPath, c.payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(c.reason);
    }
  });
});

describe("MCP direct command — no loopback fetch", () => {
  test("registerSeedReferenceCommand succeeds with fetch disabled; list sees record", async () => {
    const projectPath = freshProject();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async (..._args: unknown[]) => {
      fetchCalls += 1;
      throw new Error("loopback fetch must not be used by command kernel");
    }) as typeof fetch;

    try {
      const result = registerSeedReferenceCommand(projectPath, {
        figmaSeedReference:
          "https://www.figma.com/design/parityKey001/NoLoop?node-id=3:4",
        originalDesignIntent: "parity no-loopback",
        registeredVia: "agent"
      });
      expect(result.ok).toBe(true);
      expect(fetchCalls).toBe(0);

      const { listSeedReferencesCommand } = await import(
        "../../lib/runtime/commands"
      );
      const listed = listSeedReferencesCommand(projectPath);
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.records.length).toBe(1);
        expect(listed.records[0].figma_seed_reference).toContain("parityKey001");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
