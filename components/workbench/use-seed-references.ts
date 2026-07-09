"use client";

// Issue 02/04 — Runtime-owned seed references for the tldraw Workbench.
//
// This hook is the Browser UI <-> Runtime boundary for the NEW seed entry path:
//
//   EnterPanel -> POST /api/seed-reference -> seed_references record -> tldraw projection
//
// Browser UI <-> Runtime boundary for seed entry. It does NOT call `/api/tasks`
// and does NOT touch Figma network validation — Runtime owns local format
// checks on POST /api/seed-reference.
//
// Responsibilities:
//   - load records: GET /api/seed-reference (authoritative read of the Runtime
//     `seed_references` table — the source of truth).
//   - register: POST /api/seed-reference (semantic record-write boundary).
//   - light polling: refresh records every ~1.5s so a projection appears when a
//     real Agent registers a seed reference via the `register_seed_reference`
//     MCP tool, without the UI needing to refresh.
//
// The hook NEVER invents records: `records` is populated only from Runtime
// data. tldraw geometry is never read back here — only the records are.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";

export type SeedReferencesStatus = "idle" | "loading" | "ready";

export interface SeedReferenceRegisterInput {
  figmaSeedReference: string;
  originalDesignIntent: string;
  /** Always `"ui"` for EnterPanel / plus — drives guide (no spinner) awaiting UX. */
  registeredVia?: "ui" | "agent";
}

export interface SeedReferenceRegisterResult {
  ok: boolean;
  /** Runtime structured error reason on failure (e.g. invalid_figma_url). */
  error?: string;
  /** The registered record on success (from the Runtime response). */
  record?: SeedReferenceRecord;
}

// Light polling cadence for Agent-written records (Issue 02/04 guidance:
// 1-2s). Deliberately coarse — this is the "better but still simple" option;
// the minimum-acceptable path is refresh-based.
const POLL_INTERVAL_MS = 1500;

export function useSeedReferences(session: string) {
  const [records, setRecords] = useState<SeedReferenceRecord[]>([]);
  const [status, setStatus] = useState<SeedReferencesStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const aliveRef = useRef(true);

  const load = useCallback(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const response = await fetch("/api/seed-reference", {
        method: "GET",
        cache: "no-store",
        headers: { "x-ikran-session": sessionRef.current }
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        records?: SeedReferenceRecord[];
        error?: string;
      };
      if (!response.ok || !data.ok) {
        return { ok: false, error: data.error ?? "load_failed" };
      }
      const next = data.records ?? [];
      // Only replace state when the record set actually changed, so the
      // light polling does not churn tldraw shape re-syncs every tick.
      setRecords((prev) => {
        const prevSig = prev
          .map((r) => `${r.id}:${r.registered_via ?? "agent"}`)
          .join("|");
        const nextSig = next
          .map((r) => `${r.id}:${r.registered_via ?? "agent"}`)
          .join("|");
        return prevSig === nextSig ? prev : next;
      });
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, []);

  // Initial load + light polling for records a real Agent may write.
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;

    (async () => {
      setStatus("loading");
      const result = await load();
      if (cancelled) return;
      setStatus("ready");
      if (!result.ok) setError(result.error);
    })();

    const interval = setInterval(async () => {
      if (!aliveRef.current) return;
      const result = await load();
      if (!cancelled && result.ok) setError(null);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      aliveRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  const reload = useCallback(async () => {
    const result = await load();
    return result;
  }, [load]);

  // Semantic record-write: POST /api/seed-reference. On success, refresh
  // records from the Runtime so the projection is built from the source of
  // truth (not a client-invented object). On validation failure, return the
  // structured error WITHOUT writing a record (the Runtime guarantees this).
  const register = useCallback(
    async (
      input: SeedReferenceRegisterInput
    ): Promise<SeedReferenceRegisterResult> => {
      try {
        const response = await fetch("/api/seed-reference", {
          method: "POST",
          headers: {
            "x-ikran-session": sessionRef.current,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(input)
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          record?: SeedReferenceRecord;
        };
        if (!response.ok || !data.ok) {
          return { ok: false, error: data.error ?? "register_failed" };
        }
        // Refresh from the Runtime source of truth so tldraw projects the
        // committed record (with its real id), not a client-side guess.
        await load();
        return { ok: true, record: data.record };
      } catch {
        return { ok: false, error: "network" };
      }
    },
    [load]
  );

  return { records, status, error, register, reload };
}