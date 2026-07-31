/**
 * Variant "Matrix" — axis: information layout (comparison-first).
 * Rows = controls (appliesTo), columns = the union of declared states across
 * the source, in canonical order. Filled cells show the real miniature in
 * that forced state plus its motion note; undeclared cells stay visibly empty
 * (never fabricated). The default column is live — hovering it previews the
 * real hover feedback.
 */

import { INTERACTION_RULES, type InteractionRule } from "./interaction-data";
import {
  MiniSpecimen,
  OriginBadge,
  StatusChip,
  UnavailableBlock
} from "./specimens";

const STATE_ORDER = [
  "default",
  "hover",
  "active",
  "focus-visible",
  "disabled",
  "open",
  "closed"
];

function stateCell(rule: InteractionRule, state: string) {
  return rule.states.find((s) => s.state === state);
}

export function MatrixVariant() {
  const declared = INTERACTION_RULES.filter((rule) => rule.control !== null);
  const gaps = INTERACTION_RULES.filter((rule) => rule.control === null);
  const columns = STATE_ORDER.filter((state) =>
    declared.some((rule) => stateCell(rule, state))
  );

  return (
    <div className="imx">
      <div className="iproto-visual-toolbar">
        <p className="iproto-group-label">State matrix</p>
        <p className="iproto-toolbar-note">
          {declared.length} controls · empty cell = not declared in source
        </p>
      </div>

      <div
        className="imx-grid"
        style={{
          gridTemplateColumns: `148px repeat(${columns.length}, minmax(0, 1fr))`
        }}
        role="table"
        aria-label="Interaction state matrix"
      >
        <span className="imx-corner" />
        {columns.map((column) => (
          <span className="imx-col-head" key={column} role="columnheader">
            {column}
          </span>
        ))}

        {declared.map((rule) => (
          <div className="imx-row" role="row" key={rule.id}>
            <div className="imx-row-head" role="rowheader">
              <span className="iproto-rule-anchor" aria-hidden>
                {rule.anchor}
              </span>
              <span className="imx-row-name">{rule.name}</span>
              <StatusChip status={rule.status} />
              <OriginBadge origin={rule.origin} />
            </div>
            {columns.map((column) => {
              const cell = stateCell(rule, column);
              if (!cell) {
                return (
                  <span
                    className="imx-cell"
                    data-empty
                    key={column}
                    role="cell"
                    aria-label={`${rule.name}: ${column} not declared`}
                  >
                    ·
                  </span>
                );
              }
              const motion = rule.motion[0];
              const live = column === "default";
              return (
                <span
                  className="imx-cell"
                  data-live={live || undefined}
                  key={column}
                  role="cell"
                  title={cell.behavior}
                >
                  {/* Live cells carry no forced state: real :hover applies. */}
                  <MiniSpecimen
                    rule={rule}
                    state={live ? undefined : column}
                  />
                  <span className="imx-cell-behavior">{cell.behavior}</span>
                  {motion ? (
                    <span className="imx-cell-motion">
                      {motion.duration} {motion.easing}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      {gaps.map((rule) => (
        <UnavailableBlock key={rule.id} rule={rule} />
      ))}
    </div>
  );
}
