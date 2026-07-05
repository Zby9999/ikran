"use client";

// Project setup card — the designer's existing (Figma-owned) web design.
//
// Data flows through the same-origin Ikran Runtime (`/api/health`,
// `/api/events`, `/api/project`, `/api/agent/connect`). Do not alter layout,
// copy, icons, or styling here without a Figma source.

import {
  DownloadIcon as PhosphorDownloadIcon
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { agentErrorMessage } from "../../lib/runtime/agent-error-message";
import type { AgentId } from "../../lib/runtime/agent-types";
import { folderErrorMessage } from "../../lib/runtime/folder-error-message";
import {
  type AgentConnectionState,
  AgentConnectorCard
} from "./AgentConnectorCard";
import { FolderSelectStep, type FolderSelectVariant } from "./FolderSelectStep";
import { activeIconGradients, IconGradients } from "./IconGradients";
import { CompleteCheckIcon, IconBox } from "./IconBox";
import { SetupActionButton } from "./SetupActionButton";
import { SetupStepButton } from "./SetupStepButton";

type Bootstrap = { session: string; service: string };

type RuntimeState = "loading" | "connected" | "disconnected";

type HealthResponse = {
  ok: boolean;
  status: string;
  service: string;
  timestamp: string;
};

type HeartbeatEvent = {
  type: "heartbeat";
  service: string;
  status: string;
  sequence: number;
  timestamp: string;
};

type ProjectState =
  | { status: "idle" }
  | { status: "selecting" }
  | { status: "binding"; path: string }
  | { status: "bound"; path: string; name: string }
  | { status: "error"; message: string };

type BoundProjectResponse = {
  path: string;
  name: string;
};

export function ProjectSetupCard({
  bootstrap
}: {
  bootstrap: Bootstrap;
}) {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("loading");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [eventsGeneration, setEventsGeneration] = useState(0);
  // Heartbeat events keep the SSE connection alive; not shown in UI (Issue 01).
  const [, setHeartbeat] = useState<HeartbeatEvent | null>(null);
  const [project, setProject] = useState<ProjectState>({ status: "idle" });
  const [agentConnection, setAgentConnection] = useState<AgentConnectionState>({
    status: "idle"
  });
  const agentConnectionRef = useRef(agentConnection);
  agentConnectionRef.current = agentConnection;
  const [cwdManualCandidate, setCwdManualCandidate] = useState<string | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  function isStillBoundTo(boundPath: string): boolean {
    const current = projectRef.current;
    return current.status === "bound" && current.path === boundPath;
  }

  const checkHealth = useCallback(async () => {
    setRuntimeState("loading");
    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
        headers: { "x-ikran-session": bootstrap.session }
      });
      if (!response.ok) {
        throw new Error(`Runtime health failed: ${response.status}`);
      }
      const data = (await response.json()) as HealthResponse;
      setHealth(data);
      setRuntimeState(data.ok ? "connected" : "disconnected");
    } catch {
      setHealth(null);
      setRuntimeState("disconnected");
    }
  }, [bootstrap.session]);

  const reconnectRuntime = useCallback(() => {
    void checkHealth();
    setEventsGeneration((generation) => generation + 1);
  }, [checkHealth]);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  useEffect(() => {
    const events = new EventSource(
      `/api/events?session=${encodeURIComponent(bootstrap.session)}`
    );

    events.addEventListener("heartbeat", (message) => {
      setHeartbeat(JSON.parse((message as MessageEvent).data));
      setRuntimeState("connected");
    });

    events.onerror = () => {
      setRuntimeState("disconnected");
    };

    return () => events.close();
  }, [bootstrap.session, eventsGeneration]);

  const bindFolder = useCallback(
    async (folderPath: string) => {
      const previousAgent = agentConnectionRef.current;
      setProject({ status: "binding", path: folderPath });
      try {
        const response = await fetch("/api/project/bind", {
          method: "POST",
          headers: {
            "x-ikran-session": bootstrap.session,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ path: folderPath })
        });
        const data = (await response.json()) as {
          ok: boolean;
          project?: BoundProjectResponse;
          error?: string;
        };
        if (!response.ok || !data.ok || !data.project) {
          setProject({
            status: "error",
            message: folderErrorMessage(data.error)
          });
          return;
        }
        setCwdManualCandidate(null);
        setProject({
          status: "bound",
          path: data.project.path,
          name: data.project.name
        });
        setAgentConnection(previousAgent);
      } catch {
        setProject({
          status: "error",
          message: folderErrorMessage("binding_failed")
        });
      }
    },
    [bootstrap.session]
  );

  // Recover project state after refresh, and auto-bind cwd when safe.
  useEffect(() => {
    let cancelled = false;
    async function loadProjectState() {
      try {
        const response = await fetch("/api/project", {
          cache: "no-store",
          headers: { "x-ikran-session": bootstrap.session }
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as {
          ok: boolean;
          project?: { path: string; name: string } | null;
          connected_agent?: AgentId | null;
          cwd_candidate?:
            | { path: string; kind: "resume" | "init" | "manual" }
            | null;
        };
        if (cancelled) return;

        const candidate = data.cwd_candidate ?? null;

        if (candidate && (candidate.kind === "resume" || candidate.kind === "init")) {
          await bindFolder(candidate.path);
          return;
        }

        if (data.ok && data.project) {
          setProject({
            status: "bound",
            path: data.project.path,
            name: data.project.name
          });
          if (data.connected_agent) {
            setAgentConnection({
              status: "connected",
              agent: data.connected_agent
            });
          } else {
            setAgentConnection({ status: "idle" });
          }
          return;
        }

        if (candidate && candidate.kind === "manual") {
          setCwdManualCandidate(candidate.path);
        }
      } catch {
        // ignore; UI stays in idle/selecting state
      }
    }
    void loadProjectState();
    return () => {
      cancelled = true;
    };
  }, [bootstrap.session, bindFolder]);

  const connectAgent = useCallback(
    async (agent: AgentId) => {
      if (project.status !== "bound") {
        return;
      }

      const current = agentConnectionRef.current;
      if (current.status === "connecting") {
        return;
      }

      const boundPath = project.path;
      const previousAgent =
        current.status === "connected" ? current.agent : undefined;

      setAgentConnection({ status: "connecting", agent, previousAgent });
      try {
        const response = await fetch("/api/agent/connect", {
          method: "POST",
          headers: {
            "x-ikran-session": bootstrap.session,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ agent, projectPath: boundPath })
        });
        const data = (await response.json()) as {
          ok: boolean;
          agent?: AgentId;
          error?: string;
        };
        if (!isStillBoundTo(boundPath)) {
          return;
        }
        if (!response.ok || !data.ok || !data.agent) {
          const message = agentErrorMessage(data.error);
          if (previousAgent) {
            setAgentConnection({
              status: "connected",
              agent: previousAgent,
              switchError: message
            });
          } else {
            setAgentConnection({
              status: "error",
              agent,
              message
            });
          }
          return;
        }
        setAgentConnection({ status: "connected", agent: data.agent });
      } catch {
        if (!isStillBoundTo(boundPath)) {
          return;
        }
        const message = agentErrorMessage("connection_failed");
        if (previousAgent) {
          setAgentConnection({
            status: "connected",
            agent: previousAgent,
            switchError: message
          });
        } else {
          setAgentConnection({
            status: "error",
            agent,
            message
          });
        }
      }
    },
    [bootstrap.session, project]
  );

  async function handleUseCurrentFolder() {
    if (!cwdManualCandidate) {
      return;
    }
    await bindFolder(cwdManualCandidate);
  }

  async function handleSelectFolder() {
    if (runtimeState !== "connected") return;

    const previousProject = project;
    const previousAgent = agentConnection;
    const restorePreviousProject = () => {
      setProject(previousProject);
      setAgentConnection(previousAgent);
    };
    const applyBoundProject = (nextProject: BoundProjectResponse) => {
      setProject({
        status: "bound",
        path: nextProject.path,
        name: nextProject.name
      });
      setAgentConnection(previousAgent);
    };

    setProject({ status: "selecting" });
    try {
      const response = await fetch("/api/project/select-folder", {
        method: "POST",
        headers: { "x-ikran-session": bootstrap.session }
      });
      const data = (await response.json()) as {
        ok: boolean;
        path?: string;
        project?: BoundProjectResponse;
        error?: string;
        detail?: string;
      };

      if (!response.ok || !data.ok) {
        if (data.error === "native_picker_cancelled") {
          restorePreviousProject();
          return;
        }

        const fallback = data.error || "native_picker_unavailable";
        const manualPath = window.prompt(
          `Native folder picker could not open (${fallback}${data.detail ? `: ${data.detail}` : ""}). Enter the full project folder path:`
        );
        if (manualPath) {
          await bindFolder(manualPath);
        } else {
          restorePreviousProject();
        }
        return;
      }

      if (data.project) {
        applyBoundProject(data.project);
        return;
      }

      if (data.path) {
        await bindFolder(data.path);
      } else {
        restorePreviousProject();
      }
    } catch {
      if (previousProject.status === "bound") {
        restorePreviousProject();
        return;
      }
      setProject({
        status: "error",
        message: folderErrorMessage("native_picker_unavailable")
      });
    }
  }

  const runtimeHelper = useMemo(() => {
    if (runtimeState === "connected") {
      return "Local runtime connected";
    }
    if (runtimeState === "loading") {
      return "Checking local runtime connection";
    }
    return <>Local runtime disconnected. Try again</>;
  }, [runtimeState, reconnectRuntime]);

  const folderReady = runtimeState === "connected";
  const agentReady = project.status === "bound";
  const buildingReady =
    agentReady && agentConnection.status === "connected";

  const folderVariant: FolderSelectVariant =
    project.status === "bound"
      ? "complete"
      : cwdManualCandidate
        ? "inside-folder"
        : folderReady
          ? "default"
          : "inactive";

  const folderBusy =
    project.status === "selecting" ||
    project.status === "binding" ||
    agentConnection.status === "connecting";

  return (
    <main className="page">
      <IconGradients />
      <section className="setup" aria-label="Project setup">
        <div className="copy">
          <p>Project set up...</p>
          <p className="muted">A few steps before we begin</p>
        </div>

        <div className="steps">
          <SetupStepButton
            icon={
              runtimeState === "connected" ? (
                <CompleteCheckIcon />
              ) : (
                <IconBox tone="pink">
                  <PhosphorDownloadIcon
                    color={activeIconGradients.download}
                    size={14}
                    weight="fill"
                  />
                </IconBox>
              )
            }
            label={runtimeState === "loading" ? "Connecting..." : "Local Runtime"}
            labelComplete={runtimeState === "connected"}
            stepNumber={runtimeState === "connected" ? undefined : 1}
            stepNumberActive
            stepNumberTone="pink"
            helper={renderRuntimeHelper(runtimeState, runtimeHelper)}
            helperTone={
              runtimeState === "connected"
                ? "success"
                : runtimeState === "disconnected"
                  ? "error"
                  : "default"
            }
            helperTestId="runtime-helper"
            onClick={
              runtimeState === "disconnected" ? reconnectRuntime : undefined
            }
            disabled={runtimeState === "loading"}
          />
          <FolderSelectStep
            variant={folderVariant}
            helper={renderFolderHelper(project, folderVariant)}
            helperTone={
              project.status === "bound"
                ? "success"
                : project.status === "error"
                  ? "error"
                  : "default"
            }
            rowTestId="select-folder-button"
            onSelectFolder={handleSelectFolder}
            onUseFolderDirectly={() => void handleUseCurrentFolder()}
            folderActionDisabled={!folderReady || folderBusy}
            useFolderDirectlyDisabled={!folderReady || folderBusy}
          />
          <AgentConnectorCard
            active={agentReady}
            connection={agentConnection}
            onSelectAgent={(agent) => void connectAgent(agent)}
          />
        </div>

        <SetupActionButton label="Start Building" disabled={!buildingReady} />
      </section>

      <span hidden data-testid="runtime-service">
        {health?.service || ""}
      </span>
      <span hidden data-testid="project-path">
        {project.status === "bound" ? project.path : ""}
      </span>
    </main>
  );
}

function renderFolderHelper(
  project: ProjectState,
  variant: FolderSelectVariant
) {
  switch (project.status) {
    case "bound":
      return <>Complete! {project.path}</>;
    case "selecting":
      return <>Opening folder picker...</>;
    case "binding":
      return <>Binding {project.path}...</>;
    case "error":
      return <>{project.message}</>;
    default:
      if (variant === "inside-folder") {
        return <>Choose a local folder</>;
      }
      return (
        <>
          Choose a local folder for <strong>files storage</strong> of this
          project
        </>
      );
  }
}

function renderRuntimeHelper(state: RuntimeState, helper: ReactNode) {
  if (state === "connected" || state === "disconnected") {
    return helper;
  }

  return (
    <>
      Install a local runtime for agent - webapp <strong>connection</strong>
    </>
  );
}
