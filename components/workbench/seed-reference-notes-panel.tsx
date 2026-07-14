"use client";

import { useWorkbenchSeedActions } from "./workbench-seed-actions";
import { SeedReferenceTextPanel } from "./seed-reference-text-panel";

export function SeedReferenceNotesPanel({
  seedId,
  note,
  onClose
}: {
  seedId: string;
  note: string;
  onClose: () => void;
}) {
  const actions = useWorkbenchSeedActions();
  return (
    <SeedReferenceTextPanel
      value={note}
      valueKey={seedId}
      label="Notes"
      actionLabel="note"
      closeAriaLabel="Close notes"
      dialogLabel="Reference note"
      placeholder="Add a note for this frame…"
      testIdPrefix="seed-reference-notes"
      unavailableMessage="Notes are unavailable right now."
      failureMessage="Could not save note. Try again."
      onPersist={
        actions
          ? (next) => actions.updateSeedReferenceNote(seedId, next)
          : undefined
      }
      onClose={onClose}
    />
  );
}
