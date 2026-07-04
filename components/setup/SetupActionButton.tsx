"use client";

export function SetupActionButton({
  label,
  disabled = false
}: {
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="action"
      data-testid="start-building-button"
      disabled={disabled}
      type="button"
    >
      <span>{label}</span>
    </button>
  );
}
