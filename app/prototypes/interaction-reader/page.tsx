"use client";

/**
 * Interaction Section exploration harness (09C-B prototype, isolated route).
 * Renders one variant at a time, full size, inside a static replica of the
 * Design System Browser sheet chrome. Nothing here is imported by production.
 *
 * Picker markup/behavior follows the prototype skill's PICKER.md verbatim,
 * expressed idiomatically for React (state + keyed re-mount + refs).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import "./interaction-reader.css";
import {
  INTERACTION_RULES,
  type InteractionStatus
} from "./interaction-data";
import { MatrixVariant } from "./variant-matrix";
import { TimelineVariant } from "./variant-timeline";
import { RigVariant } from "./variant-rig";

const VARIANTS = [
  { name: "Matrix", Component: MatrixVariant },
  { name: "Timeline", Component: TimelineVariant },
  { name: "Rig", Component: RigVariant }
];

function Chip({ status }: { status: InteractionStatus }) {
  return (
    <span className="iproto-chip" data-status={status}>
      {status}
    </span>
  );
}

/** Static replica of the locked 09C-A left pane: flat rule rows. */
function RulesPane() {
  return (
    <aside className="iproto-rules" aria-label="Interaction rules">
      <h1 className="iproto-h1">Interaction</h1>
      <div className="iproto-intro">
        <p className="iproto-meta">5 rules</p>
        <div className="iproto-statdots">
          <span className="iproto-statdot">
            <span
              className="iproto-statdot-dot"
              style={{ background: "#11c514" }}
            />
            1 formalized
          </span>
          <span className="iproto-statdot">
            <span
              className="iproto-statdot-dot"
              style={{ background: "#3a93ff" }}
            />
            3 candidate
          </span>
          <span className="iproto-statdot">
            <span
              className="iproto-statdot-dot"
              style={{ background: "#c4c4c4" }}
            />
            1 gap
          </span>
        </div>
      </div>
      <div className="iproto-rule-rows">
        {INTERACTION_RULES.map((rule) => (
          <div className="iproto-rule-row" key={rule.id}>
            <span className="iproto-rule-anchor" aria-hidden>
              {rule.anchor}
            </span>
            <div className="iproto-rule-body">
              <div className="iproto-rule-top">
                <span className="iproto-rule-name">{rule.name}</span>
                <Chip status={rule.status} />
              </div>
              <p className="iproto-rule-value">
                {rule.states.length > 0
                  ? rule.states.map((s) => s.state).join(" · ")
                  : (rule.missing ?? "No states declared")}
              </p>
              <p className="iproto-rule-meaning">{rule.meaning}</p>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Static sidebar replica — surrounding context, not part of the variants. */
function Sidebar() {
  const leaves = [
    "Color",
    "Typography",
    "Materials",
    "Layout",
    "Interaction"
  ];
  return (
    <nav className="iproto-sidebar" aria-label="Foundations sections">
      <p className="iproto-sidebar-label">Foundations</p>
      {leaves.map((leaf) => (
        <span
          key={leaf}
          className="iproto-sidebar-item"
          data-active={leaf === "Interaction" || undefined}
        >
          {leaf}
        </span>
      ))}
    </nav>
  );
}

export default function InteractionReaderPrototype() {
  const [current, setCurrent] = useState(0);
  /** Bumped on replay to re-mount the active variant. */
  const [mountCount, setMountCount] = useState(0);
  const pickerRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const moveHighlight = useCallback((index: number) => {
    const el = itemRefs.current[index];
    const highlight = highlightRef.current;
    if (!el || !highlight) return;
    highlight.style.width = `${el.offsetWidth}px`;
    highlight.style.transform = `translateX(${el.offsetLeft}px)`;
  }, []);

  const setActive = useCallback(
    (index: number, remount: boolean) => {
      const clamped =
        ((index % VARIANTS.length) + VARIANTS.length) % VARIANTS.length;
      if (remount) setMountCount((count) => count + 1);
      setCurrent(clamped);
      const url = new URL(window.location.href);
      url.searchParams.set("v", String(clamped + 1));
      window.history.replaceState(null, "", url);
    },
    []
  );

  // Initial selection from ?v= (falls back to variant 1).
  useEffect(() => {
    const fromUrl = Number.parseInt(
      new URLSearchParams(window.location.search).get("v") ?? "",
      10
    );
    if (Number.isFinite(fromUrl) && fromUrl >= 1 && fromUrl <= VARIANTS.length) {
      setCurrent(fromUrl - 1);
    }
  }, []);

  // Highlight follows the active item; first paint lands without animating.
  useLayoutEffect(() => {
    moveHighlight(current);
    const picker = pickerRef.current;
    if (picker && !picker.hasAttribute("data-ready")) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => picker.setAttribute("data-ready", ""))
      );
    }
  }, [current, moveHighlight]);

  useEffect(() => {
    const onResize = () => moveHighlight(current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [current, moveHighlight]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.isContentEditable
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const num = Number.parseInt(event.key, 10);
      if (num >= 1 && num <= VARIANTS.length) {
        setActive(num - 1, false);
      } else if (event.key === "ArrowRight") {
        setActive(current + 1, false);
      } else if (event.key === "ArrowLeft") {
        setActive(current - 1, false);
      } else if (event.key === "r" || event.key === "R") {
        setMountCount((count) => count + 1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, setActive]);

  const { Component } = VARIANTS[current];

  return (
    <div className="iproto">
      <div className="iproto-sheet">
        <header className="iproto-header">
          <span className="iproto-navrow">
            <span className="iproto-navrow-crumb">Design System</span>
            <span aria-hidden>›</span>
            <span>Interaction</span>
          </span>
          <span className="iproto-close" aria-hidden>
            ×
          </span>
        </header>
        <div className="iproto-body">
          <Sidebar />
          <main className="iproto-main">
            <RulesPane />
            <div className="iproto-divider" aria-hidden>
              <span className="iproto-divider-line" />
            </div>
            {/* Keyed re-mount: variant swap is instant, entrance animations
                re-run; replay bumps mountCount without switching. */}
            <section
              className="iproto-visual"
              aria-label={`Variant: ${VARIANTS[current].name}`}
            >
              <Component key={`${current}:${mountCount}`} />
            </section>
          </main>
        </div>
      </div>

      <nav className="proto-picker" aria-label="Prototype variants" ref={pickerRef}>
        <span className="proto-picker-highlight" aria-hidden ref={highlightRef} />
        {VARIANTS.map((variant, index) => (
          <button
            key={variant.name}
            className="proto-picker-item"
            data-active={index === current || undefined}
            aria-current={index === current ? "true" : undefined}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            onClick={() => setActive(index, false)}
          >
            {variant.name}
          </button>
        ))}
        <span className="proto-picker-divider" aria-hidden />
        <button
          className="proto-picker-item proto-picker-replay"
          aria-label="Replay animation (R)"
          onClick={() => setMountCount((count) => count + 1)}
        >
          ↻
        </button>
      </nav>
    </div>
  );
}
