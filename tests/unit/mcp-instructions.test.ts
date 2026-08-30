// Issue 18: MCP instructions are the always-resident channel — behavioral
// floor + routing pointers only. Flow contracts ship on demand (the Alignment
// section_contract and compact semantic context ride their claim
// payloads; per-tool semantics live on tool descriptions) and must never be
// restated here.

import { describe, expect, test } from "vitest";

import { registerIkranTools } from "../../lib/mcp/register-tools";
import { incrementalCommitFailureDetails } from "../../lib/mcp/initial-design-system-tools";
import { DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION } from "../../lib/mcp/rule-capture-tools";
import {
  CLAUDE_MCP_INSTRUCTIONS,
  CLAUDE_MCP_TEXT_BUDGET,
  conciseSuccessResult,
  failureResult,
  IKRAN_MCP_INSTRUCTIONS,
  resolveMcpInstructions,
  type RegisterIkranToolsDeps
} from "../../lib/mcp/shared";

function expectBehavioralFloor(text: string) {
  expect(text).toContain("OPEN-AND-WAIT");
  expect(text).toContain("open that URL first");
  expect(text).toContain("wait_for_agent_command");
  expect(text).toContain("record_artifact_written");
  expect(text).toContain("Never silently drop");
  expect(text).toContain("formalize unrelated claims");
  expect(text).toContain("sole Active ingestion path");
  expect(text).toContain("rule taxonomy");
  expect(text).toContain("never move silently");
  expect(text).toContain("rule-update proposal");
  expect(text).toContain("reconcile_designer_conversation");
  expect(text).toContain("design-system source only");
  expect(text).toContain("never feedback");
  expect(text).toContain("capture_rule_screenshot");
  expect(text).toContain("record_artifact_written.componentPreview");
  expect(text).toContain("resolve_component_preview_exception");
  expect(text).toContain("automatic verification");
  expect(text).not.toContain("declare_component_live_heroes");
  expect(text).not.toContain("verify_component_live_heroes");
  expect(text).toContain("never reuse existing capture files");
  expect(text).toContain("claim_alignment_preparation");
  expect(text).toContain("section_contract");
  expect(text).toContain("claim_initial_design_system_preparation");
  expect(text).toContain("commit_initial_design_system_semantics");
  expect(text).toContain("sourceRefs");
  expect(text).toContain("Do not re-claim");
  expect(text).not.toContain("extraction source_contract");
  expect(text).not.toContain("48 characters");
  expect(text).not.toContain("Layout good:");
  expect(text).not.toContain("entry_kind_file_ownership");
  expect(text).not.toContain("TYPOGRAPHY ROLE WRITING STYLE");
  expect(text).not.toContain("focus-target-set");
  expect(text).not.toContain("output_language");
  expect(text).not.toContain("2–5 word");
}

