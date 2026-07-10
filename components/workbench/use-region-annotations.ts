"use client";

// Issue 06 — Runtime-owned Region Annotations for the tldraw Workbench.
//
// Mirrors `use-figma-evidence-surfaces.ts`: GET + light poll of
// `/api/region-annotation` so Agent-written annotations appear without a
// manual refresh. Zero Figma network — only the local Runtime API.
//
// Signature change detection avoids churning tldraw re-syncs when the poll
// returns an unchanged set (ids + projection-relevant fields).

import { useCallback, useEffect, useRef, useState } from "react";
import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";

export type RegionAnnotationsStatus = "idle" | "loading" | "ready";

const POLL_INTERVAL_MS = 1500;

/** Projection-relevant signature so polls only update state when UI fields change. */
function annotationSignature(records: RegionAnnotationRecord[]): string {
  return records
    .map(
      (r) =>
        [
          r.id,
          r.surface_id ?? "",
          r.surface_artifact_id ?? "",
          r.author,
          r.type,
          r.rect_x,
          r.rect_y,
          r.rect_w,
          r.rect_h
        ].join(":")
    )
    .join("|");
}

export function useRegionAnnotations(session: string) {
  const [records, setRecords] = useState<RegionAnnotationRecord[]>([]);
  const [status, setStatus] = useState<RegionAnnotationsStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const aliveRef = useRef(true);

  const load = useCallback(async (): Promise<
    { ok: true } | { ok: false; error: string }
  > => {
    try {
      const response = await fetch("/api/region-annotation", {
        method: "GET",
        cache: "no-store",
        headers: { "x-ikran-session": sessionRef.current }
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        records?: RegionAnnotationRecord[];
        error?: string;
      };
      if (!response.ok || !data.ok) {
        return { ok: false, error: data.error ?? "load_failed" };
      }
      const next = data.records ?? [];
      setRecords((prev) =>
        annotationSignature(prev) === annotationSignature(next) ? prev : next
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

  /** Optimistic remove after a successful designer Delete (poll will confirm). */
  const removeLocal = useCallback((annotationId: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== annotationId));
  }, []);

  return { records, status, error, reload, removeLocal };
}
