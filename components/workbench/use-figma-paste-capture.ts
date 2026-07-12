"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InFlightSeedCapture } from "./projection/seed-projection";
import { extractFigmaDesignUrl, isMalformedFigmaPaste } from "./workbench-embeds";

type CaptureResult =
  | { ok: true; reused?: boolean; seedId?: string }
  | { ok: false; error: string };

const PASTE_ERROR_BY_REASON: Record<string, string> = {
  figma_connection_required:
    "Connect Figma before pasting a design link into the canvas.",
  missing_node_id: "Paste a Figma selection link that includes a node-id.",
  invalid_figma_url: "That does not look like a valid Figma design URL.",
  not_figma_host: "Paste a link from figma.com.",
  not_figma_design_path: "Paste a Figma design or file selection link.",
  forbidden: "Figma denied access to that file with the current token.",
  not_found: "Figma could not find that file or node.",
  rate_limited: "Figma rate-limited the request. Try again shortly.",
  screenshot_missing: "Figma did not return a screenshot for that node.",
  malformed_figma_response: "Figma returned an unexpected response.",
  invalid_token: "The Figma Connection is no longer valid. Reconnect."
};

/**
 * Window-level Figma paste capture: gate rejection, optimistic in-flight
 * frames, duplicate focus request, and fail-closed alert copy (no invented
 * toast chrome).
 */
export function useFigmaPasteCapture(opts: {
  canvasLocked: boolean;
  gateOpen: boolean;
  captureSeedReference: (url: string) => Promise<CaptureResult>;
}): {
  pasteError: string | null;
  inFlightCaptures: InFlightSeedCapture[];
  /** Seed id to focus after duplicate paste; cleared by Workbench once applied. */
  focusSeedId: string | null;
  clearFocusSeedId: () => void;
} {
  const { canvasLocked, gateOpen, captureSeedReference } = opts;
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [inFlightCaptures, setInFlightCaptures] = useState<
    InFlightSeedCapture[]
  >([]);
  const [focusSeedId, setFocusSeedId] = useState<string | null>(null);
  const pasteErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pasteErrorTimer.current) clearTimeout(pasteErrorTimer.current);
    };
  }, []);

  const showPasteError = useCallback((message: string) => {
    setPasteError(message);
    if (pasteErrorTimer.current) clearTimeout(pasteErrorTimer.current);
    pasteErrorTimer.current = setTimeout(() => setPasteError(null), 4000);
  }, []);

  const clearFocusSeedId = useCallback(() => {
    setFocusSeedId(null);
  }, []);

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const url = extractFigmaDesignUrl(text);
      if (!url) {
        if (isMalformedFigmaPaste(text)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          showPasteError("Paste a Figma design or file selection link.");
        }
        return;
      }

      // Capture phase + stopImmediatePropagation: tldraw must not also create
      // a Figma iframe embed (coexistence bug).
      event.preventDefault();
      event.stopImmediatePropagation();

      if (canvasLocked || !gateOpen) {
        showPasteError(
          "Connect Figma before pasting a design link into the canvas."
        );
        return;
      }

      const inFlightId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `inflight-${Date.now()}`;
      setInFlightCaptures((prev) => [
        ...prev,
        { id: inFlightId, figmaSeedReference: url }
      ]);

      try {
        const result = await captureSeedReference(url);
        if (!result.ok) {
          showPasteError(
            PASTE_ERROR_BY_REASON[result.error] ??
              "Could not capture that Figma link. Check the URL and try again."
          );
        } else if (result.reused && result.seedId) {
          setFocusSeedId(result.seedId);
        }
      } finally {
        setInFlightCaptures((prev) =>
          prev.filter((p) => p.id !== inFlightId)
        );
      }
    },
    [canvasLocked, gateOpen, captureSeedReference, showPasteError]
  );

  useEffect(() => {
    const onPaste = (event: Event) => {
      void handlePaste(event as ClipboardEvent);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [handlePaste]);

  return { pasteError, inFlightCaptures, focusSeedId, clearFocusSeedId };
}
