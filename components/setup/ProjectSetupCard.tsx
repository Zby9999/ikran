"use client";

// Project setup card — Figma-owned setup stack (Runtime + Project Folder).
//
// Data flows through the same-origin Ikran Runtime (`/api/health`,
// `/api/events`, `/api/project`). Status copy lives inside each step row.
//
// Issue 02/02: the folder step no longer picks a folder. The working folder is
// chosen before the conversation (the folder the user opened in the Agent
// host), forwarded to the Runtime as IKRAN_CWD. The step auto-completes when
// `.ikran` already exists, or offers one-click Initialize when confirmation
// is needed. Runtime reconnect remains clickable only when disconnected.

import {
  DownloadIcon as PhosphorDownloadIcon
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
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
import {
  SetupStepButton,
  type SetupStepVisual
} from "./SetupStepButton";
import {
  setWorkbenchViewInUrl
} from "./workbench-view";

type Bootstrap = {
  session: string;
  service: string;
  /** From `?view=workbench` — restore Seed Evidence Workbench after reload. */
  openWorkbench?: boolean;
};

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
    kind: "resume" | "init" | "manual";
  } | null>(null);
  // Persist via `?view=workbench` so Agent reopen/reload of the Workbench URL
  // does not bounce the designer back to Project Setup.
  const [showSeedWorkbench, setShowSeedWorkbench] = useState(
    () => bootstrap.openWorkbench === true
  );

  const enterSeedWorkbench = useCallback(() => {
    setWorkbenchViewInUrl(true);
    setShowSeedWorkbench(true);
  }, []);

  const leaveSeedWorkbench = useCallback(() => {
    setWorkbenchViewInUrl(false);
    setShowSeedWorkbench(false);
  }, []);

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
          // Keep the path available if auto-bind fails so the same row can retry.
          setCwdCandidate({ path: candidate.path, kind: candidate.kind });
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

  const folderReady = runtimeState === "connected";
  const buildingReady =
    runtimeState === "connected" && project.status === "bound";

  const runtimeVisual: SetupStepVisual =
    runtimeState === "connected"
      ? "complete"
      : runtimeState === "loading"
        ? "loading"
        : "error";

  const runtimeLabel =
    (
      {
        complete: "Runtime connected",
        loading: "Loading...",
        error: "Runtime disconnected",
        default: "Runtime Setup"
      } as const
    )[runtimeVisual];

  const folderVariant: FolderSelectVariant =
    project.status === "bound"
      ? "complete"
      : project.status === "binding"
        ? "loading"
        : project.status === "error"
          ? "error"
          : folderReady
            ? "default"
            : "inactive";

  // Retry after bind failure still needs a cwd candidate (same as Initialize).
  const folderActionDisabled =
    !folderReady ||
    project.status === "binding" ||
    ((project.status === "idle" || project.status === "error") &&
      !cwdCandidate);

  if (showSeedWorkbench && project.status === "bound") {
    return (
      <SeedEvidenceWorkbench
        session={bootstrap.session}
        folderName={project.name}
        onBack={leaveSeedWorkbench}
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
            label={runtimeLabel}
            visual={runtimeVisual}
            stepNumber={runtimeVisual === "complete" ? undefined : 1}
            stepNumberTone="pink"
            labelTestId="runtime-label"
            onClick={
              runtimeState === "disconnected" ? reconnectRuntime : undefined
            }
            disabled={runtimeState === "loading"}
          />
          <FolderSelectStep
            variant={folderVariant}
            folderName={
              project.status === "bound" ? project.name : undefined
            }
            rowTestId="select-folder-button"
            onSelectFolder={handleInitialize}
            folderActionDisabled={folderActionDisabled}
          />
        </div>

        <SetupActionButton
          label="Start Building"
          disabled={!buildingReady}
          onClick={enterSeedWorkbench}
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
