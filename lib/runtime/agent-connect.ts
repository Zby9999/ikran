import type { AgentId } from "./agent-types";
import { spawn } from "node:child_process";
import { getAgentCliProfile } from "./agent-profiles";

const VALID_AGENTS: ReadonlySet<AgentId> = new Set(["codex", "cursor", "claude"]);

export function isAgentId(value: string): value is AgentId {
  return VALID_AGENTS.has(value as AgentId);
}

export type ConnectAgentResult =
  | { ok: true; agent: AgentId }
  | { ok: false; reason: string };

export async function connectAgent(agent: AgentId): Promise<ConnectAgentResult> {
  if (process.env.IKRAN_MOCK_AGENT_FAIL === "1") {
    return { ok: false, reason: "agent_unavailable" };
  }

  if (process.env.IKRAN_SEED_EVIDENCE_ADAPTER === "cli") {
    const profile = getAgentCliProfile(agent);
    const available = await canSpawn(profile.command);
    if (!available) {
      return { ok: false, reason: "agent_unavailable" };
    }
    return { ok: true, agent };
  }

  // Small async boundary so the UI can show a connecting state.
  await new Promise((resolve) => setTimeout(resolve, 120));
  return { ok: true, agent };
}

function canSpawn(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 5_000);

    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
