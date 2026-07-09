"use client";

import { getSvgPath } from "figma-squircle";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const RING_PX = 1;

type SquircleChromeProps = {
  className?: string;
  surfaceClassName?: string;
  surfaceTag?: "div" | "section";
  surfaceProps?: Record<string, unknown>;
  cornerRadius?: number;
  cornerSmoothing?: number;
  children: ReactNode;
};

function applySquircleClip(
  el: HTMLElement,
  width: number,
  height: number,
  cornerRadius: number,
  cornerSmoothing: number
) {
  if (!width || !height) return;
  el.style.clipPath = `path('${getSvgPath({
    width,
    height,
    cornerRadius: Math.max(0, cornerRadius),
    cornerSmoothing
  })}')`;
}

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
  const ringRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const ring = ringRef.current;
    const surface = surfaceRef.current;
    if (!shell || !ring || !surface || typeof ResizeObserver === "undefined") {
      return;
    }

    // Three nested squircles paint the Figma chrome rings without CSS border:
    //   shell  = dark outer ring (padding)
    //   ring   = white inner ring (padding)
    //   surface = #f1f1f1 fill + content
    // A CSS `border` on a clipped element is drawn on the rectangular box and
    // gets cut off at squircle corners — padding rings avoid that.
    const update = () => {
      applySquircleClip(
        shell,
        shell.offsetWidth,
        shell.offsetHeight,
        cornerRadius,
        cornerSmoothing
      );
      applySquircleClip(
        ring,
        ring.offsetWidth,
        ring.offsetHeight,
        cornerRadius - RING_PX,
        cornerSmoothing
      );
      applySquircleClip(
        surface,
        surface.offsetWidth,
        surface.offsetHeight,
        cornerRadius - RING_PX * 2,
        cornerSmoothing
      );
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    observer.observe(ring);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [cornerRadius, cornerSmoothing]);

  const SurfaceTag = surfaceTag;

  return (
    <div ref={shellRef} className={cn("squircle-chrome", className)}>
      <div ref={ringRef} className="squircle-chrome__ring">
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
    </div>
  );
}
