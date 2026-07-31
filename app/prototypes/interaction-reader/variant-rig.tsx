/**
 * Variant "Rig" — axis: interaction model (feel-first). Each rule gets a
 * large live specimen the designer actually hovers, presses, and focuses;
 * a readout tracks the active state with its source-backed behavior and
 * motion values. Declared states also render as a static strip so
 * disabled / focus-visible stay visible without choreography.
 */

import { useEffect, useRef, useState } from "react";
import { INTERACTION_RULES, type InteractionRule } from "./interaction-data";
import { MiniSpecimen, RuleBlockHeader, UnavailableBlock } from "./specimens";

type LiveState = "default" | "hover" | "active" | "focus-visible" | "open" | "closed";

function behaviorFor(rule: InteractionRule, state: string) {
  return rule.states.find((s) => s.state === state);
}

/** Live specimen rig for one rule: stage + state readout + declared strip. */
function RigBlock({ rule }: { rule: InteractionRule }) {
  const [live, setLive] = useState<LiveState>(
    rule.control === "sheet" ? "closed" : "default"
  );
  const [focusVisible, setFocusVisible] = useState(false);
  const pointerDown = useRef(false);
  const isSheet = rule.control === "sheet";

  const current: LiveState = isSheet
    ? live
    : focusVisible
      ? "focus-visible"
      : live;
  const behavior = behaviorFor(rule, current);
  const motion = rule.motion[0];

  useEffect(() => {
    if (!isSheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLive("closed");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isSheet]);

  const pointerHandlers = {
    onPointerEnter: () => setLive("hover"),
    onPointerLeave: () => {
      pointerDown.current = false;
      setLive("default");
    },
    onPointerDown: () => {
      pointerDown.current = true;
      setLive("active");
    },
    onPointerUp: () => {
      if (pointerDown.current) setLive("hover");
      pointerDown.current = false;
    }
  };

  return (
    <section className="iproto-block">
      <RuleBlockHeader rule={rule} />
      <div className="irg-stage-row">
        <div className="irg-stage" data-sheet-open={isSheet && live === "open" || undefined}>
          {rule.control === "link" && (
            <button
              type="button"
              className="irg-link"
              {...pointerHandlers}
              onFocus={() => setFocusVisible(true)}
              onBlur={() => setFocusVisible(false)}
            >
              Projects
            </button>
          )}
          {rule.control === "button" && (
            <button
              type="button"
              className="irg-btn"
              {...pointerHandlers}
              onFocus={() => setFocusVisible(true)}
              onBlur={() => setFocusVisible(false)}
            >
              Save changes
            </button>
          )}
          {rule.control === "field" && (
            <input
              className="irg-field"
              placeholder="Search tokens…"
              aria-label="Search tokens"
              onFocus={() => setFocusVisible(true)}
              onBlur={() => setFocusVisible(false)}
            />
          )}
          {rule.control === "sheet" && (
            <>
              <span className="irg-sheet-scrim" onClick={() => setLive("closed")} />
              <span className="irg-sheet-panel">
                <span className="irg-sheet-grabber" />
                <span className="irg-sheet-lines">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
              {live === "closed" && (
                <button
                  type="button"
                  className="irg-btn"
                  onClick={() => setLive("open")}
                >
                  Open sheet
                </button>
              )}
            </>
          )}
        </div>

        <div className="irg-readout" aria-live="polite">
          <p className="irg-readout-label">Current state</p>
          <p className="irg-readout-state">{current}</p>
          <p className="irg-readout-behavior">
            {behavior?.behavior ?? "Resting appearance"}
          </p>
          {motion ? (
            <p className="irg-readout-motion">
              {motion.duration} · {motion.easing}
              {motion.target ? ` · ${motion.target}` : ""}
            </p>
          ) : null}
          {rule.layoutInvariants.length > 0 ? (
            <p className="irg-readout-invariant">
              {rule.layoutInvariants[0]}
            </p>
          ) : null}
        </div>
      </div>

      <div className="irg-strip" aria-label="Declared states">
        {rule.states.map((s) => (
          <span
            className="irg-strip-item"
            data-current={s.state === current || undefined}
            key={s.state}
          >
            <MiniSpecimen rule={rule} state={s.state} />
            <span className="irg-strip-label">{s.state}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

export function RigVariant() {
  const declared = INTERACTION_RULES.filter((rule) => rule.control !== null);
  const gaps = INTERACTION_RULES.filter((rule) => rule.control === null);

  return (
    <div className="irg">
      <div className="iproto-visual-toolbar">
        <p className="iproto-group-label">Live specimens</p>
        <p className="iproto-toolbar-note">
          Hover, press, and focus each control — the readout tracks the source
        </p>
      </div>
      {declared.map((rule) => (
        <RigBlock key={rule.id} rule={rule} />
      ))}
      {gaps.map((rule) => (
        <UnavailableBlock key={rule.id} rule={rule} />
      ))}
    </div>
  );
}
