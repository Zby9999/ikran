"use client";

// Inside <Tldraw>: block Figma URL → embed/bookmark, purge any Figma embeds.

import { useEffect } from "react";
import {
  createBookmarkFromUrl,
  useEditor,
  type TLEmbedShape
} from "tldraw";
import { isFigmaDesignUrl, isFigmaEmbedUrl } from "./workbench-embeds";

/**
 * Prevents tldraw from turning pasted Figma links into iframe embeds (or
 * bookmarks). Capture still happens via SeedEvidenceWorkbench paste handler.
 */
export function FigmaEmbedPasteGuard() {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;

    editor.registerExternalContentHandler("url", async (content) => {
      if (isFigmaDesignUrl(content.url)) {
        // Swallow — Workbench paste owns Runtime capture for Figma URLs.
        return;
      }
      const position =
        content.point ??
        (editor.inputs.getShiftKey()
          ? editor.inputs.getCurrentPagePoint()
          : editor.getViewportPageBounds().center);
      await createBookmarkFromUrl(editor, {
        url: content.url,
        center: position
      });
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const purgeFigmaEmbeds = () => {
      const doomed = editor
        .getCurrentPageShapes()
        .filter((shape) => {
          if (shape.type === "embed") {
            return isFigmaEmbedUrl((shape as TLEmbedShape).props.url);
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
