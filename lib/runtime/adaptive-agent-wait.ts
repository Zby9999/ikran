import path from "node:path";

import { closeProjectDb, openProjectDb } from "./db";
import { subscribeRecordEvents } from "./record-bus";

export const ADAPTIVE_WAIT_WINDOW_MS = 3 * 60 * 1000;

export type WorkbenchPresence = {
  visible: boolean;
  focused: boolean;
  recentInteraction: boolean;
  dirty: boolean;
  semanticActivity: boolean;
  closed: boolean;
};

export type WaitLease = {
  deadlineMs: number;
  closed: boolean;
};

export function createWaitLease(nowMs: number): WaitLease {
  return { deadlineMs: nowMs + ADAPTIVE_WAIT_WINDOW_MS, closed: false };
}

export function presenceIsEngaged(presence: WorkbenchPresence): boolean {
  return (
    !presence.closed &&
    presence.visible &&
    presence.focused &&
    (presence.recentInteraction || presence.dirty || presence.semanticActivity)
  );
}

export function applyPresenceToLease(
  lease: WaitLease,
  presence: WorkbenchPresence,
  nowMs: number,
  windowMs = ADAPTIVE_WAIT_WINDOW_MS
): WaitLease {
  if (presence.closed) return { ...lease, closed: true };
  if (!presenceIsEngaged(presence)) return lease;
  return { deadlineMs: nowMs + windowMs, closed: false };
}

export function waitLeaseDecision(lease: WaitLease, nowMs: number) {
  if (lease.closed) {
    return { done: true as const, reason: "page_closed_no_command" as const };
  }
  if (nowMs >= lease.deadlineMs) {
    return { done: true as const, reason: "idle_no_command" as const };
  }
  return { done: false as const, remainingMs: lease.deadlineMs - nowMs };
}

type PresenceListener = (presence: WorkbenchPresence) => void;
const GLOBAL = globalThis as unknown as {
  __IKRAN_WORKBENCH_PRESENCE_LISTENERS?: Map<string, Set<PresenceListener>>;
};

function listeners() {
  return (
    GLOBAL.__IKRAN_WORKBENCH_PRESENCE_LISTENERS ??=
      new Map<string, Set<PresenceListener>>()
  );
}

export function reportWorkbenchPresence(
  projectPath: string,
  presence: WorkbenchPresence
): void {
  const key = path.resolve(projectPath);
  for (const listener of listeners().get(key) ?? []) listener(presence);
}

function subscribePresence(projectPath: string, listener: PresenceListener) {
  const key = path.resolve(projectPath);
  const set = listeners().get(key) ?? new Set<PresenceListener>();
  set.add(listener);
  listeners().set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners().delete(key);
  };
}

export type PendingAgentCommand = {
  id: string;
  command_type: string;
  alignment_attempt_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export function findEarliestPendingAgentCommand(
  projectPath: string
): PendingAgentCommand | null {
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare(
        `SELECT id, command_type, alignment_attempt_id, payload_json, created_at
         FROM agent_commands
         WHERE status = 'pending'
         ORDER BY created_at ASC, id ASC
         LIMIT 1`
      )
      .get() as
      | {
          id: string;
          command_type: string;
          alignment_attempt_id: string;
          payload_json: string;
          created_at: string;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          command_type: row.command_type,
          alignment_attempt_id: row.alignment_attempt_id,
          payload: JSON.parse(row.payload_json) as Record<string, unknown>,
          created_at: row.created_at
        }
      : null;
  } finally {
    closeProjectDb(db);
  }
}

export async function waitForAgentCommand(
  projectPath: string,
  options: {
    signal?: AbortSignal;
    windowMs?: number;
    now?: () => number;
    readPendingCommand?: (projectPath: string) => PendingAgentCommand | null;
  } = {}
): Promise<
  | { ok: true; reason: "command_available"; command: PendingAgentCommand }
  | {
      ok: true;
      reason: "idle_no_command" | "page_closed_no_command" | "cancelled";
      command: null;
    }
  | { ok: false; reason: "command_read_failed"; command: null }
> {
  const readPendingCommand =
    options.readPendingCommand ?? findEarliestPendingAgentCommand;
  let immediate: PendingAgentCommand | null = null;
  try {
    immediate = readPendingCommand(projectPath);
  } catch {
    // A transient read failure must not crash the Runtime or strand a waiter.
    // Presence, record-bus activity, and the lease deadline will retry below.
  }
  if (immediate) {
    return { ok: true, reason: "command_available", command: immediate };
  }
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? ADAPTIVE_WAIT_WINDOW_MS;
  let lease: WaitLease = {
    deadlineMs: now() + windowMs,
    closed: false
  };

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = (value: Parameters<typeof resolve>[0]) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribePresence();
      unsubscribeRecords();
      options.signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const checkCommand = (): "found" | "empty" | "failed" => {
      let command: PendingAgentCommand | null = null;
      try {
        command = readPendingCommand(projectPath);
      } catch {
        return "failed";
      }
      if (command) {
        finish({ ok: true, reason: "command_available", command });
        return "found";
      }
      return "empty";
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      const decision = waitLeaseDecision(lease, now());
      if (decision.done) {
        const commandState = checkCommand();
        if (commandState === "failed") {
          finish({ ok: false, reason: "command_read_failed", command: null });
        } else if (commandState === "empty") {
          finish({ ok: true, reason: decision.reason, command: null });
        }
        return;
      }
      timer = setTimeout(schedule, Math.max(1, decision.remainingMs));
    };
    const unsubscribePresence = subscribePresence(projectPath, (presence) => {
      if (checkCommand() === "found") return;
      lease = applyPresenceToLease(lease, presence, now(), windowMs);
      schedule();
    });
    const unsubscribeRecords = subscribeRecordEvents((event) => {
      if (path.resolve(event.projectPath) === path.resolve(projectPath)) {
        checkCommand();
      }
    });
    const onAbort = () =>
      finish({ ok: true, reason: "cancelled", command: null });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    else schedule();
  });
}
