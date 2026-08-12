import path from "node:path";

import {
  findEarliestPendingAgentCommand as findEarliestDurableAgentCommand,
  readActiveRuleUpdateReviewWaitScope,
  type AgentCommandScope
} from "./agent-command";
import { subscribeRecordEvents } from "./record-bus";
import {
  DESIGNER_HANDOFF_STAGES,
  getProjectWorkflowStage,
  type WorkflowStage
} from "./alignment-preparation";
import { getProjectReadiness } from "./project-readiness";

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
  scope: AgentCommandScope;
  alignment_attempt_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AgentCommandWaitScope =
  | { kind: "alignment_handoff" }
  | { kind: "rule_update_review"; id: string };

export type AgentCommandWaitEligibility =
  | {
      ok: true;
      eligible: true;
      stage: WorkflowStage;
      seed_reference_count: number;
      wait_scope: AgentCommandWaitScope;
    }
  | {
      ok: true;
      eligible: false;
      stage: WorkflowStage;
      seed_reference_count: number;
      reason: "seed_reference_required" | "outside_designer_handoff";
    }
  | { ok: false; reason: "state_unavailable" };

/**
 * Read the complete lease-eligibility state. A caller may still retrieve an
 * already-pending Agent command outside this window, but it must not start a
 * new Adaptive Agent wait there.
 */
export function readAgentCommandWaitEligibility(
  projectPath: string
): AgentCommandWaitEligibility {
  try {
    const stage = getProjectWorkflowStage(projectPath);
    const seedReferenceCount =
      getProjectReadiness(projectPath).seedReferenceCount;
    const activeRuleUpdateReview =
      readActiveRuleUpdateReviewWaitScope(projectPath);
    if (activeRuleUpdateReview) {
      return {
        ok: true,
        eligible: true,
        stage,
        seed_reference_count: seedReferenceCount,
        wait_scope: activeRuleUpdateReview.scope
      };
    }
    if (seedReferenceCount === 0) {
      return {
        ok: true,
        eligible: false,
        stage,
        seed_reference_count: seedReferenceCount,
        reason: "seed_reference_required"
      };
    }
    if (!DESIGNER_HANDOFF_STAGES.has(stage)) {
      return {
        ok: true,
        eligible: false,
        stage,
        seed_reference_count: seedReferenceCount,
        reason: "outside_designer_handoff"
      };
    }
    return {
      ok: true,
      eligible: true,
      stage,
      seed_reference_count: seedReferenceCount,
      wait_scope: { kind: "alignment_handoff" }
    };
  } catch {
    return { ok: false, reason: "state_unavailable" };
  }
}

export type WaitForAgentCommandResult =
  | { ok: true; reason: "command_available"; command: PendingAgentCommand }
  | {
      ok: true;
      reason: "idle_no_command" | "page_closed_no_command" | "cancelled";
      command: null;
    }
  | {
      ok: true;
      reason: "not_applicable";
      command: null;
      stage: WorkflowStage;
      not_applicable_reason:
        | "seed_reference_required"
        | "outside_designer_handoff";
    }
  | {
      ok: false;
      reason: "command_read_failed" | "state_unavailable";
      command: null;
    };

export function findEarliestPendingAgentCommand(
  projectPath: string
): PendingAgentCommand | null {
  const command = findEarliestDurableAgentCommand(projectPath);
  return command
    ? {
        id: command.id,
        command_type: command.command_type,
        scope: command.scope,
        alignment_attempt_id: command.alignment_attempt_id,
        payload: command.payload,
        created_at: command.created_at
      }
    : null;
}

export async function waitForAgentCommand(
  projectPath: string,
  options: {
    signal?: AbortSignal;
    windowMs?: number;
    now?: () => number;
    readPendingCommand?: (projectPath: string) => PendingAgentCommand | null;
    readWaitEligibility?: (
      projectPath: string
    ) => AgentCommandWaitEligibility;
  } = {}
): Promise<WaitForAgentCommandResult> {
  const readPendingCommand =
    options.readPendingCommand ?? findEarliestPendingAgentCommand;
  const readWaitEligibility =
    options.readWaitEligibility ?? readAgentCommandWaitEligibility;
  let immediate: PendingAgentCommand | null = null;
  let immediateCommandReadFailed = false;
  try {
    immediate = readPendingCommand(projectPath);
  } catch {
    // A transient read failure must not crash the Runtime or strand a waiter.
    // Presence, record-bus activity, and the lease deadline will retry below.
    immediateCommandReadFailed = true;
  }
  if (immediate) {
    return { ok: true, reason: "command_available", command: immediate };
  }
  let initialEligibility: AgentCommandWaitEligibility;
  try {
    initialEligibility = readWaitEligibility(projectPath);
  } catch {
    return { ok: false, reason: "state_unavailable", command: null };
  }
  if (!initialEligibility.ok) {
    return { ok: false, reason: "state_unavailable", command: null };
  }
  if (!initialEligibility.eligible) {
    // Do not report not_applicable when the pending-command read itself was
    // unavailable: a durable command could already exist and must win.
    if (immediateCommandReadFailed) {
      return { ok: false, reason: "command_read_failed", command: null };
    }
    return {
      ok: true,
      reason: "not_applicable",
      command: null,
      stage: initialEligibility.stage,
      not_applicable_reason: initialEligibility.reason
    };
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
    const checkEligibility = ():
      | "eligible"
      | "not_applicable"
      | "failed" => {
      let eligibility: AgentCommandWaitEligibility;
      try {
        eligibility = readWaitEligibility(projectPath);
      } catch {
        finish({ ok: false, reason: "state_unavailable", command: null });
        return "failed";
      }
      if (!eligibility.ok) {
        finish({ ok: false, reason: "state_unavailable", command: null });
        return "failed";
      }
      if (!eligibility.eligible) {
        finish({
          ok: true,
          reason: "not_applicable",
          command: null,
          stage: eligibility.stage,
          not_applicable_reason: eligibility.reason
        });
        return "not_applicable";
      }
      return "eligible";
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      const decision = waitLeaseDecision(lease, now());
      if (decision.done) {
        const commandState = checkCommand();
        if (commandState === "failed") {
          finish({ ok: false, reason: "command_read_failed", command: null });
        } else if (commandState === "empty") {
          if (checkEligibility() === "eligible") {
            finish({ ok: true, reason: decision.reason, command: null });
          }
        }
        return;
      }
      timer = setTimeout(schedule, Math.max(1, decision.remainingMs));
    };
    const unsubscribePresence = subscribePresence(projectPath, (presence) => {
      const commandState = checkCommand();
      if (commandState !== "empty") return;
      if (checkEligibility() !== "eligible") return;
      lease = applyPresenceToLease(lease, presence, now(), windowMs);
      schedule();
    });
    const unsubscribeRecords = subscribeRecordEvents((event) => {
      if (path.resolve(event.projectPath) === path.resolve(projectPath)) {
        const commandState = checkCommand();
        if (commandState === "empty") checkEligibility();
      }
    });
    const onAbort = () =>
      finish({ ok: true, reason: "cancelled", command: null });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    else schedule();
  });
}
