"use client";

// Design System Browser leaf split pane (Issue 09C-A).
//
// The universal leaf chrome: left pane carries the page title, status
// summary, every rule / explanation / Technical details / Evidence entry;
// the right pane carries only Visual Samples and their own annotations.
//
// Behavior contract (locked product decisions):
//   - Default ratio 42% / 58%; the divider drags continuously (pointer),
//     nudges by keyboard (Arrows, Shift for large steps, Home resets),
//     and double-click restores the default.
//   - Ratio changes are reported via onRatioChange (live) and onRatioCommit
//     (gesture end) so the parent can persist the browser-level preference.
//   - Both panes keep minimum widths (340 / 420px). When the container
//     cannot fit both + divider, the leaf stacks (rules above, samples
//     below) and the divider disappears.
//
// Sizing is pure CSS: the left track is
// `minmax(340px, calc((100% - divider) * ratio))`, so no JS pixel math runs
// per render; a ResizeObserver only detects the stacked fallback (which
// must not be defeated by the inline grid template). Stacking state is
// therefore single-sourced in JS and expressed through `data-stacked`.
//
// Why not shadcn/ui here (repo rule: prefer shadcn primitives): shadcn's
// resizable wraps `react-resizable-panels`, which is not a dependency of
// this project, and it cannot express the contract above — pixel minimums
// on both panes with a single-column stacked fallback, a calc()-based grid
// template with no per-frame JS measurement, and a `role="separator"`
// keyboard/aria contract with Home/double-click reset. A bespoke primitive
// is smaller than the dependency + adapters would be.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import {
  DEFAULT_DS_SPLIT_RATIO,
  DS_SPLIT_DIVIDER_PX,
  DS_SPLIT_MIN_LEFT_PX,
  DS_SPLIT_MIN_RIGHT_PX,
  clampSplitRatio,
  isSplitStacked,
  nextKeyboardRatio,
  ratioFromPointer
} from "./ds-split-pane-model";

export interface LeafSplitProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Current ratio (0–1, the left pane's share of the usable width). */
  ratio: number;
  /** Live updates during a drag / keyboard gesture. */
  onRatioChange: (ratio: number) => void;
  /** Gesture end (pointerup, double-click, keyboard settle) — persist this. */
  onRatioCommit: (ratio: number) => void;
}

export function LeafSplit({
  left,
  right,
  ratio,
  onRatioChange,
  onRatioCommit
}: LeafSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  // Measure before paint so a narrow container never flashes the split grid.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    setContainerWidth(element.getBoundingClientRect().width);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const stacked =
    containerWidth === null || isSplitStacked(containerWidth);
  const clampedRatio =
    containerWidth === null
      ? DEFAULT_DS_SPLIT_RATIO
      : clampSplitRatio(ratio, containerWidth);

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      setDragging(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        onRatioCommit(ratioFromPointer(event.clientX, rect.left, rect.width));
      } else {
        onRatioCommit(clampedRatio);
      }
    },
    [dragging, clampedRatio, onRatioCommit]
  );

  const onDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const onDividerPointerMove = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!dragging) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    onRatioChange(ratioFromPointer(event.clientX, rect.left, rect.width));
  };

  const onDividerDoubleClick = () => {
    onRatioChange(DEFAULT_DS_SPLIT_RATIO);
    onRatioCommit(DEFAULT_DS_SPLIT_RATIO);
  };

  const onDividerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (containerWidth === null) return;
    const next = nextKeyboardRatio(
      clampedRatio,
      event.key,
      event.shiftKey,
      containerWidth
    );
    if (next === null) return;
    event.preventDefault();
    onRatioChange(next);
    onRatioCommit(next);
  };

  const usable =
    containerWidth === null ? null : containerWidth - DS_SPLIT_DIVIDER_PX;
  const valueNow = Math.round(clampedRatio * 100);
  const valueMin =
    usable === null
      ? 0
      : Math.round((DS_SPLIT_MIN_LEFT_PX / usable) * 100);
  const valueMax =
    usable === null
      ? 100
      : Math.round((1 - DS_SPLIT_MIN_RIGHT_PX / usable) * 100);

  return (
    <div
      ref={containerRef}
      className="dsb-split"
      data-testid="ds-leaf-split"
      data-stacked={stacked || undefined}
      data-dragging={dragging || undefined}
      style={
        stacked
          ? undefined
          : {
              gridTemplateColumns: `minmax(${DS_SPLIT_MIN_LEFT_PX}px, calc((100% - ${DS_SPLIT_DIVIDER_PX}px) * ${clampedRatio})) ${DS_SPLIT_DIVIDER_PX}px minmax(${DS_SPLIT_MIN_RIGHT_PX}px, 1fr)`
            }
      }
    >
      <div className="dsb-split-pane dsb-split-left" data-testid="ds-split-left">
        {left}
      </div>
      {stacked ? null : (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize reading and visual sample panels"
          aria-valuenow={valueNow}
          aria-valuemin={valueMin}
          aria-valuemax={valueMax}
          aria-valuetext={`Reading panel ${valueNow} percent, visual samples ${
            100 - valueNow
          } percent`}
          aria-keyshortcuts="ArrowLeft ArrowRight Home"
          tabIndex={0}
          className="dsb-split-divider"
          data-testid="ds-split-divider"
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => setDragging(false)}
          onDoubleClick={onDividerDoubleClick}
          onKeyDown={onDividerKeyDown}
        >
          <span aria-hidden className="dsb-split-divider-line" />
        </div>
      )}
      <div
        className="dsb-split-pane dsb-split-right"
        data-testid="ds-split-right"
      >
        {right}
      </div>
    </div>
  );
}
