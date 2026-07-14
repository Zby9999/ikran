"use client";

// Inside <Tldraw>: user-pasted URLs must not create arbitrary canvas shapes.
// Runtime-owned Prototype Evidence Surfaces remain valid embed shapes.

import { useEffect } from "react";
import { useEditor } from "tldraw";
import { isFigmaDesignUrl, isFigmaEmbedUrl } from "./workbench-embeds";

/**
 * Prevents tldraw from turning pasted links into iframe embeds or bookmarks.
 * Figma design/file URLs are swallowed here; SeedEvidenceWorkbench paste owns
 * Runtime capture. Every other URL is ignored so random sites cannot embed.
 */
export function FigmaEmbedPasteGuard() {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;

    // Replace default URL handler (embed-on-paste / bookmark unfurl).
    editor.registerExternalContentHandler("url", async (content) => {
      if (isFigmaDesignUrl(content.url)) {
        // Swallow — Workbench paste owns Runtime capture for Figma URLs.
        return;
      }
      // Non-Figma URLs must not become bookmarks or embeds.
    });

    // Block iframe HTML / arbitrary embed external content.
    editor.registerExternalContentHandler("embed", () => {
      return;
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const purgeFigmaEmbeds = () => {
      const doomed = editor
        .getCurrentPageShapes()
        .filter((shape) => {
          if (shape.type === "embed") {
            const url = (shape as { props?: { url?: string } }).props?.url;
            return isFigmaEmbedUrl(url);
          }
          if (shape.type === "bookmark") {
            const url = (shape as { props?: { url?: string } }).props?.url;
            return isFigmaEmbedUrl(url);
          }
          return false;
        })
        .map((s) => s.id);
      if (doomed.length > 0) {
        editor.deleteShapes(doomed);
      }
    };

    purgeFigmaEmbeds();
    const unsub = editor.store.listen(purgeFigmaEmbeds, {
      source: "user",
      scope: "document"
    });
    return () => unsub();
  }, [editor]);

  return null;
}
