"use client";

import {
  Chip,
  LiveButton,
  OriginBadge,
  SPEC,
  StateTriggers,
  useButtonState
} from "./shared";

/* Ledger — spec-first density. The hero is a quiet full-width band and
   everything below is hairline-separated rows you can scan top to bottom. */
export default function Ledger() {
  const [state, setState] = useButtonState();

  return (
    <article className="pcd-ledger">
      <section className="pcd-ledger-band">
        <div className="pcd-ledger-band-inner">
          <OriginBadge />
          <LiveButton state={state} />
          <StateTriggers
            className="pcd-ledger-states"
            itemClassName="pcd-ledger-state"
            active={state}
            onPreview={setState}
          />
        </div>
      </section>

      <header className="pcd-ledger-head">
        <h1 className="pcd-ledger-title">{SPEC.name}</h1>
        <Chip status={SPEC.status} />
        <span className="pcd-ledger-context">{SPEC.context}</span>
        <span className="pcd-ledger-evidence">{SPEC.evidence}</span>
      </header>

      <section className="pcd-ledger-block">
        <h2 className="pcd-ledger-label">Purpose</h2>
        <p className="pcd-ledger-purpose">{SPEC.purpose}</p>
      </section>

      <section className="pcd-ledger-block">
        <h2 className="pcd-ledger-label">Props</h2>
        <div className="pcd-ledger-rows" role="table" aria-label="Props">
          {SPEC.props.map((prop) => (
            <div className="pcd-ledger-row" role="row" key={prop.name}>
              <span className="pcd-ledger-cell-name" role="cell">
                {prop.name}
                {prop.status === "candidate" ? <Chip status="candidate" /> : null}
              </span>
              <span className="pcd-ledger-cell-type" role="cell">
                {prop.type}
              </span>
              <span className="pcd-ledger-cell-note" role="cell">
                {prop.note}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="pcd-ledger-block">
        <h2 className="pcd-ledger-label">States &amp; motion</h2>
        <div className="pcd-ledger-rows" role="table" aria-label="States and motion">
          {SPEC.motion.map((row) => (
            <div className="pcd-ledger-row" role="row" key={row.state}>
              <span className="pcd-ledger-cell-name" role="cell">
                {row.state}
              </span>
              <span className="pcd-ledger-cell-type" role="cell">
                {row.change}
              </span>
              <span className="pcd-ledger-cell-note" role="cell">
                {row.timing}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="pcd-ledger-block">
        <h2 className="pcd-ledger-label">Token links</h2>
        <div className="pcd-ledger-rows" role="table" aria-label="Token links">
          {SPEC.tokens.map((token) => (
            <div className="pcd-ledger-row" role="row" key={token.slot}>
              <span className="pcd-ledger-cell-name" role="cell">
                {token.slot}
              </span>
              <span className="pcd-ledger-cell-type" role="cell">
                {token.link}
              </span>
              <span className="pcd-ledger-cell-note" role="cell">
                {token.target}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="pcd-ledger-block">
        <h2 className="pcd-ledger-label">Boundaries</h2>
        <ol className="pcd-ledger-boundaries">
          {SPEC.boundaries.map((boundary, index) => (
            <li key={boundary}>
              <span className="pcd-ledger-boundary-index">{index + 1}</span>
              {boundary}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
