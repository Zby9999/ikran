"use client";

import {
  Chip,
  LiveButton,
  OriginBadge,
  SPEC,
  StateTriggers,
  useButtonState
} from "./shared";

/* Inspector — audit dashboard. The hero carries tool chrome (origin,
   source context, segmented state control) and the spec below is chunked
   into cards you jump between instead of reading through. */
export default function Inspector() {
  const [state, setState] = useButtonState();

  return (
    <article className="pcd-inspector">
      <section className="pcd-inspector-stage">
        <div className="pcd-inspector-chrome">
          <OriginBadge />
          <span className="pcd-inspector-context">{SPEC.context}</span>
        </div>
        <div className="pcd-inspector-canvas">
          <LiveButton state={state} />
        </div>
        <div className="pcd-inspector-controls">
          <StateTriggers
            className="pcd-inspector-segment"
            itemClassName="pcd-inspector-segment-item"
            active={state}
            onPreview={setState}
          />
        </div>
      </section>

      <header className="pcd-inspector-head">
        <div className="pcd-inspector-title-row">
          <h1 className="pcd-inspector-title">{SPEC.name}</h1>
          <Chip status={SPEC.status} />
        </div>
        <p className="pcd-inspector-purpose">{SPEC.purpose}</p>
      </header>

      <div className="pcd-inspector-grid">
        <section className="pcd-inspector-card">
          <h2 className="pcd-inspector-label">Props</h2>
          <table className="pcd-inspector-table">
            <tbody>
              {SPEC.props.map((prop) => (
                <tr key={prop.name}>
                  <td>
                    {prop.name}
                    {prop.status === "candidate" ? (
                      <Chip status="candidate" />
                    ) : null}
                  </td>
                  <td>{prop.type}</td>
                  <td className="pcd-inspector-note">{prop.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="pcd-inspector-card">
          <h2 className="pcd-inspector-label">States &amp; motion</h2>
          <table className="pcd-inspector-table">
            <tbody>
              {SPEC.motion.map((row) => (
                <tr key={row.state}>
                  <td>{row.state}</td>
                  <td>{row.change}</td>
                  <td className="pcd-inspector-note">{row.timing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="pcd-inspector-card">
          <h2 className="pcd-inspector-label">Boundaries</h2>
          <ul className="pcd-inspector-boundaries">
            {SPEC.boundaries.map((boundary) => (
              <li key={boundary}>{boundary}</li>
            ))}
          </ul>
        </section>

        <section className="pcd-inspector-card">
          <h2 className="pcd-inspector-label">Token links</h2>
          <table className="pcd-inspector-table">
            <tbody>
              {SPEC.tokens.map((token) => (
                <tr key={token.slot}>
                  <td>{token.slot}</td>
                  <td className="pcd-inspector-token">{token.link}</td>
                  <td className="pcd-inspector-note">{token.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <footer className="pcd-inspector-evidence">{SPEC.evidence}</footer>
    </article>
  );
}
