"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Placard from "./variant-placard";
import Ledger from "./variant-ledger";
import Inspector from "./variant-inspector";
import "./component-detail.css";

const VARIANTS = [
  { name: "Placard", Component: Placard },
  { name: "Ledger", Component: Ledger },
  { name: "Inspector", Component: Inspector }
];

export default function ComponentDetailPrototype() {
  const [current, setCurrent] = useState(0);
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

  // Number keys 1–N and ←/→ switch variants.
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
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current]);

  const { Component } = VARIANTS[current];

  return (
    <main className="pcd-page">
      <div className="pcd-sheet">
        <header className="pcd-chrome">
          <span className="pcd-tab">Foundations</span>
          <span className="pcd-tab" data-active="">
            Components
          </span>
        </header>
        {/* key remounts the variant on switch — the swap itself stays instant */}
        <div className="pcd-scroll" key={current}>
          <Component />
        </div>
      </div>
      <nav className="proto-picker" aria-label="Prototype variants" ref={pickerRef}>
        <span className="proto-picker-highlight" aria-hidden="true" ref={highlightRef} />
        {VARIANTS.map((variant, index) => (
          <button
            key={variant.name}
            className="proto-picker-item"
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            data-active={index === current ? "" : undefined}
            aria-current={index === current ? "true" : undefined}
            onClick={() => setActive(index)}
          >
            {variant.name}
          </button>
        ))}
      </nav>
    </main>
  );
}
