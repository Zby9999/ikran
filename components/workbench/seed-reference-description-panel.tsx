"use client";

import { useWorkbenchSeedActions } from "./workbench-seed-actions";
import { SeedReferenceTextPanel } from "./seed-reference-text-panel";

export function SeedReferenceDescriptionPanel({
  description,
  onClose
}: {
  description: string;
  onClose: () => void;
}) {
  const actions = useWorkbenchSeedActions();
  return (
    <SeedReferenceTextPanel
      value={description}
      valueKey="project-description"
      label="Description"
      actionLabel="description"
      closeAriaLabel="Close description"
      dialogLabel="Design language description"
      placeholder="Add a design language description…"
      testIdPrefix="seed-reference-description"
      unavailableMessage="Description is unavailable right now."
      failureMessage="Could not save description. Try again."
      onPersist={actions?.updateDesignLanguageDescription}
      onClose={onClose}
    />
  );
}
