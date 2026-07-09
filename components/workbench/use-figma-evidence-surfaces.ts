"use client";

// Issue 05 — Runtime-owned Figma Evidence Surfaces for the tldraw Workbench.
//
// Mirrors `use-seed-references.ts`: GET + light poll of `/api/evidence-package`
// so Agent-written surfaces appear without a manual refresh. Zero Figma network
// — only the local Runtime API.
//
// Signature change detection avoids churning tldraw re-syncs when the poll
// returns an unchanged set (ids + projection-relevant fields).

import { useCallback, useEffect, useRef, useState } from "react";
import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";

export type FigmaEvidenceSurfacesStatus = "idle" | "loading" | "ready";

const POLL_INTERVAL_MS = 1500;

/** Projection-relevant signature so polls only update state when UI fields change. */
function surfaceSignature(records: FigmaEvidenceSurfaceRecord[]): string {
  return records
    .map(
      (r) =>
        [
          r.id,
          r.seed_reference_id ?? "",
          r.figma_seed_reference,
          r.frame_name,
          r.screenshot_data_url ?? "",
          r.screenshot_artifact_path ?? "",
          r.surface_bounds_json ?? "",
          r.frame_bounds_json ?? ""
        ].join(":")
    )
    .join("|");
}

export function useFigmaEvidenceSurfaces(session: string) {
  const [records, setRecords] = useState<FigmaEvidenceSurfaceRecord[]>([]);
  const [status, setStatus] = useState<FigmaEvidenceSurfacesStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const aliveRef = useRef(true);

  const load = useCallback(async (): Promise<
    { ok: true } | { ok: false; error: string }
  > => {
    try {
      const response = await fetch("/api/evidence-package", {
        method: "GET",
        cache: "no-store",
        headers: { "x-ikran-session": sessionRef.current }
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        records?: FigmaEvidenceSurfaceRecord[];
        error?: string;
      };
      if (!response.ok || !data.ok) {
        return { ok: false, error: data.error ?? "load_failed" };
      }
      const next = data.records ?? [];
      setRecords((prev) =>
        surfaceSignature(prev) === surfaceSignature(next) ? prev : next
      );
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, []);

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
    return load();
  }, [load]);

  return { records, status, error, reload };
}
