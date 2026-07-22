"use client";

import { useEffect } from "react";

const RECENT_INTERACTION_MS = 30_000;
const PRESENCE_REPORT_MS = 15_000;
const SEMANTIC_ACTIVITY_EVENT = "ikran:workbench-semantic-activity";

export function announceWorkbenchSemanticActivity(): void {
  window.dispatchEvent(new Event(SEMANTIC_ACTIVITY_EVENT));
}

export function useWorkbenchPresence(session: string): void {
  useEffect(() => {
    let lastInteractionAt = 0;
    let dirty = false;
    let semanticActivity = false;
    const payload = (closed = false) => ({
      visible: document.visibilityState === "visible",
      focused: document.hasFocus(),
      recentInteraction: lastInteractionAt > 0 && Date.now() - lastInteractionAt <= RECENT_INTERACTION_MS,
      dirty,
      semanticActivity,
      closed
    });
    const report = (closed = false) => {
      const body = JSON.stringify(payload(closed));
      semanticActivity = false;
      if (closed) {
        navigator.sendBeacon(`/api/workbench-presence?session=${encodeURIComponent(session)}`, body);
        return;
      }
      void fetch("/api/workbench-presence", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ikran-session": session },
        body,
        keepalive: true
      }).catch(() => undefined);
    };
    const markInteraction = () => { lastInteractionAt = Date.now(); report(); };
    const markDirty = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) dirty = true;
      markInteraction();
    };
    const markSemantic = () => { dirty = false; semanticActivity = true; lastInteractionAt = Date.now(); report(); };
    const reportState = () => report();
    const close = () => report(true);
    let heartbeat: number | null = null;
    const scheduleHeartbeat = () => {
      heartbeat = window.setTimeout(() => {
        reportState();
        scheduleHeartbeat();
      }, PRESENCE_REPORT_MS);
    };

    document.addEventListener("pointerdown", markInteraction, true);
    document.addEventListener("keydown", markInteraction, true);
    document.addEventListener("input", markDirty, true);
    document.addEventListener("submit", markSemantic, true);
    document.addEventListener("visibilitychange", reportState);
    window.addEventListener("focus", reportState);
    window.addEventListener("blur", reportState);
    window.addEventListener("pagehide", close);
    window.addEventListener(SEMANTIC_ACTIVITY_EVENT, markSemantic);
    scheduleHeartbeat();
    report();
    return () => {
      if (heartbeat !== null) window.clearTimeout(heartbeat);
      document.removeEventListener("pointerdown", markInteraction, true);
      document.removeEventListener("keydown", markInteraction, true);
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("submit", markSemantic, true);
      document.removeEventListener("visibilitychange", reportState);
      window.removeEventListener("focus", reportState);
      window.removeEventListener("blur", reportState);
      window.removeEventListener("pagehide", close);
      window.removeEventListener(SEMANTIC_ACTIVITY_EVENT, markSemantic);
    };
  }, [session]);
}
