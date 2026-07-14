"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent
} from "react";
import {
  Delete02Icon,
  Edit02Icon,
  MultiplicationSignIcon,
  SaveIcon
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEditor, useValue } from "tldraw";
import { cn } from "@/lib/utils";
import { SEED_REF_TIP_GAP_PX } from "./seed-reference-description-tip";

type AnchorStyle = CSSProperties & { "--seed-ref-tip-gap": string };
type PanelStyle = CSSProperties & { "--seed-ref-tip-scale": string };
type PersistResult = { ok: true } | { ok: false; error: string };

export function SeedReferenceTextPanel({
  value,
  valueKey,
  label,
  actionLabel,
  closeAriaLabel,
  dialogLabel,
  placeholder,
  testIdPrefix,
  unavailableMessage,
  failureMessage,
  onPersist,
  onClose
}: {
  value: string;
  valueKey: string;
  label: string;
  actionLabel: string;
  closeAriaLabel: string;
  dialogLabel: string;
  placeholder: string;
  testIdPrefix: string;
  unavailableMessage: string;
  failureMessage: string;
  onPersist?: (next: string) => Promise<PersistResult>;
  onClose: () => void;
}) {
  const editor = useEditor();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(() => !value.trim());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
    setEditing(!value.trim());
  }, [value, valueKey]);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);

  const zoom = useValue(
    `${testIdPrefix}-zoom`,
    () => {
      const level = editor.getZoomLevel();
      return level > 0 ? level : 1;
    },
    [editor]
  );

  const stop = (event: SyntheticEvent) => event.stopPropagation();
  const canWrite = Boolean(onPersist);
  const dirty = draft !== value;

  const persist = async (next: string) => {
    if (!onPersist) {
      setError(unavailableMessage);
      return false;
    }
    if (next === value) return true;
    setSaving(true);
    setError(null);
    const result = await onPersist(next);
    setSaving(false);
    if (!result.ok) {
      setError(failureMessage);
      return false;
    }
    return true;
  };

  const handleSave = () => {
    if (saving || !canWrite || !dirty) return;
    void persist(draft).then((ok) => {
      if (ok) setEditing(false);
    });
  };

  const handleDelete = () => {
    if (saving || !canWrite) return;
    setDraft("");
    setEditing(true);
    void persist("");
  };

  const handleClose = () => {
    if (saving) return;
    void (async () => {
      if (dirty && !(await persist(draft))) return;
      onClose();
    })();
  };

  const anchorStyle: AnchorStyle = {
    "--seed-ref-tip-gap": `${SEED_REF_TIP_GAP_PX}px`
  };
  const panelStyle: PanelStyle = {
    "--seed-ref-tip-scale": String(1 / zoom),
    transform: "scale(var(--seed-ref-tip-scale))",
    transformOrigin: "right bottom"
  };
  const showEmpty = !draft.trim();

  return (
    <div
      className="seed-ref-frame__notes-anchor"
      style={anchorStyle}
      onPointerDown={stop}
      onMouseDown={stop}
    >
      <div
        className="seed-ref-frame__notes-panel"
        data-testid={`${testIdPrefix}-panel`}
        data-editing={editing ? "true" : "false"}
        role="dialog"
        aria-label={dialogLabel}
        style={panelStyle}
      >
        <div className="seed-ref-frame__notes-header">
          <p className="seed-ref-frame__notes-label">{label}</p>
          <div className="seed-ref-frame__notes-header-actions">
            {dirty ? (
              <button
                type="button"
                className="seed-ref-frame__notes-icon-btn"
                data-testid={`${testIdPrefix}-save`}
                aria-label={`Save ${actionLabel}`}
                disabled={saving || !canWrite}
                onPointerDown={stop}
                onMouseDown={stop}
                onClick={handleSave}
              >
                <HugeiconsIcon
                  icon={SaveIcon}
                  size={14}
                  color="currentColor"
                  strokeWidth={1.5}
                />
              </button>
            ) : null}
            <button
              type="button"
              className="seed-ref-frame__notes-icon-btn"
              data-testid={`${testIdPrefix}-clear`}
              aria-label={`Clear ${actionLabel}`}
              disabled={saving || (!draft && !value) || !canWrite}
              onPointerDown={stop}
              onMouseDown={stop}
              onClick={handleDelete}
            >
              <HugeiconsIcon
                icon={Delete02Icon}
                size={14}
                color="currentColor"
                strokeWidth={1.5}
              />
            </button>
            <button
              type="button"
              className={cn(
                "seed-ref-frame__notes-icon-btn",
                editing && "seed-ref-frame__notes-icon-btn--active"
              )}
              data-testid={`${testIdPrefix}-edit`}
              aria-label={
                editing ? "Done editing" : `Edit ${actionLabel}`
              }
              aria-pressed={editing}
              disabled={saving || !canWrite}
              onPointerDown={stop}
              onMouseDown={stop}
              onClick={() => {
                if (!saving) setEditing((current) => !current);
              }}
            >
              <HugeiconsIcon
                icon={Edit02Icon}
                size={14}
                color="currentColor"
                strokeWidth={1.5}
              />
            </button>
            <button
              type="button"
              className="seed-ref-frame__notes-icon-btn"
              data-testid={`${testIdPrefix}-cancel`}
              aria-label={closeAriaLabel}
              disabled={saving}
              onPointerDown={stop}
              onMouseDown={stop}
              onClick={handleClose}
            >
              <HugeiconsIcon
                icon={MultiplicationSignIcon}
                size={14}
                color="currentColor"
                strokeWidth={1.5}
              />
            </button>
          </div>
        </div>

        <div className="seed-ref-frame__notes-body">
          {editing ? (
            <textarea
              ref={inputRef}
              className="seed-ref-frame__notes-input"
              data-testid={`${testIdPrefix}-input`}
              value={draft}
              placeholder={placeholder}
              rows={3}
              disabled={saving || !canWrite}
              onPointerDown={stop}
              onMouseDown={stop}
              onChange={(event) => setDraft(event.target.value)}
            />
          ) : (
            <p
              className={cn(
                "seed-ref-frame__notes-text",
                showEmpty && "seed-ref-frame__notes-text--empty"
              )}
              data-testid={`${testIdPrefix}-text`}
            >
              {showEmpty ? placeholder : draft}
            </p>
          )}
          {error ? (
            <p className="seed-ref-frame__notes-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
