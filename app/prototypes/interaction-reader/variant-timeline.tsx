/**
 * Variant "Timeline" — axis: motion-first. Every declared state transition
 * becomes a horizontal lane: from-node → easing curve → to-node, with a
 * playhead that travels the curve using the rule's exact duration and easing
 * on mount (the picker's replay re-runs it). Motion tokens are promoted to a
 * first-class strip at the top.
 */

import { useEffect, useState } from "react";
import {
  INTERACTION_RULES,
  MOTION_TOKENS,
  type InteractionRule,
  type StateBehavior
} from "./interaction-data";
import { MiniSpecimen, RuleBlockHeader, UnavailableBlock } from "./specimens";

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

function resolveEasing(easing: string): string {
  return easing.startsWith("cubic-bezier") ? easing : EASE_OUT;
}

/** SVG path for an easing curve in a fixed 120×36 lane box. */
function bezierPath(easing: string): string {
  const match = easing.match(/cubic-bezier\(([^)]+)\)/);
  const [x1, y1, x2, y2] = match
    ? match[1].split(",").map((n) => Number.parseFloat(n))
    : [0.23, 1, 0.32, 1];
  return `M0,36 C ${(x1 * 120).toFixed(1)},${(36 - y1 * 36).toFixed(1)} ${(
    x2 * 120
  ).toFixed(1)},${(36 - y2 * 36).toFixed(1)} 120,0`;
}

function Lane({
  rule,
  from,
  to
}: {
  rule: InteractionRule;
  from: string;
  to: StateBehavior;
}) {
  const [played, setPlayed] = useState(false);
  const motion = rule.motion[0];
  const duration = motion?.duration ?? "150ms";
  const easing = resolveEasing(motion?.easing ?? "ease-out");
  const path = bezierPath(easing);

  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => setPlayed(true))
    );
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="itl-lane">
      <div className="itl-node">
        <MiniSpecimen rule={rule} state={from} />
        <span className="itl-node-label">{from}</span>
      </div>

      <div className="itl-curve" aria-hidden>
        <svg viewBox="0 0 120 36" width="120" height="36" fill="none">
          <path className="itl-curve-path" d={path} />
        </svg>
        <span
          className="itl-dot"
          data-played={played || undefined}
          style={
            {
              offsetPath: `path("${path}")`,
              transitionDuration: duration,
              transitionTimingFunction: easing
            } as React.CSSProperties
          }
        />
      </div>

      <div className="itl-node">
        <MiniSpecimen rule={rule} state={to.state} />
        <span className="itl-node-label">{to.state}</span>
      </div>

      <div className="itl-lane-note">
        <span className="itl-duration">{duration}</span>
        <span className="itl-behavior">{to.behavior}</span>
      </div>
    </div>
  );
}

function RuleLanes({ rule }: { rule: InteractionRule }) {
  // Declared transitions: from-state → each non-resting state. Sheet travels
  // closed → open; everything else departs from default.
  const lanes: { from: string; to: StateBehavior }[] =
    rule.control === "sheet"
      ? rule.states
          .filter((s) => s.state === "open")
          .map((s) => ({ from: "closed", to: s }))
      : rule.states
          .filter((s) => s.state !== "default")
          .map((s) => ({ from: "default", to: s }));

  return (
    <section className="iproto-block">
      <RuleBlockHeader rule={rule} />
      <div className="itl-lanes">
        {lanes.map((lane) => (
          <Lane
            key={`${lane.from}-${lane.to.state}`}
            rule={rule}
            from={lane.from}
            to={lane.to}
          />
        ))}
      </div>
    </section>
  );
}

export function TimelineVariant() {
  const declared = INTERACTION_RULES.filter((rule) => rule.control !== null);
  const gaps = INTERACTION_RULES.filter((rule) => rule.control === null);

  return (
    <div className="itl">
      <div className="iproto-visual-toolbar">
        <p className="iproto-group-label">Motion lanes</p>
        <p className="iproto-toolbar-note">
          Every declared transition, played at its real duration
        </p>
      </div>

      <div className="itl-tokens" aria-label="Motion tokens">
        {MOTION_TOKENS.map((token) => (
          <span className="itl-token" key={token.name} title={token.note}>
            <span className="itl-token-name">{token.name}</span>
            <span className="itl-token-value">{token.value}</span>
          </span>
        ))}
      </div>

      {declared.map((rule) => (
        <RuleLanes key={rule.id} rule={rule} />
      ))}
      {gaps.map((rule) => (
        <UnavailableBlock key={rule.id} rule={rule} />
      ))}
    </div>
  );
}
