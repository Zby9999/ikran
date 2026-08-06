"use client";

// Issue 08A — shared Designer Annotation text entry form.
// Used for the freshly placed marker (create entry) and for editing an
// existing card body (pre-filled).
// UX per Figma 670:891 (edit mode, node 670:900): white card with the
// designer-annotation green border, placeholder "Add your design intent...",
// round green send button on the right. Enter submits, Shift+Enter inserts a
// newline, Esc cancels.

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type SyntheticEvent
} from "react";
import { ArrowUpIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

export const DESIGNER_ANNOTATION_PLACEHOLDER = "Add your design intent...";

function stopPointer(event: SyntheticEvent) {
  event.stopPropagation();
}

export function DesignerAnnotationEntryForm({
  initialBody = "",
  submitting = false,
  onSubmit,
  onCancel,
  onHeightChange,
  testId = "designer-annotation-entry",
  className
}: {
  initialBody?: string;
  submitting?: boolean;
  onSubmit: (body: string) => void | Promise<void>;
  onCancel: () => void;
  /** Fires when the form's laid-out height changes (create + in-card edit). */
  onHeightChange?: (height: number) => void;
  testId?: string;
  /** Extra form class — e.g. the in-card variant that fills the card's box. */
  className?: string;
}) {
  const [draft, setDraft] = useState(initialBody);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }, []);

  // Auto-grow: the box tracks the typed content line by line (capped by CSS
  // max-height, then scrolls). Runs on mount too so a pre-filled edit box
  // opens at its true height.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || !onHeightChange) return;
    const notify = () => onHeightChange(form.offsetHeight);
    notify();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(notify);
    observer.observe(form);
    return () => observer.disconnect();
  }, [onHeightChange, draft]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || submitting) return;
    void onSubmit(body);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Keep tldraw tool shortcuts (incl. Escape) out while typing.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      ref={formRef}
      className={["designer-annotation-entry", className]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
      onSubmit={submit}
      onMouseDown={stopPointer}
      onPointerDown={stopPointer}
      onClick={stopPointer}
    >
      <textarea
        ref={textareaRef}
        className="designer-annotation-entry__textarea"
        data-testid={`${testId}-input`}
        placeholder={DESIGNER_ANNOTATION_PLACEHOLDER}
        rows={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button
        type="submit"
        size="icon"
        className="designer-annotation-entry__send"
        data-testid={`${testId}-submit`}
        disabled={!draft.trim() || submitting}
        aria-label="Submit annotation"
      >
        <ArrowUpIcon size={14} weight="bold" />
      </Button>
    </form>
  );
}
