"use client";

import { useEffect } from "react";
import { useEditor } from "tldraw";
import { focusWorkbenchProjection } from "./focus-seed-reference-projection";

/**
 * After duplicate paste (or a Build panel page selection), select + zoom the
 * existing projection. Retries while `seedId` is set so projection sync can
 * create/update the shape first.
 */
export function FocusSeedProjectionController({
  seedId,
  projectionEpoch = 0,
  onFocused
}: {
  seedId: string | null;
  /** Bumps when Runtime projections change so focus can retry. */
  projectionEpoch?: number;
  onFocused?: () => void;
}) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor || !seedId) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tryFocus = () => {
      if (cancelled) return;
      attempts += 1;
      const focused = focusWorkbenchProjection(editor, seedId);
      if (focused) {
        onFocused?.();
        return;
      }
      if (attempts < maxAttempts) {
        timer = setTimeout(tryFocus, 50);
      }
    };

    tryFocus();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [editor, seedId, projectionEpoch, onFocused]);

  return null;
}
