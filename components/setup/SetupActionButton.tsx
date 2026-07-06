"use client";

import { WorkbenchButton } from "@/components/workbench";

export function SetupActionButton({
  label,
  disabled = false,
  onClick
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <WorkbenchButton
      variant="primaryAction"
      data-testid="start-building-button"
      disabled={disabled}
      onClick={onClick}
    >
      <span>{label}</span>
    </WorkbenchButton>
  );
}
