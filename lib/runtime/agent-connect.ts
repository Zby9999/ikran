import type { AgentId } from "./agent-types";

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

  // Small async boundary so the UI can show a connecting state.
  await new Promise((resolve) => setTimeout(resolve, 120));
  return { ok: true, agent };
}
