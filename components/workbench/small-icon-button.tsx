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
        // Figma mini icons are 14×14 with stroke-width 0.875. Hugeicons uses a
        // 24×24 viewBox, so the matching strokeWidth is (0.875/14)*24 = 1.5.
        // Passing 0.875 here made strokes ~0.51px and looked much thinner.
        strokeWidth={1.5}
      />
    </button>
  );
}
