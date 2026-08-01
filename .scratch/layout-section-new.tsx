/* ----------------------- 09C-D02: layout source capture ----------------------- */

/**
 * Layout leaf (09C-D02, designer-selected Source Capture direction — Placard
 * variant): one vertical placard block per rule. A real Figma node capture
 * hangs in a hairline frame; below it the rule's statement, its recognized
 * spatial facts as one quiet line, and a provenance caption (origin tag,
 * node name, capture time, staleness). Rules with no linked capture get an
 * honest dashed unavailable block instead of a fabricated visual.
 *
 * Captures are declared by the agent in layout-rules.json `sourceCaptures`
 * (screenshot taken via Figma MCP, stored under design-system/captures/) and
 * decorated onto the entry by the Runtime view. The Blueprint schematic
 * drawing (09C-B) is retired — a composition of parsed values could never
 * show what the layout actually looks like; a capture can.
 */

/** "2026-07-31T14:05:22Z" → "2026-07-31 14:05"; anything else passes through. */
function formatCapturedAt(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso.trim());
  return match ? `${match[1]} ${match[2]}` : iso;
}

/** Full-frame lightbox for a capture's evidence surface screenshot. Portaled
 * to document.body: ancestors carry the entrance animation's fill-mode
 * transform, which would trap position:fixed inside the placard box. Esc is
 * handled on document CAPTURE with stopPropagation so the sheet's own layered
 * Esc handler never sees it (pressing Esc inside the lightbox must not close
 * the whole sheet). */
function LayoutFrameLightbox({
  surfaceId,
  session,
  title,
  open,
  onClose
}: {
  surfaceId: string;
  session: string;
  title: string;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div
      className="dsb-lightbox"
      role="dialog"
      aria-label={`${title} — full frame`}
      onClick={onClose}
    >
      <img
        className="dsb-lightbox-img"
        src={`/api/evidence-screenshot?id=${encodeURIComponent(
          surfaceId
        )}&session=${encodeURIComponent(session)}`}
        alt={`Full source frame for ${title}`}
      />
      <span className="dsb-lightbox-hint">
        Full frame · click anywhere to close
      </span>
    </div>,
    document.body
  );
}

function LayoutPlacardBlock({
  rule,
  index,
  session,
  rows
}: {
  rule: LayoutRuleProjection;
  index: number;
  session: string;
  rows: RowSharedProps;
}) {
  const [activeCapture, setActiveCapture] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const capture =
    rule.captures[Math.min(activeCapture, Math.max(rule.captures.length - 1, 0))];
  const approval = rows.approvals[rule.row.key] ?? { kind: "idle" as const };
  // The lightbox frame is the capture's own evidence surface when linked,
  // else the entry's first evidence version (the alignment-era frame).
  const frameSurfaceId =
    capture?.surfaceId ??
    rule.row.entry.evidence.evidence_versions[0]?.id ??
    null;
  return (
    <article
      className="dsb-placard dsb-placard-enter"
      style={{ "--i": index } as CSSProperties}
      data-testid={`ds-layout-placard-${rule.row.entryId}`}
    >
      {capture ? (
        <figure className="dsb-placard-figure">
          <img
            src={artifactScreenshotUrl(capture.artifactPath, session)}
            alt={`Source capture of ${capture.nodeName}`}
          />
        </figure>
      ) : (
        <div
          className="dsb-placard-unavailable"
          role="img"
          aria-label={`No source capture for ${rule.headline}: this rule has no linked Figma node`}
          data-testid={`ds-layout-unavailable-${rule.row.entryId}`}
        >
          <span className="dsb-placard-unavailable-title">No source capture</span>
          <span className="dsb-placard-unavailable-note">
            This rule has no linked Figma node — nothing to show honestly.
          </span>
        </div>
      )}
      {rule.captures.length > 1 ? (
        <span className="dsb-placard-thumbs" role="group" aria-label="Other source nodes">
          {rule.captures.map((item, itemIndex) => (
            <button
              key={`${item.nodeName}-${itemIndex}`}
              type="button"
              className="dsb-placard-thumb"
              data-active={item === capture || undefined}
              aria-label={`Show ${item.nodeName}`}
              aria-pressed={item === capture}
              onClick={() => setActiveCapture(itemIndex)}
            >
              <img src={artifactScreenshotUrl(item.artifactPath, session)} alt="" />
            </button>
          ))}
        </span>
      ) : null}
      <div className="dsb-placard-body">
        <div className="dsb-placard-head">
          <span className="dsb-placard-statement">{rule.headline}</span>
          <StatusChip
            status={rule.row.status}
            testId={`ds-layout-status-${rule.row.entryId}`}
          />
          <InfoPopover
            entry={rule.row.entry}
            approval={approval}
            infoOpen={rows.infoKey === rule.row.key}
            popoverInstant={rows.popoverInstant(rule.row.key)}
            portalContainer={rows.portalContainer}
            ariaLabel={`Evidence for layout rule ${rule.row.entryId}`}
            onInfoOpenChange={(open) =>
              rows.onInfoKey(open ? rule.row.key : null)
            }
            onInfoHoverOpen={() => rows.onInfoHoverOpen(rule.row.key)}
            onInfoHoverClose={rows.onInfoHoverClose}
            onApprove={() => rows.onApprove(rule.row)}
          />
        </div>
        {rule.facts.length > 0 ? (
          <p className="dsb-placard-facts">
            {rule.facts.map((fact) => fact.label).join("  ·  ")}
          </p>
        ) : null}
        <div className="dsb-placard-caption">
          {capture ? (
            <>
              <OriginTag origin="source-capture" />
              <span>{capture.nodeName}</span>
              <span data-stale={capture.stale || undefined}>
                captured {formatCapturedAt(capture.capturedAt)}
                {capture.stale ? " · stale" : ""}
              </span>
              {frameSurfaceId ? (
                <button
                  type="button"
                  className="dsb-placard-frame-link"
                  onClick={() => setLightboxOpen(true)}
                >
                  View in frame
                </button>
              ) : null}
            </>
          ) : (
            <OriginTag origin="unavailable" />
          )}
        </div>
        {approval.kind === "error" ? (
          <span className="dsb-row-error" role="alert">
            Approval failed: {approval.message}
          </span>
        ) : null}
      </div>
      {frameSurfaceId ? (
        <LayoutFrameLightbox
          surfaceId={frameSurfaceId}
          session={session}
          title={rule.headline}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </article>
  );
}

/** Layout leaf (09C-D02): standard Browser heading, then the placard stream.
 * Full-width page (no split) — the capture needs the whole reading column. */
export function LayoutLeafPage({
  leaf,
  rows,
  session
}: {
  leaf: { rows: DsRow[]; chips: string[] };
  rows: RowSharedProps;
  session: string;
}) {
  const model = useMemo(() => projectLayoutLeaf(leaf.rows), [leaf.rows]);
  return (
    <>
      <PageHeading
        title="Layout"
        meta={`${leaf.rows.length} rules`}
        chips={leaf.chips}
      />
      {model.rules.length > 0 ? (
        <div className="dsb-placard-list" data-testid="ds-layout-placards">
          {model.rules.map((rule, index) => (
            <LayoutPlacardBlock
              key={rule.row.key}
              rule={rule}
              index={index}
              session={session}
              rows={rows}
            />
          ))}
        </div>
      ) : (
        <p className="dsb-empty-body dsb-page-note">No rules declared yet.</p>
      )}
    </>
  );
}
