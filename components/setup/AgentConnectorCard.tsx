"use client";

import { CheckIcon as PhosphorCheckIcon } from "@phosphor-icons/react";
import { RobotIcon as PhosphorRobotIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { AgentId } from "../../lib/runtime/agent-types";
import { AgentIcon } from "./AgentIcon";
import { activeIconGradients } from "./IconGradients";
import { IconBox } from "./IconBox";
import { useSquircle } from "./useSquircle";

export type { AgentId };

export type AgentConnectionState =
  | { status: "idle" }
  | { status: "connecting"; agent: AgentId }
  | { status: "connected"; agent: AgentId }
  | { status: "error"; agent: AgentId; message: string };

const AGENT_LABELS: Record<AgentId, string> = {
  codex: "Codex",
  cursor: "Cursor",
  claude: "Claude"
};

export function AgentConnectorCard({
  active = false,
  connection,
  onSelectAgent
}: {
  active?: boolean;
  connection: AgentConnectionState;
  onSelectAgent?: (agent: AgentId) => void;
}) {
  const rowRef = useSquircle<HTMLDivElement>(16);
  const selectedAgent =
    connection.status === "connected" ? connection.agent : null;
  const headerTone = active && !selectedAgent ? "purple" : "gray";
  const connectingAgent =
    connection.status === "connecting" ? connection.agent : null;

  return (
    <div className="step" aria-disabled={active ? undefined : "true"}>
      <div className="step-row agent-row" ref={rowRef}>
        <div className="step-head">
          <IconBox tone={headerTone}>
            <PhosphorRobotIcon
              color={headerTone === "purple" ? activeIconGradients.robot : "white"}
              size={14}
              weight="fill"
            />
          </IconBox>
          <div className="step-fill">
            <p className="step-label">Connect Your Agent</p>
            <span
              className={`number ${active && !selectedAgent ? "number--purple" : ""}`}
            >
              3
            </span>
          </div>
        </div>
        <div className="agent-options" aria-label="Agent choices">
          <AgentChoice
            active={active}
            agent="codex"
            iconSrc="/icons/codex.svg"
            iconClassName="agent-icon--codex"
            selected={selectedAgent === "codex"}
            connecting={connectingAgent === "codex"}
            disabled={Boolean(connectingAgent && connectingAgent !== "codex")}
            onSelect={onSelectAgent}
          >
            Codex
          </AgentChoice>
          <AgentChoice
            active={active}
            agent="cursor"
            iconSrc="/icons/cursor.svg"
            selected={selectedAgent === "cursor"}
            connecting={connectingAgent === "cursor"}
            disabled={Boolean(connectingAgent && connectingAgent !== "cursor")}
            onSelect={onSelectAgent}
          >
            Cursor
          </AgentChoice>
          <AgentChoice
            active={active}
            agent="claude"
            iconSrc="/icons/claude.svg"
            selected={selectedAgent === "claude"}
            connecting={connectingAgent === "claude"}
            disabled={Boolean(connectingAgent && connectingAgent !== "claude")}
            onSelect={onSelectAgent}
          >
            Claude Code
          </AgentChoice>
        </div>
      </div>
      <p
        className={`helper ${
          connection.status === "connected"
            ? "success"
            : connection.status === "error"
              ? "error"
              : ""
        }`}
        data-testid="agent-helper"
      >
        {renderAgentHelper(connection)}
      </p>
    </div>
  );
}

function renderAgentHelper(connection: AgentConnectionState) {
  if (connection.status === "connected") {
    return `${AGENT_LABELS[connection.agent]} connected`;
  }

  if (connection.status === "connecting") {
    return `Connecting to ${AGENT_LABELS[connection.agent]}...`;
  }

  if (connection.status === "error") {
    return connection.message;
  }

  return (
    <>
      Bring your <strong>agent</strong> in and let them do their work
    </>
  );
}

function AgentChoice({
  active,
  agent,
  children,
  iconSrc,
  iconClassName = "",
  selected = false,
  connecting = false,
  disabled = false,
  onSelect
}: {
  active: boolean;
  agent: AgentId;
  children: ReactNode;
  iconSrc: string;
  iconClassName?: string;
  selected?: boolean;
  connecting?: boolean;
  disabled?: boolean;
  onSelect?: (agent: AgentId) => void;
}) {
  return (
    <button
      className={`agent-option ${active ? "agent-option--active" : ""} ${selected ? "agent-option--connected" : ""}`}
      aria-busy={connecting || undefined}
      aria-label={typeof children === "string" ? children : agent}
      aria-pressed={selected || undefined}
      disabled={!active || disabled}
      onClick={() => onSelect?.(agent)}
      type="button"
    >
      <AgentIcon src={iconSrc} className={iconClassName} />
      {!selected ? <span>{children}</span> : null}
      {selected ? (
        <span className="agent-option-check" aria-hidden="true">
          <PhosphorCheckIcon size={8} weight="bold" />
        </span>
      ) : null}
    </button>
  );
}
