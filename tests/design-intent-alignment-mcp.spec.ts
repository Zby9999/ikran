import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, test } from "./fixtures";
import { killRecordedRuntime, sc, spawnMcpClient } from "./helpers/mcp";
import { registerSeedReference } from "../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../lib/runtime/evidence-package";
import { setDesignLanguageDescription } from "../lib/runtime/project-readiness";

test("Issue 07 semantic MCP surface is discoverable", async () => {
  test.setTimeout(60_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-alignment-mcp-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-alignment-project-"));
  let client: Client | null = null;
  try {
    const handle = await spawnMcpClient(stateDir);
    client = handle.client;
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "create_alignment_question_card",
        "create_agent_annotation",
        "append_agent_annotation_information",
        "record_designer_answer",
        "complete_design_intent_alignment",
        "read_design_intent_alignment"
      ])
    );

    const opened = sc(await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    }));
    expect(opened.ok).toBe(true);
    const token = String(opened.session);
    const workbenchUrl = String(opened.workbench_url);

    expect(
      setDesignLanguageDescription(projectDir, "A calm, precise product language").ok
    ).toBe(true);
    const seed = registerSeedReference(projectDir, {
      figmaSeedReference: "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2",
      originalDesignIntent: "Alignment MCP fixture"
    });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const evidence = recordEvidencePackage(projectDir, {
      seedReferenceId: seed.record.id,
      frame: { nodeId: "1:2", name: "Checkout" },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;

    const created = sc(await client.callTool({
      name: "create_alignment_question_card",
      arguments: {
        section: "token",
        observation: "Accent usage is sparse",
        question: "Reserve accent for primary actions?",
        proposedAnswer: "Yes",
        anchor: {
          kind: "single",
          target: {
            kind: "surface",
            seedReferenceId: seed.record.id,
            evidenceSurfaceId: evidence.record.id,
            evidenceVersionId: evidence.record.id
          }
        }
      }
    }));
    expect(created.ok).toBe(true);
    const cardId = String((created.record as { id: string }).id);

    const answeredResponse = await fetch(
      new URL("/api/design-intent-alignment", workbenchUrl),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ikran-session": token
        },
        body: JSON.stringify({
          action: "record-designer-answer",
          input: { questionCardId: cardId, finalAnswer: "同意" }
        })
      }
    );
    expect(answeredResponse.status).toBe(200);

    const read = sc(await client.callTool({
      name: "read_design_intent_alignment",
      arguments: {}
    }));
    const card = (read.question_cards as Array<Record<string, unknown>>)
      .find((candidate) => candidate.id === cardId);
    expect(card).toMatchObject({
      final_answer: "同意",
      answer_source: "designer-edited",
      status: "answered"
    });
  } finally {
    try {
      await client?.close();
    } catch {
      // ignore cleanup failure
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
