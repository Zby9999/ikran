// Issue 18: MCP instructions are the always-resident channel — behavioral
// floor + routing pointers only. Flow contracts ship on demand (the Alignment
// section_contract and the extraction source_contract ride their claim
// payloads; per-tool semantics live on tool descriptions) and must never be
// restated here.

import { describe, expect, test } from "vitest";

import { registerIkranTools } from "../../lib/mcp/register-tools";
import { DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION } from "../../lib/mcp/rule-capture-tools";
import {
  CLAUDE_MCP_TEXT_BUDGET,
  failureResult,
  IKRAN_MCP_INSTRUCTIONS,
  type RegisterIkranToolsDeps
} from "../../lib/mcp/shared";

describe("MCP instructions channel split", () => {
  test("stays within the resident budget", () => {
    expect(
      Buffer.byteLength(IKRAN_MCP_INSTRUCTIONS, "utf8")
    ).toBeLessThanOrEqual(CLAUDE_MCP_TEXT_BUDGET);
  });

  test("keeps the behavioral floor and global disciplines", () => {
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("OPEN-AND-WAIT");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("open that URL first");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("wait_for_agent_command");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("record_artifact_written");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("Never silently drop");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("formalize unrelated claims");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("sole Active ingestion path");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("rule taxonomy");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("never move silently");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("rule-update proposal");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain(
      "reconcile_designer_conversation"
    );
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("design-system source only");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("never feedback");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("capture_rule_screenshot");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain(
      "declare_component_live_heroes"
    );
    expect(IKRAN_MCP_INSTRUCTIONS).toContain(
      "verify_component_live_heroes"
    );
    expect(IKRAN_MCP_INSTRUCTIONS).toContain(
      "never reuse existing capture files"
    );
  });

  test("points at on-demand contracts instead of restating them", () => {
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("claim_alignment_preparation");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("section_contract");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain(
      "claim_initial_design_system_preparation"
    );
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("source_contract");

    // Contract content markers must not leak back into the resident channel.
    expect(IKRAN_MCP_INSTRUCTIONS).not.toContain("48 characters");
    expect(IKRAN_MCP_INSTRUCTIONS).not.toContain("Layout good:");
    expect(IKRAN_MCP_INSTRUCTIONS).not.toContain("entry_kind_file_ownership");
    expect(IKRAN_MCP_INSTRUCTIONS).not.toContain(
      "TYPOGRAPHY ROLE WRITING STYLE"
    );
    expect(IKRAN_MCP_INSTRUCTIONS).not.toContain("focus-target-set");
    expect(IKRAN_MCP_INSTRUCTIONS).not.toContain("output_language");
    expect(IKRAN_MCP_INSTRUCTIONS).not.toContain("2–5 word");
  });

  test("serializes structured details into the model-visible failure text", () => {
    const details = {
      entries: [{ entry_id: "visual-language" }],
      blockers: [
        {
          reason: "entry_claim_lineage_mismatch",
          details: { entries: [{ entry_id: "visual-language" }] }
        },
        {
          reason: "component_spec_fields_missing",
          details: { specs: [{ entry_id: "component-example-spec" }] }
        }
      ]
    };
    const result = failureResult(
      "finalize_initial_design_system_preparation",
      "entry_claim_lineage_mismatch",
      undefined,
      details
    );
    expect(result.content[0]?.text).toBe(
      `finalize_initial_design_system_preparation failed: entry_claim_lineage_mismatch\n${JSON.stringify(details)}`
    );
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: "entry_claim_lineage_mismatch",
      details
    });
  });

  test("keeps reason-only failures as a single line", () => {
    const result = failureResult("wait_for_agent_command", "state_unavailable");
    expect(result.content[0]?.text).toBe(
      "wait_for_agent_command failed: state_unavailable"
    );
  });
});

describe("Claude Code MCP text budget", () => {
  test("keeps the live-hero declaration description inside the truncation limit", () => {
    expect(
      Buffer.byteLength(DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION, "utf8")
    ).toBeLessThanOrEqual(CLAUDE_MCP_TEXT_BUDGET);
    expect(DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION).toContain(
      "live_hero_contract"
    );
    expect(DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION).toContain(
      "metadata-only"
    );
    expect(DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION).toContain(
      "verify_component_live_heroes"
    );
    expect(DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION).not.toContain(
      "data-ikran-component-root"
    );
  });

  test("keeps every registered tool description inside the truncation limit", () => {
    const descriptions: Array<{ name: string; description: string }> = [];
    const mcp = {
      registerTool(
        name: string,
        spec: { description?: string }
      ) {
        descriptions.push({ name, description: spec.description ?? "" });
      }
    };
    const deps: RegisterIkranToolsDeps = {
      ensureRuntime: async () => ({
        host: "127.0.0.1",
        port: 1,
        token: "test",
        url: "http://127.0.0.1:1/?session=test&view=workbench",
        spawned: false
      }),
      discoverWorkingFolder: async () => ({
        folder: null,
        source: "none",
        roots: []
      }),
      host: "127.0.0.1",
      prod: true,
      mcpEntryPath: "/tmp/ikran-mcp.mjs"
    };
    registerIkranTools(mcp as never, deps);
    expect(descriptions.length).toBeGreaterThan(0);
    for (const tool of descriptions) {
      expect(
        Buffer.byteLength(tool.description, "utf8"),
        tool.name
      ).toBeLessThanOrEqual(CLAUDE_MCP_TEXT_BUDGET);
    }
  });
});