describe("MCP instructions channel split", () => {
  test("keeps the Agent Plugin resident channel as the default", () => {
    expectBehavioralFloor(IKRAN_MCP_INSTRUCTIONS);
    expect(resolveMcpInstructions({})).toBe(IKRAN_MCP_INSTRUCTIONS);
    expect(resolveMcpInstructions({ IKRAN_MCP_HOST: "cursor" })).toBe(
      IKRAN_MCP_INSTRUCTIONS
    );
  });

  test("serves the Claude 2KB variant only when IKRAN_MCP_HOST=claude", () => {
    expect(
      Buffer.byteLength(CLAUDE_MCP_INSTRUCTIONS, "utf8")
    ).toBeLessThanOrEqual(CLAUDE_MCP_TEXT_BUDGET);
    expectBehavioralFloor(CLAUDE_MCP_INSTRUCTIONS);
    expect(resolveMcpInstructions({ IKRAN_MCP_HOST: "claude" })).toBe(
      CLAUDE_MCP_INSTRUCTIONS
    );
  });

  test("advertises the incremental loop and recovery tools by default", () => {
    const instructions = resolveMcpInstructions({});
    expect(instructions).toContain("finalize_alignment_preparation enters answer monitoring directly");
    expect(instructions).toContain("record_incremental_initial_design_system_plan");
    expect(instructions).toContain("resume_initial_design_system_planning");
    expect(instructions).toContain("commit_incremental_initial_design_system_plan");
    expect(instructions).toContain("continuationRequired=true");
    expect(instructions).toContain("do not end the turn");
    expect(instructions).toContain("After Draft creation stop for visible designer review");

    const tools: Array<{
      name: string;
      spec: { description?: string; inputSchema?: unknown };
    }> = [];
    const mcp = {
      registerTool(
        name: string,
        spec: { description?: string; inputSchema?: unknown }
      ) {
        tools.push({ name, spec });
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
      discoverWorkingFolder: async () => ({ folder: null, source: "none", roots: [] }),
      host: "127.0.0.1",
      prod: false,
      mcpEntryPath: "/tmp/ikran-mcp.mjs"
    };
    registerIkranTools(mcp as never, deps);
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "read_alignment_semantic_delta",
      "record_incremental_initial_design_system_plan",
      "resume_initial_design_system_planning",
      "commit_incremental_initial_design_system_plan",
      "revise_rule_update_proposal"
    ]));
    const retryRuleUpdate = tools.find(
      (tool) => tool.name === "retry_rule_update_apply"
    );
    expect(retryRuleUpdate?.spec.description).toContain(
      "operational failure"
    );
    const reviseRuleUpdate = tools.find(
      (tool) => tool.name === "revise_rule_update_proposal"
    );
    expect(reviseRuleUpdate?.spec.description).toContain(
      "must Accept the new revision"
    );
    const confirmPrototype = tools.find(
      (tool) => tool.name === "confirm_prototype"
    );
    const confirmPrototypeSchema = confirmPrototype?.spec.inputSchema as {
      safeParse?: (input: unknown) => { success: boolean };
    };
    expect(confirmPrototypeSchema.safeParse?.({}).success).toBe(false);
    expect(
      confirmPrototypeSchema.safeParse?.({
        designerConfirmation: "I reviewed the current Prototype.",
        designerMessageId: "designer-message-1"
      }).success
    ).toBe(true);
    expect(confirmPrototype?.spec.description).toContain(
      "Never call automatically after component registration"
    );
    expect(instructions).toContain(
      "stop and return control for visible Prototype review"
    );
    expect(instructions).toContain(
      "Do not poll verify_registered_component_previews"
    );
    expect(instructions).toContain(
      "open a new task"
    );
    expect(instructions).toContain(
      "never build a temporary MCP client"
    );

    const proposeRuleUpdate = tools.find(
      (tool) => tool.name === "propose_rule_update"
    );
    const proposeRuleUpdateSchema = proposeRuleUpdate?.spec.inputSchema as {
      safeParse?: (input: unknown) => { success: boolean };
    };
    const proposalBase = {
      reason: "Evidence supports one reusable rule.",
      affectedItems: [],
      evidenceRecordIds: []
    };
    expect(proposeRuleUpdateSchema.safeParse?.({
      ...proposalBase,
      targetCategory: "layout"
    }).success).toBe(false);
    expect(proposeRuleUpdateSchema.safeParse?.({
      ...proposalBase,
      targetCategory: "foundations.layout"
    }).success).toBe(true);
    expect(proposeRuleUpdateSchema.safeParse?.({
      ...proposalBase,
      targetCategory: "component:navigation-bar"
    }).success).toBe(true);

    const dismissFeedback = tools.find(
      (tool) => tool.name === "dismiss_designer_feedback"
    );
    const dismissFeedbackSchema = dismissFeedback?.spec.inputSchema as {
      safeParse?: (input: unknown) => { success: boolean };
    };
    expect(dismissFeedbackSchema.safeParse?.({
      feedbackIds: ["feedback-1"],
      reason: "No reusable rule."
    }).success).toBe(false);
    expect(dismissFeedbackSchema.safeParse?.({
      feedbackIds: ["feedback-1"],
      disposition: "local_only",
      reason: "No reusable rule."
    }).success).toBe(true);
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

  test("preserves incremental commit repair details instead of reducing them to fallback", () => {
    expect(incrementalCommitFailureDetails({
      ok: false,
      reason: "incremental_plan_stale",
      failedStage: "projection",
      details: {
        invalidSemanticDraft: [{
          path: "tokens.semantic.0.value",
          message: "Required"
        }]
      },
      repair: { tool: "resume_initial_design_system_planning" }
    })).toEqual({
      failed_stage: "projection",
      details: {
        invalidSemanticDraft: [{
          path: "tokens.semantic.0.value",
          message: "Required"
        }]
      },
      repair: { tool: "resume_initial_design_system_planning" }
    });
  });

  test("keeps fast-path success text concise without duplicating structured data", () => {
    const result = conciseSuccessResult(
      {
        host: "127.0.0.1",
        port: 3000,
        token: "session-token",
        url: "http://127.0.0.1:3000/?session=session-token",
        spawned: false
      },
      { ok: true, sources: [{ ref: "Q01", statement: "large semantic input" }] },
      "Claimed 1 compact Alignment source."
    );
    expect(result.content[0]?.text).toBe("Claimed 1 compact Alignment source.");
    expect(result.content[0]?.text).not.toContain("large semantic input");
    expect(result.structuredContent).toMatchObject({
      ok: true,
      sources: [{ ref: "Q01" }],
      session: "session-token"
    });
  });
});

