"use client";

import { useEffect, useState } from "react";

export const WORKBENCH_TOAST_VISIBLE_MS = 2_000;
export const WORKBENCH_TOAST_FADE_MS = 300;

export type WorkbenchToastPhase = "visible" | "exiting" | "hidden";

export function workbenchToastPhaseAt(elapsedMs: number): WorkbenchToastPhase {
  if (elapsedMs < WORKBENCH_TOAST_VISIBLE_MS) return "visible";
  if (elapsedMs < WORKBENCH_TOAST_VISIBLE_MS + WORKBENCH_TOAST_FADE_MS) {
    return "exiting";
  }
  return "hidden";
}

export function WorkbenchToastAlert({
  message,
  testId
}: {
  message: string | null;
  testId: string;
}) {
  const [phase, setPhase] = useState<WorkbenchToastPhase>(
    message ? "visible" : "hidden"
  );

  useEffect(() => {
    if (!message) {
      setPhase("hidden");
      return;
    }

    setPhase("visible");
    const fadeTimer = setTimeout(
      () => setPhase("exiting"),
      WORKBENCH_TOAST_VISIBLE_MS
    );
    const hideTimer = setTimeout(
      () => setPhase("hidden"),
      WORKBENCH_TOAST_VISIBLE_MS + WORKBENCH_TOAST_FADE_MS
    );

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [message, testId]);

  if (!message || phase === "hidden") return null;

  return (
    <p
      className={
        phase === "exiting"
          ? "seed-workbench__toast-error seed-workbench__toast-error--exiting"
          : "seed-workbench__toast-error"
      }
      role="alert"
      aria-live="polite"
      data-testid={testId}
    >
      {message}
    </p>
  );
}
