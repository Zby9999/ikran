// In-process EventEmitter bus for live task progress. /api/events subscribes
// and multiplexes onto its single SSE stream; task-runner emits. This is
// RUNTIME-side plumbing (not adapter state — adapters never import this).

import { EventEmitter } from "node:events";
import type { TaskFamily, TaskErrorCode } from "./adapter";
import type { TaskStatus } from "./task-runner";

export type TaskBusKind =
  | "started"
  | "progress"
  | "output"
  | "completed"
  | "failed";

export interface TaskBusEvent {
  kind: TaskBusKind;
  taskId: string;
  family: TaskFamily;
  status: TaskStatus;
  message?: string;
  data?: unknown;
  output?: unknown;
  errorCode?: TaskErrorCode;
  errorMessage?: string;
  timestamp: string;
}

export const TASK_BUS_CHANNEL = "task";

const G = globalThis as unknown as { __IKRAN_TASK_BUS?: EventEmitter };
const bus: EventEmitter =
  G.__IKRAN_TASK_BUS ?? (G.__IKRAN_TASK_BUS = new EventEmitter());
bus.setMaxListeners(0); // many SSE connections may subscribe

export function emitTaskEvent(ev: TaskBusEvent): void {
  bus.emit(TASK_BUS_CHANNEL, ev);
}

export function onTaskEvent(handler: (ev: TaskBusEvent) => void): () => void {
  bus.on(TASK_BUS_CHANNEL, handler);
  return () => bus.off(TASK_BUS_CHANNEL, handler);
}