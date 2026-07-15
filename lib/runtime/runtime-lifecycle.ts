export type RuntimeLeaseKind = "mcp" | "workbench" | "job";

export type RuntimeLifecycle = {
  acquire(kind: RuntimeLeaseKind): () => void;
  activeLeaseCount(kind?: RuntimeLeaseKind): number;
  dispose(): void;
};

export function createRuntimeLifecycle({
  idleMs,
  onIdle
}: {
  idleMs: number;
  onIdle: () => void | Promise<void>;
}): RuntimeLifecycle {
  const leases = new Map<RuntimeLeaseKind, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const clearIdle = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const scheduleIdle = () => {
    clearIdle();
    if (disposed || activeLeaseCount() > 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      void onIdle();
    }, idleMs);
    timer.unref?.();
  };

  const activeLeaseCount = (kind?: RuntimeLeaseKind) => kind
    ? leases.get(kind) ?? 0
    : [...leases.values()].reduce((total, count) => total + count, 0);

  const lifecycle: RuntimeLifecycle = {
    acquire(kind) {
      if (disposed) return () => {};
      clearIdle();
      leases.set(kind, (leases.get(kind) ?? 0) + 1);
      let released = false;
      return () => {
        if (released || disposed) return;
        released = true;
        const next = Math.max(0, (leases.get(kind) ?? 0) - 1);
        if (next === 0) leases.delete(kind);
        else leases.set(kind, next);
        scheduleIdle();
      };
    },
    activeLeaseCount,
    dispose() {
      disposed = true;
      clearIdle();
      leases.clear();
    }
  };

  // Readiness with no clients is still an idle state. Arming here also covers
  // a bridge that exits while the detached Runtime is starting.
  scheduleIdle();
  return lifecycle;
}

type RuntimeControl = {
  lifecycle: RuntimeLifecycle;
  requestShutdown: (reason: "user" | "idle") => void | Promise<void>;
  acceptingJobs?: () => boolean;
};

const GLOBAL = globalThis as typeof globalThis & {
  __IKRAN_RUNTIME_CONTROL?: RuntimeControl;
};

export function registerRuntimeControl(control: RuntimeControl): () => void {
  GLOBAL.__IKRAN_RUNTIME_CONTROL = control;
  return () => {
    if (GLOBAL.__IKRAN_RUNTIME_CONTROL === control) {
      delete GLOBAL.__IKRAN_RUNTIME_CONTROL;
    }
  };
}

export function getRuntimeControl(): RuntimeControl | null {
  return GLOBAL.__IKRAN_RUNTIME_CONTROL ?? null;
}

/** Shared HTTP/MCP command seam for async work that must drain on shutdown. */
export async function withRuntimeJob<T>(operation: () => Promise<T>): Promise<T> {
  const control = getRuntimeControl();
  if (control?.acceptingJobs && !control.acceptingJobs()) {
    throw new Error("Ikran Runtime is shutting down.");
  }
  const release = control?.lifecycle.acquire("job") ?? (() => {});
  try {
    return await operation();
  } finally {
    release();
  }
}
