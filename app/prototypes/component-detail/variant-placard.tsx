"use client";

import {
  Chip,
  LiveButton,
  OriginBadge,
  SPEC,
  StateTriggers,
  useButtonState
} from "./shared";

/* Placard — hero-dominant museum placard. The component gets a framed
   stage and the spec reads as one calm centered column below it. */
export default function Placard() {
  const [state, setState] = useButtonState();

  return (
    <article className="pcd-placard">
      <nav className="pcd-crumb" aria-label="Breadcrumb">
        Components <span aria-hidden="true">/</span> {SPEC.name}
      </nav>

      <section className="pcd-placard-stage">
        <span className="pcd-placard-origin">
          <OriginBadge />
        </span>
        <LiveButton state={state} />
        <StateTriggers
          className="pcd-placard-states"
          itemClassName="pcd-placard-state"
          active={state}
          onPreview={setState}
        />
      </section>

      <header className="pcd-placard-head">
        <div className="pcd-placard-title-row">
          <h1 className="pcd-placard-title">{SPEC.name}</h1>
          <Chip status={SPEC.status} />
        </div>
        <p className="pcd-placard-meta">{SPEC.context}</p>
      </header>

      <section className="pcd-placard-section">
        <h2 className="pcd-placard-label">Purpose</h2>
        <p className="pcd-placard-body">{SPEC.purpose}</p>
      </section>

      <section className="pcd-placard-section">
        <h2 className="pcd-placard-label">Props</h2>
        <dl className="pcd-placard-props">
          {SPEC.props.map((prop) => (
            <div className="pcd-placard-prop" key={prop.name}>
              <dt>
                {prop.name}
                {prop.status === "candidate" ? <Chip status="candidate" /> : null}
              </dt>
              <dd>
                <span className="pcd-placard-prop-type">{prop.type}</span>
                <span className="pcd-placard-prop-note">{prop.note}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="pcd-placard-section">
        <h2 className="pcd-placard-label">Boundaries</h2>
        <ul className="pcd-placard-boundaries">
          {SPEC.boundaries.map((boundary) => (
            <li key={boundary}>{boundary}</li>
          ))}
        </ul>
      </section>

      <section className="pcd-placard-section">
        <h2 className="pcd-placard-label">Token links</h2>
        <ul className="pcd-placard-tokens">
          {SPEC.tokens.map((token) => (
            <li key={token.slot}>
              <span className="pcd-placard-token-slot">{token.slot}</span>
              <span className="pcd-placard-token-link">{token.link}</span>
              <span className="pcd-placard-token-target">{token.target}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="pcd-placard-evidence">{SPEC.evidence}</footer>
    </article>
  );
}
