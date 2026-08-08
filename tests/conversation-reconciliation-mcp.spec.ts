import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { expect, test } from "./fixtures";
import {
  killRecordedRuntime,
  spawnMcpClient,
  structuredContent
} from "./helpers/mcp";

test("Agent reconciles a bounded conversation before claiming Rule Update review", async () => {
  test.setTimeout(120_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-reconcile-mcp-state-"));
  const projectDir = mkdtempSync(
    path.join(tmpdir(), "ikran-reconcile-mcp-project-")
  );
  let client: Client | null = null;

  try {
    const handle = await spawnMcpClient(stateDir, { cwd: projectDir });
    client = handle.client;
    const opened = structuredContent(
      await client.callTool({
        name: "create_or_open_project",
        arguments: { path: projectDir }
      })
    );
    expect(opened.ok).toBe(true);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain(
      "reconcile_designer_conversation"
    );

    const reconciled = structuredContent(
      await client.callTool({
        name: "reconcile_designer_conversation",
        arguments: {
          reviewId: "review-mcp",
          conversationId: "conversation-mcp",
          runId: "run-mcp",
          sessionId: "session-mcp",
          startMessageId: "message-1",
          endMessageId: "message-2",
          messages: [
            {
              id: "message-1",
              role: "designer",
              content: "按钮使用紧凑尺寸。"
            },
            {
              id: "message-2",
              role: "designer",
              content: "设计完成，开始 Rule Update。"
            }
          ],
          decisions: [
            {
              summary: "按钮使用紧凑尺寸。",
              disposition: "final_decision",
              sourceMessageIds: ["message-1", "message-2"]
            }
          ]
        }
      })
    );
    expect(reconciled).toMatchObject({
      ok: true,
      replayed: false,
      reconciliation: { id: "review-mcp", message_count: 2 }
    });

    const review = structuredContent(
      await client.callTool({
        name: "claim_consolidate_review",
        arguments: { reconciliationId: "review-mcp" }
      })
    );
    expect(review).toMatchObject({
      ok: true,
      reconciliation_id: "review-mcp",
      feedback_count: 1,
      feedback: [
        {
          summary: "按钮使用紧凑尺寸。",
          reconciliation_id: "review-mcp",
          source_message_ids: ["message-1", "message-2"]
        }
      ]
    });
  } catch (error) {
    const runtimeLog = path.join(stateDir, "runtime.log");
    if (existsSync(runtimeLog)) {
      console.error(readFileSync(runtimeLog, "utf8"));
    }
    throw error;
  } finally {
    try {
      await client?.close();
    } catch {
      // Ignore cleanup failures; the assertions above are authoritative.
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
