"use client";

// Project setup card — the designer's existing (Figma-owned) web design.
//
// Visually identical to the previous `app/page.tsx` screen. The only change
// versus that design is the data source: it calls the same-origin Ikran
// Runtime (`/api/health`, `/api/events`) with the startup session token
// injected by the server page, instead of a separate bridge. Copy and
// identifiers use "Runtime" to align with the current architecture.
//
// Do not alter layout, copy, icons, or styling here without a Figma source.

import {
  DownloadIcon as PhosphorDownloadIcon,
  FolderSimpleIcon
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { type AgentId, AgentConnectorCard } from "./AgentConnectorCard";
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

export function ProjectSetupCard({ bootstrap }: { bootstrap: Bootstrap }) {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("loading");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [heartbeat, setHeartbeat] = useState<HeartbeatEvent | null>(null);
  const [project, setProject] = useState<ProjectState>({ status: "idle" });
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [cwdManualCandidate, setCwdManualCandidate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
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
        if (!cancelled) {
          setHealth(data);
          setRuntimeState(data.ok ? "connected" : "disconnected");
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
          setRuntimeState("disconnected");
        }
      }
    }

    checkHealth();

    return () => {
      cancelled = true;
    };
  }, [bootstrap.session]);

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
  }, [bootstrap.session]);

  // Recover project state after refresh, and auto-bind the folder Ikran was
  // launched from (forwarded as `IKRAN_CWD`) when the Runtime says it is safe.
  // An auto-bindable cwd (resume / init) takes priority over the stored active
  // project pointer: the designer deliberately launched from this folder.
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
          cwd_candidate?:
            | { path: string; kind: "resume" | "init" | "manual" }
            | null;
        };
        if (cancelled) return;

        const candidate = data.cwd_candidate ?? null;

        // Auto-bind (no confirm) when cwd is an existing project (resume) or an
        // effectively empty folder (init).
        if (candidate && (candidate.kind === "resume" || candidate.kind === "init")) {
          await bindFolder(candidate.path);
          return;
        }

        // Recover an already-bound active project.
        if (data.ok && data.project) {
          setProject({
            status: "bound",
            path: data.project.path,
            name: data.project.name
          });
          return;
        }

        // No active project and cwd is a valid but non-empty/non-project folder:
        // surface it as a one-click "use current folder" confirm (no auto-bind).
        if (candidate && candidate.kind === "manual") {
          setCwdManualCandidate(candidate.path);
        }
      } catch {
        // ignore; UI stays in idle/selecting state
      }
    }
    loadProjectState();
    return () => {
      cancelled = true;
    };
  }, [bootstrap.session]);

  async function handleSelectFolder() {
    if (runtimeState !== "connected") return;

    const previousProject = project;
    const previousAgent = selectedAgent;
    const restorePreviousProject = () => {
      setProject(previousProject);
      setSelectedAgent(previousAgent);
    };
    const applyBoundProject = (nextProject: { path: string; name: string }) => {
      setProject({
        status: "bound",
        path: nextProject.path,
        name: nextProject.name
      });
      setSelectedAgent(
        previousProject.status === "bound" && previousProject.path === nextProject.path
          ? previousAgent
          : null
      );
    };

    setSelectedAgent(null);
    setProject({ status: "selecting" });
    try {
      const response = await fetch("/api/project/select-folder", {
        method: "POST",
        headers: { "x-ikran-session": bootstrap.session }
      });
      const data = (await response.json()) as {
        ok: boolean;
        path?: string;
        project?: { path: string; name: string };
        error?: string;
        detail?: string;
      };

      if (!response.ok || !data.ok) {
        if (data.error === "native_picker_cancelled") {
          restorePreviousProject();
          return;
        }

        const fallback = data.error || "native_picker_unavailable";
        // Fall back to a manual path prompt when the native picker is unavailable.
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
      setProject({ status: "error", message: "Could not open folder picker" });
    }
  }

  async function bindFolder(folderPath: string) {
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
        project?: { path: string; name: string };
        error?: string;
      };
      if (!response.ok || !data.ok || !data.project) {
        setProject({
          status: "error",
          message: data.error || "binding_failed"
        });
        return;
      }
      setProject({
        status: "bound",
        path: data.project.path,
        name: data.project.name
      });
    } catch {
      setProject({ status: "error", message: "binding_failed" });
    }
  }

  const helper = useMemo(() => {
    if (runtimeState === "connected") {
      return "Local runtime connected";
    }
    if (runtimeState === "loading") {
      return "Checking local runtime connection";
    }
    return "Local runtime disconnected";
  }, [runtimeState]);

  const folderReady = runtimeState === "connected";
  const agentReady = project.status === "bound";
  const buildingReady = agentReady && selectedAgent !== null;

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
            helper={renderRuntimeHelper(runtimeState, helper)}
            helperTone={
              runtimeState === "connected"
                ? "success"
                : runtimeState === "disconnected"
                  ? "error"
                  : "default"
            }
            helperTestId="runtime-helper"
          />
          <SetupStepButton
            icon={
              project.status === "bound" ? (
                <CompleteCheckIcon />
              ) : (
                <IconBox tone={folderReady ? "blue" : "gray"}>
                  <FolderSimpleIcon
                    color={folderReady ? activeIconGradients.folder : "white"}
                    size={14}
                    weight="fill"
                  />
                </IconBox>
              )
            }
            label="Select a Folder"
            stepNumber={project.status === "bound" ? undefined : 2}
            stepNumberTone={folderReady ? "blue" : "gray"}
            labelComplete={project.status === "bound"}
            helper={renderFolderHelper(project)}
            helperTone={
              project.status === "bound"
                ? "success"
                : project.status === "error"
                  ? "error"
                  : "default"
            }
            helperTestId="folder-helper"
            rowTestId="select-folder-button"
            onClick={handleSelectFolder}
            disabled={!folderReady || project.status === "selecting" || project.status === "binding"}
          />
          {cwdManualCandidate && project.status !== "bound" && (
            <SetupStepButton
              icon={
                <IconBox tone={folderReady ? "blue" : "gray"}>
                  <FolderSimpleIcon
                    color={folderReady ? activeIconGradients.folder : "white"}
                    size={14}
                    weight="fill"
                  />
                </IconBox>
              }
              label="Use Current Folder"
              helper={
                <>
                  Bind <strong>{cwdManualCandidate}</strong> as this
                  project&apos;s folder
                </>
              }
              helperTone="default"
              helperTestId="cwd-folder-helper"
              rowTestId="use-cwd-folder-button"
              onClick={() => {
                if (cwdManualCandidate) bindFolder(cwdManualCandidate);
              }}
              disabled={!folderReady || project.status === "selecting" || project.status === "binding"}
            />
          )}
          <AgentConnectorCard
            active={agentReady}
            selectedAgent={selectedAgent}
            onSelectAgent={setSelectedAgent}
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

function renderFolderHelper(project: ProjectState) {
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
      return (
        <>
          Choose a local folder for <strong>files storage</strong> of this
          project
        </>
      );
  }
}

function renderRuntimeHelper(
  state: RuntimeState,
  helper: string
) {
  if (state === "connected") {
    return helper;
  }

  if (state === "disconnected") {
    return helper;
  }

  return (
    <>
      Install a local runtime for agent - webapp <strong>connection</strong>
    </>
  );
}
