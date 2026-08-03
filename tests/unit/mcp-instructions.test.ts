// Issue 18: MCP instructions are the always-resident channel — behavioral
// floor + routing pointers only. Flow contracts ship on demand (the Alignment
// section_contract and the extraction source_contract ride their claim
// payloads; per-tool semantics live on tool descriptions) and must never be
// restated here.

import { describe, expect, test } from "vitest";

import { IKRAN_MCP_INSTRUCTIONS } from "../../lib/mcp/shared";

describe("MCP instructions channel split", () => {
  test("stays within the resident budget", () => {
    expect(
      Buffer.byteLength(IKRAN_MCP_INSTRUCTIONS, "utf8")
    ).toBeLessThanOrEqual(2048);
  });

  test("keeps the behavioral floor and global disciplines", () => {
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("OPEN-AND-WAIT");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("wait_for_agent_command");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("record_artifact_written");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("Never silently drop");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("formalize unrelated claims");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("sole Active ingestion path");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("rule taxonomy");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("never move silently");
    expect(IKRAN_MCP_INSTRUCTIONS).toContain("rule-update proposal");
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
  });
});
