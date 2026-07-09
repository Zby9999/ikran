"use client";

import type { ComponentProps } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "@/lib/utils";

export function SmallIconButton({
  icon,
  label,
  className,
  ...props
}: ComponentProps<"button"> & {
  icon: IconSvgElement;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn("small-icon-button", className)}
      {...props}
    >
      <HugeiconsIcon
        className="small-icon-button__icon"
        icon={icon}
        size={14}
        color="currentColor"
        // Figma 134:429 arrow-left-01: stroke #575757, stroke-width 0.875
        // (was 1.7 / inherited #3d3d3d — looked larger and heavier).
        strokeWidth={0.875}
      />
    </button>
  );
}
