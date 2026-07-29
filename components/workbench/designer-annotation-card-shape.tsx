"use client";

// Issue 08A — Designer Annotation side card (filled annotation display).
// Docked beside the Evidence Surface by the projection sync; renders the
// annotation body in the designer-annotation green (Figma 670:891, node
// 670:895): tint #e9ffea, border #19d122. Green is the User Annotation color
// — cards are NOT section-colored; section only scopes which stage the
// annotation appears in.
// Click enters edit-in-place: the same entry form as creation (pre-filled);
// submit PATCHes the body via the injected Runtime mutation, Esc cancels.
//
// Runtime record stays the source of truth: body/section/anchorKind are
// projection props rewritten by the sync; `editing` is local UI state the
// sync preserves across updates (alignment-card precedent).

import {
  createContext,
  useContext,
  type ReactNode,
  type SyntheticEvent
} from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  useEditor,
  type Editor,
  type TLShape,
  type TLShapeId
} from "tldraw";
import { DesignerAnnotationEntryForm } from "./designer-annotation-entry-form";
import { useExclusiveDialog } from "./exclusive-dialog-context";
import type { DesignerAnnotationMutationResult } from "./designer-annotation-entry-context";
import type { DesignerAnnotationAnchorKind } from "./projection/designer-annotation-card-projection";

export const DESIGNER_ANNOTATION_CARD_TYPE = "designer-annotation-card" as const;

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "designer-annotation-card": {
      w: number;
      h: number;
      body: string;
      /** Six-part section id (scoping only, not visualized); "" for legacy. */
      section: string;
      anchorKind: DesignerAnnotationAnchorKind;
      placement: "left" | "right";
      /** Local UI state (preserved by the sync) — edit-in-place open. */
      editing: boolean;
    };
  }
}

export type DesignerAnnotationCardMeta = {
  canvasRecordId: string;
  /** Runtime `region_annotations.id`. */
  runtimeRecordId: string;
  surfaceRecordId: string;
};

export interface DesignerAnnotationCardShape
  extends TLShape<"designer-annotation-card"> {
  meta: DesignerAnnotationCardMeta;
}

/** Injected Runtime body-update mutation (canvas-level provider). */
const DesignerAnnotationCardActionsContext = createContext<{
  updateBody: (
    annotationId: string,
    body: string
  ) => Promise<DesignerAnnotationMutationResult>;
} | null>(null);

export function DesignerAnnotationCardActionsProvider({
  onUpdateBody,
  children
}: {
  onUpdateBody?: (
    annotationId: string,
    body: string
  ) => Promise<DesignerAnnotationMutationResult>;
  children: ReactNode;
}) {
  return (
    <DesignerAnnotationCardActionsContext.Provider
      value={{
        updateBody: (annotationId, body) =>
          onUpdateBody?.(annotationId, body) ??
          Promise.resolve({
            ok: false as const,
            error: "update_annotation_body_unavailable"
          })
      }}
    >
      {children}
    </DesignerAnnotationCardActionsContext.Provider>
  );
}

function stopPointer(event: SyntheticEvent) {
  event.stopPropagation();
}

/** Pure: which designer-annotation cards need their `editing` prop flipped
 *  so at most `activeId` stays open. Mirrors `alignmentCardEditorUpdates`. */
export function designerAnnotationCardEditorUpdates(
  cards: readonly { id: string; editing: boolean }[],
  activeId: string | null
) {
  return cards.flatMap((card) => {
    const editing = card.id === activeId;
    return card.editing === editing ? [] : [{ id: card.id, editing }];
  });
}

/** Close every designer-annotation card edit form except `activeId`. */
export function setOnlyOpenDesignerAnnotationCard(
  editor: Editor,
  activeId: string | null
) {
  const shapes = editor
    .getCurrentPageShapes()
    .filter(
      (shape): shape is DesignerAnnotationCardShape =>
        shape.type === DESIGNER_ANNOTATION_CARD_TYPE
    );
  const updates = designerAnnotationCardEditorUpdates(
    shapes.map((shape) => ({
      id: String(shape.id),
      editing: shape.props.editing
    })),
    activeId
  );
  if (updates.length === 0) return;
  editor.run(
    () => {
      for (const update of updates) {
        editor.updateShape<DesignerAnnotationCardShape>({
          id: update.id as TLShapeId,
          type: DESIGNER_ANNOTATION_CARD_TYPE,
          props: { editing: update.editing }
        });
      }
    },
    { ignoreShapeLock: true }
  );
}

export function DesignerAnnotationCardShapeView({
  shape
}: {
  shape: DesignerAnnotationCardShape;
}) {
  const editor = useEditor();
  const actions = useContext(DesignerAnnotationCardActionsContext);
  const exclusive = useExclusiveDialog();
  const { w, h, body, section, anchorKind, editing } = shape.props;

  function setEditing(next: boolean) {
    // Single-active-dialog: route through the canvas-wide coordinator when
    // available so opening this edit form closes every other input dialog
    // (alignment cards, other annotation cards, the pending entry draft).
    if (exclusive) {
      if (next) {
        exclusive.openDialog({
          family: "designer-annotation",
          id: String(shape.id)
        });
      } else {
        exclusive.closeDialogs();
      }
      return;
    }
    editor.run(
      () =>
        editor.updateShape<DesignerAnnotationCardShape>({
          id: shape.id,
          type: DESIGNER_ANNOTATION_CARD_TYPE,
          props: { editing: next }
        }),
      { ignoreShapeLock: true }
    );
  }

  return (
    <HTMLContainer
      data-testid="designer-annotation-card"
      data-runtime-record-id={shape.meta.runtimeRecordId}
      data-surface-record-id={shape.meta.surfaceRecordId}
      data-section={section || undefined}
      data-anchor-kind={anchorKind}
      data-editing={editing ? "true" : "false"}
      style={{ width: w, height: h, pointerEvents: "all", overflow: "visible" }}
    >
      {editing ? (
        <DesignerAnnotationEntryForm
          testId="designer-annotation-card-edit"
          className="designer-annotation-entry--card"
          initialBody={body}
          onSubmit={async (nextBody) => {
            const result = await actions?.updateBody(
              shape.meta.runtimeRecordId,
              nextBody
            );
            if (result?.ok) setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <article
          className="designer-annotation-card"
          onMouseDown={stopPointer}
          onPointerDown={stopPointer}
          onClick={(event) => {
            event.stopPropagation();
            setEditing(true);
          }}
        >
          <p className="designer-annotation-card__body">{body}</p>
        </article>
      )}
    </HTMLContainer>
  );
}

export class DesignerAnnotationCardShapeUtil extends BaseBoxShapeUtil<DesignerAnnotationCardShape> {
  static override type = DESIGNER_ANNOTATION_CARD_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    body: T.string,
    section: T.string,
    anchorKind: T.literalEnum("figma-node", "figma-region", "figma-surface"),
    placement: T.literalEnum("left", "right"),
    editing: T.boolean
  };

  getDefaultProps(): DesignerAnnotationCardShape["props"] {
    return {
      w: 319,
      h: 64,
      body: "",
      section: "",
      anchorKind: "figma-region",
      placement: "right",
      editing: false
    };
  }

  override canEdit() {
    return false;
  }

  override canResize() {
    return false;
  }

  override hideResizeHandles() {
    return true;
  }

  override hideRotateHandle() {
    return true;
  }

  override hideSelectionBoundsBg() {
    return true;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  override component(shape: DesignerAnnotationCardShape) {
    return <DesignerAnnotationCardShapeView shape={shape} />;
  }

  override getIndicatorPath() {
    return undefined;
  }
}
