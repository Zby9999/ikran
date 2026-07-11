"use client";

// Project setup card — the designer's existing (Figma-owned) web design.
//
// Data flows through the same-origin Ikran Runtime (`/api/health`,
// `/api/events`, `/api/project`). Do not alter layout, icons, or styling here
// without a Figma source.
//
// Issue 02/02: the folder step no longer picks a folder. The working folder is
// chosen before the conversation (the folder the user opened in the Agent
// host), forwarded to the Runtime as IKRAN_CWD. So the step now auto-completes
// when `.ikran` already exists, or offers a one-click "Initialize here" that
// creates `.ikran` in that folder. The helper COPY was changed for this flow
// (label + per-state text); the visual layout is unchanged. Final wording
// should be confirmed against Figma by the designer.

import {
  DownloadIcon as PhosphorDownloadIcon
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { folderErrorMessage } from "../../lib/runtime/folder-error-message";
import {
  subscribeRuntimeEvents,
  type RuntimeHeartbeatEvent
} from "../runtime/runtime-client";
import { SeedEvidenceWorkbench } from "../workbench";
import { FolderSelectStep, type FolderSelectVariant } from "./FolderSelectStep";
import { activeIconGradients, IconGradients } from "./IconGradients";
import { IconBox } from "./IconBox";
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

type ProjectState =
  | { status: "idle" }
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
  const [, setHeartbeat] = useState<RuntimeHeartbeatEvent | null>(null);
  const [project, setProject] = useState<ProjectState>({ status: "idle" });
  const [cwdCandidate, setCwdCandidate] = useState<{
    path: string;
    kind: "init" | "manual";
  } | null>(null);
  const [showSeedWorkbench, setShowSeedWorkbench] = useState(false);

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
    const unsubscribe = subscribeRuntimeEvents(bootstrap.session, {
      onHeartbeat: (event) => {
        setHeartbeat(event);
        setRuntimeState("connected");
      },
      onError: () => {
        setRuntimeState("disconnected");
      }
    });
    return unsubscribe;
  }, [bootstrap.session, eventsGeneration]);

  const bindFolder = useCallback(
    async (folderPath: string) => {
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
        setCwdCandidate(null);
        setProject({
          status: "bound",
          path: data.project.path,
          name: data.project.name
        });
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
          cwd_candidate?:
            | { path: string; kind: "resume" | "init" | "manual" }
            | null;
          cwd_matches_active?: boolean;
        };
        if (cancelled) return;

        const candidate = data.cwd_candidate ?? null;
        const active = data.ok ? data.project : null;

        // The working folder (cwd) is chosen before the conversation. If it
        // already has .ikran AND is already the active binding, just show
        // complete (no rebind -> no event spam on refresh).
        if (
          active &&
          candidate &&
          candidate.kind === "resume" &&
          data.cwd_matches_active
        ) {
          setProject({
            status: "bound",
            path: active.path,
            name: active.name
          });
          return;
        }

        // Working folder has .ikran but is not the active binding -> bind it
        // (the cwd working folder is authoritative).
        if (candidate && candidate.kind === "resume") {
          await bindFolder(candidate.path);
          return;
        }

        // An active project exists from a prior bind this session -> show it.
        if (active) {
          setProject({
            status: "bound",
            path: active.path,
            name: active.name
          });
          return;
        }

        // Working folder is bindable but not yet initialized -> offer a
        // one-click "Initialize here" (do NOT auto-bind; the user clicks).
        if (candidate && (candidate.kind === "init" || candidate.kind === "manual")) {
          setCwdCandidate({ path: candidate.path, kind: candidate.kind });
          return;
        }

        // No working folder known (IKRAN_CWD not forwarded).
        setCwdCandidate(null);
      } catch {
        // ignore; UI stays in idle/selecting state
      }
    }
    void loadProjectState();
    return () => {
      cancelled = true;
    };
  }, [bootstrap.session, bindFolder]);

  // Initialize the working folder (the cwd candidate the Runtime forwarded) as
  // the Ikran project: create `.ikran/` inside it and bind it. Replaces the old
  // native folder picker + manual path input (Issue 02/02: the working folder is
  // chosen before the conversation, so the panel no longer selects a folder).
  async function handleInitialize() {
    if (runtimeState !== "connected") return;
    if (project.status === "bound") return;
    if (!cwdCandidate) return;
    await bindFolder(cwdCandidate.path);
  }

  const runtimeHelper = useMemo(() => {
    if (runtimeState === "connected") {
      return "Local runtime connected";
    }
    if (runtimeState === "loading") {
      return "Checking local runtime connection";
    }
    return <>Local runtime disconnected. Try again</>;
  }, [runtimeState]);

  const folderReady = runtimeState === "connected";
  const buildingReady =
    runtimeState === "connected" && project.status === "bound";

  const folderVariant: FolderSelectVariant =
    project.status === "bound"
      ? "complete"
      : folderReady
        ? "default"
        : "inactive";

  const folderBusy = project.status === "binding";

  const folderActionDisabled =
    !folderReady ||
    folderBusy ||
    (project.status !== "bound" && !cwdCandidate);

  if (showSeedWorkbench && project.status === "bound") {
    return (
      <SeedEvidenceWorkbench
        session={bootstrap.session}
        folderName={project.name}
        onBack={() => setShowSeedWorkbench(false)}
      />
    );
  }

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
              <IconBox tone="pink">
                <PhosphorDownloadIcon
                  color={activeIconGradients.download}
                  size={14}
                  weight="fill"
                />
              </IconBox>
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
            helper={renderFolderHelper(project, folderVariant, cwdCandidate)}
            helperTone={
              project.status === "bound"
                ? "success"
                : project.status === "error"
                  ? "error"
                  : "default"
            }
            rowTestId="select-folder-button"
            onSelectFolder={handleInitialize}
            folderActionDisabled={folderActionDisabled}
          />
        </div>

        <SetupActionButton
          label="Start Building"
          disabled={!buildingReady}
          onClick={() => setShowSeedWorkbench(true)}
        />
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
  variant: FolderSelectVariant,
  cwdCandidate: { path: string; kind: "init" | "manual" } | null
) {
  switch (project.status) {
    case "bound":
      return <>Complete! {project.path}</>;
    case "binding":
      return <>Initializing {project.path}...</>;
    case "error":
      return <>{project.message}</>;
    default:
      break;
  }
  // Not bound (idle).
  if (variant === "inactive") {
    return <>Connect the local runtime to bind a project folder.</>;
  }
  if (!cwdCandidate) {
    return <>Open from Agent to bind folder.</>;
  }
  if (cwdCandidate.kind === "manual") {
    return <>Initialize .ikran in this folder</>;
  }
  return <>Click to initialize the project folder</>;
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
