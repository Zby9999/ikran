"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";
import type { InFlightSeedCapture } from "./projection/seed-projection";
import {
  findExistingSeedIdForPasteUrl,
  hasInFlightSeedForPasteUrl
} from "./find-existing-seed-for-paste";
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
 * frames, duplicate focus (no loading frame), and fail-closed alert copy.
 */
export function useFigmaPasteCapture(opts: {
  canvasLocked: boolean;
  gateOpen: boolean;
  /** Current Runtime seeds — used to short-circuit duplicate paste locally. */
  seeds: readonly SeedReferenceRecord[];
  captureSeedReference: (url: string) => Promise<CaptureResult>;
}): {
  pasteError: string | null;
  inFlightCaptures: InFlightSeedCapture[];
  /** Seed id to focus after duplicate paste; cleared by Workbench once applied. */
  focusSeedId: string | null;
  clearFocusSeedId: () => void;
} {
  const { canvasLocked, gateOpen, seeds, captureSeedReference } = opts;
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [inFlightCaptures, setInFlightCaptures] = useState<
    InFlightSeedCapture[]
  >([]);
  const [focusSeedId, setFocusSeedId] = useState<string | null>(null);
  const pasteErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seedsRef = useRef(seeds);
  const inFlightRef = useRef(inFlightCaptures);
  seedsRef.current = seeds;
  inFlightRef.current = inFlightCaptures;

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

      // Same canonical file+node is already projected from Runtime records.
      // Focus it directly: no capture request and no optimistic loading frame.
      const existingId = findExistingSeedIdForPasteUrl(seedsRef.current, url);
      if (existingId) {
        setFocusSeedId(existingId);
        return;
      }
      if (hasInFlightSeedForPasteUrl(inFlightRef.current, url)) return;

      const inFlightId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `inflight-${Date.now()}`;
      const nextInFlight = [
        ...inFlightRef.current,
        { id: inFlightId, figmaSeedReference: url }
      ];
      inFlightRef.current = nextInFlight;
      setInFlightCaptures(nextInFlight);

      try {
        const result = await captureSeedReference(url);
        if (!result.ok) {
          showPasteError(
            PASTE_ERROR_BY_REASON[result.error] ??
              "Could not capture that Figma link. Check the URL and try again."
          );
        } else if (result.reused && result.seedId) {
          // Runtime-side reuse still handles races when local records were stale.
          setFocusSeedId(result.seedId);
        }
      } finally {
        const remaining = inFlightRef.current.filter((p) => p.id !== inFlightId);
        inFlightRef.current = remaining;
        setInFlightCaptures(remaining);
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
