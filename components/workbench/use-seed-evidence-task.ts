"use client";

// Task lifecycle for the Issue 04 seed evidence import.
//
// Owns the Browser UI <-> Runtime round-trip for one `seed_evidence_import`
// task: submit via POST /api/tasks, then watch progress + completion. SSE is
// the primary channel (live progress + completed output); polling
// /api/tasks/:id is a fallback that only takes over if the SSE stream drops
// before a terminal event. The two never race for the same terminal event —
// whichever resolves first calls teardown(), which stops the other.
//
// The hook never invents evidence: `result` is populated only from Runtime
// task/API/SSE data (the completed event's `output`, or the polled task's
// `result`). Per Issue 04 / AGENTS.md, the UI must not hardcode a fixture.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SeedEvidenceInput,
  SeedEvidencePackage
} from "@/lib/runtime/seed-evidence-types";

export type SeedTaskStatus = "idle" | "loading" | "done" | "error";

export interface SeedTaskState {
  status: SeedTaskStatus;
  /** 0..100, advanced by SSE progress events. */
  progress: number;
  /** Runtime/AgentAdapter evidence package; null until the task completes. */
  result: SeedEvidencePackage | null;
  /** Human-readable failure reason; null unless status === "error". */
  error: string | null;
}

export interface SubmitOptions {
  progressTicks?: number;
  delayMs?: number;
}

const INITIAL_STATE: SeedTaskState = {
  status: "idle",
  progress: 0,
  result: null,
  error: null
};

// Shape of a task frame on the multiplexed SSE stream (see /api/events +
// lib/runtime/task-bus.ts). Only the fields the hook reacts to are typed.
interface TaskSseEvent {
  kind: "started" | "progress" | "output" | "completed" | "failed";
  data?: { step?: number };
  output?: unknown;
  errorMessage?: string;
}

const POLL_INTERVAL_MS = 300;
const COMPLETION_FLASH_MS = 420;

export function useSeedEvidenceTask(session: string) {
  const [state, setState] = useState<SeedTaskState>(INITIAL_STATE);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTotalRef = useRef<number>(6);

  const clearCompletionTimer = useCallback(() => {
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const closeSource = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    closeSource();
    stopPoll();
    clearCompletionTimer();
  }, [clearCompletionTimer, closeSource, stopPoll]);

  // Tear down any live SSE/poll on unmount.
  useEffect(() => teardown, [teardown]);

  const reset = useCallback(() => {
    teardown();
    setState(INITIAL_STATE);
  }, [teardown]);

  const finishWithResult = useCallback((output: unknown) => {
    closeSource();
    stopPoll();
    clearCompletionTimer();
    setState((prev) => ({
      ...prev,
      status: "loading",
      progress: 100,
      result: null,
      error: null
    }));
    completionTimerRef.current = setTimeout(() => {
      completionTimerRef.current = null;
      setState({
        status: "done",
        progress: 100,
        result: output as SeedEvidencePackage,
        error: null
      });
    }, COMPLETION_FLASH_MS);
  }, [clearCompletionTimer, closeSource, stopPoll]);

  const restoreCompletedResult = useCallback((output: unknown) => {
    teardown();
    setState({
      status: "done",
      progress: 100,
      result: output as SeedEvidencePackage,
      error: null
    });
  }, [teardown]);

  const fail = useCallback((message: string) => {
    teardown();
    setState({ status: "error", progress: 0, result: null, error: message });
  }, [teardown]);

  const applyProgress = useCallback((step: number | undefined) => {
    setState((prev) => {
      if (prev.status !== "loading") return prev;
      const total = progressTotalRef.current;
      const next =
        typeof step === "number" && total > 0
          ? Math.min(99, Math.round((step / total) * 100))
          : Math.min(99, prev.progress + 4);
      return { ...prev, progress: next };
    });
  }, []);

  const handleSseEvent = useCallback(
    (event: TaskSseEvent) => {
      if (event.kind === "progress") {
        applyProgress(event.data?.step);
        return;
      }
      if (event.kind === "completed" && event.output) {
        finishWithResult(event.output);
        return;
      }
      if (event.kind === "failed") {
        fail(event.errorMessage || "Seed import failed.");
      }
    },
    [applyProgress, fail, finishWithResult]
  );

  // Fallback path: read task status from the REST endpoint until terminal.
  // Used only when SSE drops before a terminal event. Acts solely on terminal
  // status (done/failed) so it cannot duplicate SSE progress.
  const startPolling = useCallback(
    (taskId: string) => {
      stopPoll();
      pollRef.current = setInterval(async () => {
        let response: Response;
        try {
          response = await fetch(`/api/tasks/${taskId}`, {
            cache: "no-store",
            headers: { "x-ikran-session": session }
          });
        } catch {
          return; // transient network blip — keep polling
        }
        if (!response.ok) return;
        const data = (await response.json().catch(() => ({}))) as {
          task?: { status: string; result?: unknown };
        };
        const task = data.task;
        if (!task) return;
        if (task.status === "done" && task.result) {
          restoreCompletedResult(task.result);
        } else if (task.status === "failed") {
          fail("Seed import failed.");
        }
      }, POLL_INTERVAL_MS);
    },
    [fail, restoreCompletedResult, session, stopPoll]
  );

  const submit = useCallback(
    async (input: SeedEvidenceInput, opts: SubmitOptions = {}) => {
      const progressTicks = opts.progressTicks ?? 6;
      progressTotalRef.current = progressTicks;
      teardown();
      setState({ status: "loading", progress: 0, result: null, error: null });

      let response: Response;
      try {
        response = await fetch("/api/tasks", {
          method: "POST",
          headers: {
            "x-ikran-session": session,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            family: "seed_evidence_import",
            payload: {
              input,
              mock: {
                progressTicks,
                delayMs: opts.delayMs ?? 80
              }
            }
          })
        });
      } catch {
        fail("Could not reach the local runtime.");
        return;
      }

      const data = (await response.json().catch(() => ({}))) as {
        taskId?: string;
      };
      if (!response.ok || !data.taskId) {
        fail("Could not start the seed import.");
        return;
      }

      const taskId = data.taskId;
      const source = new EventSource(
        `/api/events?session=${encodeURIComponent(session)}&task=${encodeURIComponent(taskId)}`
      );
      eventSourceRef.current = source;

      source.addEventListener("task", (message) => {
        handleSseEvent(JSON.parse((message as MessageEvent).data) as TaskSseEvent);
      });

      // SSE dropped before a terminal event — fall back to polling. Closing
      // the source first prevents EventSource auto-reconnect from racing the
      // poll for the terminal event. The poll only acts on terminal task
      // status, so re-entrant errors / late errors after completion are
      // harmless (finishWithResult/fail are idempotent via teardown).
      source.addEventListener("error", () => {
        closeSource();
        startPolling(taskId);
      });
    },
    [closeSource, handleSseEvent, session, startPolling, teardown]
  );

  return { state, submit, reset };
}
