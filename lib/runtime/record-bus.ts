// In-process record invalidation bus (Task 11).
//
// Live Workbench refresh signal — NOT the SQLite research/audit `events` table.
// Emit only after a successful SQLite COMMIT (or equivalent durable write).
// Shared across Next route bundles and MCP TS modules via globalThis.

import { EventEmitter } from "node:events";

export type RecordBusKind =
  | "seed"
  | "evidence"
  | "annotation"
  | "alignment"
  | "artifact"
  | "design-system"
  | "phase"
  | "prototype"
  | "agent-command"
  | "rule-update";
export type RecordBusAction = "created" | "updated" | "deleted";

export type RecordBusEvent = {
  kind: RecordBusKind;
  action: RecordBusAction;
  id: string;
  projectPath: string;
  timestamp: string;
};

type RecordListener = (event: RecordBusEvent) => void;

const GLOBAL_KEY = "__IKRAN_RECORD_BUS__";

type GlobalBus = {
  emitter: EventEmitter;
};

function getBus(): GlobalBus {
  const g = globalThis as unknown as { [GLOBAL_KEY]?: GlobalBus };
  if (!g[GLOBAL_KEY]) {
    const emitter = new EventEmitter();
    // Many Workbench SSE connections may subscribe concurrently.
    emitter.setMaxListeners(0);
    g[GLOBAL_KEY] = { emitter };
  }
  return g[GLOBAL_KEY]!;
}

/** Emit a record invalidation. Callers must only invoke after durable success. */
export function emitRecordEvent(
  event: Omit<RecordBusEvent, "timestamp"> & { timestamp?: string }
): void {
  const full: RecordBusEvent = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString()
  };
  // Call listeners individually so a throw cannot bubble into the caller's
  // DB catch (which would surface as `db_error` after a successful commit).
  for (const listener of getBus().emitter.listeners("record")) {
    try {
      (listener as RecordListener)(full);
    } catch (err) {
      console.error("[record-bus] listener error:", err);
    }
  }
}

export function subscribeRecordEvents(listener: RecordListener): () => void {
  const { emitter } = getBus();
  emitter.on("record", listener);
  return () => {
    emitter.off("record", listener);
  };
}

export function getRecordBusListenerCount(): number {
  return getBus().emitter.listenerCount("record");
}

/** Test-only: drop all listeners (does not replace the emitter identity). */
export function resetRecordBusForTests(): void {
  getBus().emitter.removeAllListeners("record");
}
