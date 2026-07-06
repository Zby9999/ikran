import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "./fixtures";
import { initializeProjectDb } from "@/lib/runtime/db";
import { recordRealAgentSeedEvidenceSmoke } from "@/lib/runtime/real-agent-smoke";

function readEvents(folder: string): Array<{ type: string; payload: Record<string, unknown> }> {
  const file = `${folder}/.ikran/events.jsonl`;
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("records real Agent seed evidence smoke result in project events", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "ikran-real-seed-smoke-"));
  try {
    initializeProjectDb(folder);
    recordRealAgentSeedEvidenceSmoke(folder, {
      status: "blocked",
      taskId: "manual-smoke-issue04-20260706",
      figmaSeedReference:
        "https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=133-129",
      originalDesignIntent:
        "A high-end editorial minimalist black-and-white portfolio system.",
      packageId: null,
      surfaceId: null,
      agentCommand: "agent -p --yolo --output-format text",
      reason: "Headless Agent CLI could not reach Figma MCP.",
      openGaps: ["Expose Figma MCP to the headless Agent environment."],
      attemptLog: ".plans/issue04/smoke-attempt-agent-yolo-20260706T140908Z.log"
    });

    const event = readEvents(folder).find(
      (entry) => entry.type === "real_agent_seed_evidence_smoke_recorded"
    );
    expect(event).toBeTruthy();
    expect(event?.payload).toMatchObject({
      status: "blocked",
      taskId: "manual-smoke-issue04-20260706",
      packageId: null,
      surfaceId: null,
      agentCommand: "agent -p --yolo --output-format text",
      reason: "Headless Agent CLI could not reach Figma MCP."
    });
    expect(event?.payload.figmaSeedReference).toContain("figma.com/design");
    expect(event?.payload.openGaps).toEqual([
      "Expose Figma MCP to the headless Agent environment."
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
