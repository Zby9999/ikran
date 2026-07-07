import type { AgentId } from "./agent-types";

export interface AgentCliProfile {
  agent: AgentId;
  command: string;
  args: string[];
}

const DEFAULT_PROFILES: Record<AgentId, { command: string; args: string[] }> = {
  codex: {
    command: "codex",
    args: [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--color",
      "never"
    ]
  },
  cursor: {
    command: "agent",
    args: [
      "-p",
      "--yolo",
      "--trust",
      "--approve-mcps",
      "--output-format",
      "text"
    ]
  },
  claude: {
    command: "claude",
    args: [
      "-p",
      "--output-format",
      "text",
      "--dangerously-skip-permissions"
    ]
  }
};

export function getAgentCliProfile(agent: AgentId): AgentCliProfile {
  const prefix = agent.toUpperCase();
  const defaults = DEFAULT_PROFILES[agent];
  return {
    agent,
    command: process.env[`IKRAN_${prefix}_AGENT_COMMAND`] || defaults.command,
    args: parseArgs(process.env[`IKRAN_${prefix}_AGENT_ARGS`], defaults.args)
  };
}

function parseArgs(raw: string | undefined, fallback: string[]): string[] {
  if (!raw || !raw.trim()) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
    return String(parsed).split(/\s+/).filter(Boolean);
  } catch {
    return raw.split(/\s+/).filter(Boolean);
  }
}
