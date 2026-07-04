const MESSAGES: Record<string, string> = {
  agent_unavailable:
    "This agent is not available right now. Check that it is installed and try again.",
  agent_requires_project: "Select a project folder before connecting an agent.",
  project_mismatch: "This project changed before the agent could connect.",
  missing_project_path: "Select a project folder before connecting an agent.",
  invalid_agent: "That agent is not supported.",
  invalid_json: "Something went wrong. Try again.",
  connection_failed: "Could not connect to this agent. Try again."
};

export function agentErrorMessage(code: string | undefined): string {
  if (!code) {
    return MESSAGES.connection_failed;
  }
  return MESSAGES[code] ?? MESSAGES.connection_failed;
}
