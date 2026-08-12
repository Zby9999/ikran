"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Mirror from "./variant-mirror";
import Dot from "./variant-dot";
import Inline from "./variant-inline";
import "./rule-update-review.css";

const VARIANTS = [
  { name: "Mirror", Component: Mirror },
  { name: "Dot", Component: Dot },
  { name: "Inline", Component: Inline }
];

export default function RuleUpdateReviewPrototype() {
  const [current, setCurrent] = useState(0);
  const [remount, setRemount] = useState(0);
  const pickerRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const setActive = (index: number) => {
    if (index < 0 || index >= VARIANTS.length) return;
    setCurrent(index);
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(index + 1));
    window.history.replaceState(null, "", url);
  };

  // Initial selection from ?v= (falls back to variant 1).
  useEffect(() => {
    const parsed = parseInt(
      new URLSearchParams(window.location.search).get("v") ?? "",
      10
    );
    if (parsed >= 1 && parsed <= VARIANTS.length) setCurrent(parsed - 1);
  }, []);

  // Highlight follows the active item; measured after layout.
  const moveHighlight = () => {
    const el = itemRefs.current[current];
    const hl = highlightRef.current;
    if (!el || !hl) return;
    hl.style.width = `${el.offsetWidth}px`;
    hl.style.transform = `translateX(${el.offsetLeft}px)`;
  };
  useLayoutEffect(moveHighlight, [current]);
  useEffect(() => {
    window.addEventListener("resize", moveHighlight);
    return () => window.removeEventListener("resize", moveHighlight);
  });

  // Enable the slide only after first paint, so load doesn't animate.
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() =>
        pickerRef.current?.setAttribute("data-ready", "")
      );
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  // Number keys 1–N and ←/→ switch variants; R replays the entrance.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= VARIANTS.length) setActive(num - 1);
      else if (event.key === "ArrowRight")
        setActive((current + 1) % VARIANTS.length);
      else if (event.key === "ArrowLeft")
        setActive((current - 1 + VARIANTS.length) % VARIANTS.length);
      else if (event.key === "r" || event.key === "R")
        setRemount((n) => n + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current]);

  const Active = VARIANTS[current].Component;

  return (
    <>
      {/* Re-mounted on switch and replay so entrance motion re-runs. */}
      <Active key={`${current}-${remount}`} />

      <nav className="proto-picker" ref={pickerRef} aria-label="Prototype variants">
        <span className="proto-picker-highlight" ref={highlightRef} aria-hidden="true" />
        {VARIANTS.map((variant, i) => (
          <button
            key={variant.name}
            className="proto-picker-item"
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            {...(i === current
              ? { "data-active": true, "aria-current": "true" as const }
              : {})}
            onClick={() => setActive(i)}
          >
            {variant.name}
          </button>
        ))}
        <span className="proto-picker-divider" aria-hidden="true" />
        <button
          className="proto-picker-item proto-picker-replay"
          aria-label="Replay animation (R)"
          onClick={() => setRemount((n) => n + 1)}
        >
          ↻
        </button>
      </nav>
    </>
  );
}