describe("Claude Code MCP text budget", () => {
  test("keeps the legacy live-hero description bounded and out of the Active path", () => {
    expect(
      Buffer.byteLength(DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION, "utf8")
    ).toBeLessThanOrEqual(CLAUDE_MCP_TEXT_BUDGET);
    expect(DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION).toContain(
      "Compatibility-only"
    );
    expect(DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION).toContain(
      "record_artifact_written.componentPreview"
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
    expect(descriptions.find(
      (tool) => tool.name === "commit_initial_design_system_semantics"
    )?.description).toContain("one scalar fontSize");
    expect(descriptions.find(
      (tool) => tool.name === "record_incremental_initial_design_system_plan"
    )?.description).toContain("one scalar fontSize");
    expect(descriptions.find(
      (tool) => tool.name === "resume_initial_design_system_planning"
    )?.description).toContain("continuationRequired=true");
    expect(descriptions.find(
      (tool) => tool.name === "record_incremental_initial_design_system_plan"
    )?.description).toContain("do not end the turn");
    expect(descriptions.find(
      (tool) => tool.name === "record_incremental_initial_design_system_plan"
    )?.description).toContain("Never resend the complete Draft");
    expect(descriptions.find(
      (tool) => tool.name === "record_incremental_initial_design_system_plan"
    )?.description).toContain("complete merged Draft/checkpoint");
    expect(descriptions.find(
      (tool) => tool.name === "record_incremental_initial_design_system_plan"
    )?.description).toContain(
      "value={alias:'primitive.<token-name>',usage:'...'}"
    );
    expect(descriptions.find(
      (tool) => tool.name === "record_incremental_initial_design_system_plan"
    )?.description).toContain(
      "inspect the registered Seed Reference through the available Figma tools"
    );
    expect(descriptions.find(
      (tool) => tool.name === "record_incremental_initial_design_system_plan"
    )?.description).toContain(
      "only when exact inspectable Color or Typography construction facts are missing"
    );
    expect(descriptions.find(
      (tool) => tool.name === "commit_initial_design_system_semantics"
    )?.description).toContain(
      "never use value='{color.<token-name>}'"
    );
  });
});
