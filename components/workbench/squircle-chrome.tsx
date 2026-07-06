"use client";

import { getSvgPath } from "figma-squircle";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const OUTER_RING_PX = 1;

type SquircleChromeProps = {
  className?: string;
  surfaceClassName?: string;
  surfaceTag?: "div" | "section";
  surfaceProps?: Record<string, unknown>;
  cornerRadius?: number;
  cornerSmoothing?: number;
  children: ReactNode;
};

export function SquircleChrome({
  className,
  surfaceClassName,
  surfaceTag = "div",
  surfaceProps,
  cornerRadius = 16,
  cornerSmoothing = 0.6,
  children
}: SquircleChromeProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const surface = surfaceRef.current;
    if (!shell || !surface || typeof ResizeObserver === "undefined") return;

    const update = () => {
      const width = shell.offsetWidth;
      const height = shell.offsetHeight;
      if (!width || !height) return;

      shell.style.clipPath = `path('${getSvgPath({
        width,
        height,
        cornerRadius,
        cornerSmoothing
      })}')`;

      const innerWidth = surface.offsetWidth;
      const innerHeight = surface.offsetHeight;
      if (!innerWidth || !innerHeight) return;

      surface.style.clipPath = `path('${getSvgPath({
        width: innerWidth,
        height: innerHeight,
        cornerRadius: Math.max(0, cornerRadius - OUTER_RING_PX),
        cornerSmoothing
      })}')`;
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [cornerRadius, cornerSmoothing]);

  const SurfaceTag = surfaceTag;

  return (
    <div ref={shellRef} className={cn("squircle-chrome", className)}>
      <SurfaceTag
        ref={(el) => {
          surfaceRef.current = el;
        }}
        className={cn("squircle-chrome__surface", surfaceClassName)}
        {...surfaceProps}
      >
        {children}
      </SurfaceTag>
    </div>
  );
}
