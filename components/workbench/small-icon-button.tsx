"use client";

import type { ComponentProps } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "@/lib/utils";

export function SmallIconButton({
  icon,
  label,
  className,
  iconSize = 14,
  strokeWidth = 1.5,
  loading = false,
  disabled,
  ...props
}: ComponentProps<"button"> & {
  icon: IconSvgElement;
  label: string;
  iconSize?: number;
  strokeWidth?: number;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-busy={loading || undefined}
      className={cn(
        "small-icon-button",
        loading && "small-icon-button--loading",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="small-icon-button__spinner" aria-hidden="true" />
      ) : (
        <HugeiconsIcon
          className="small-icon-button__icon"
          icon={icon}
          size={iconSize}
          color="currentColor"
          // Figma mini icons are 14×14 with stroke-width 0.875. Hugeicons uses a
          // 24×24 viewBox, so the matching strokeWidth is (0.875/14)*24 = 1.5.
          strokeWidth={strokeWidth}
        />
      )}
    </button>
  );
}
