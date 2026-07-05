"use client";

import { WorkbenchButton } from "@/components/workbench";

export function SetupActionButton({
  label,
  disabled = false
}: {
  label: string;
  disabled?: boolean;
}) {
  return (
    <WorkbenchButton
      variant="primaryAction"
      data-testid="start-building-button"
      disabled={disabled}
    >
      <span>{label}</span>
    </WorkbenchButton>
  );
}
