# Design-system rules: prose body, structured envelope, designer in-browser editing

Design-system **rules** (layout / interaction / domain rules) become
designer-editable prose documents backed by a machine-validated envelope. A
rule's body is free-form text: the Agent is its semantic consumer (it reads
rules to shape design output, and writes them from evidence), so no JSON
field structure is imposed on the body and the Browser renders it verbatim.
The entry envelope (`id`, `meaning`, `status`, `links`) and layout
`sourceCaptures` stay structured — they are consumed by deterministic
Runtime code (status gate, evidence-chain join, capture staleness) and keep
their schema validation. `meaning` becomes the single rule title for every
rule kind; the rich-value `statement` field is retired.

Designers edit rule text directly in the Design System Browser. Edits go
through a Runtime write path that mirrors the approval write-back: locate
the entry in its source JSON file, schema-validate, canonically serialize,
write the file, update the DB in one transaction, log a
`design_system_entry_edited` event, and invalidate the Browser over SSE.
Status semantics on edit: formalized stays formalized (a direct designer
edit IS designer intent — stronger than the answered-card evidence the
formalized invariant exists to prove), candidate stays candidate, and a gap
entry whose body the designer fills becomes candidate. The edit is recorded
as part of the entry's provenance so the evidence layer does not drift from
the displayed text.

The rules' frontend projections (lossy flattening of rich values into
headline + label-path field lines) are retired; displayed text and source
JSON text are the same text. `tokenLinks` and `acceptanceChecks` are
removed: they have no consumer and no target validation, so they would
silently rot; when the rule-update proposal flow (Issue 02/12) needs
affected items, the Agent derives them at proposal time from the full rule
corpus. The per-file taxonomy boundary (cross-component strategy vs
component-bound behavior) moves from a schema field-whitelist hard reject
to MCP instructions conventions plus an Agent self-audit rule (check
placement when writing; propose moves through the proposal channel, never
silent moves), with designer browsing as the backstop — the whitelist only
ever caught structural shape slips, not semantic misplacement, and a single
violation previously failed the whole file's ingest.

## Considered Options

- **Keep rich structured rule values + lossy projection (status quo).**
  Displayed text diverges from source text (flattened labels, stripped
  keys, joined values), which makes safe in-browser editing impossible
  without a field-mapping layer.
- **Tighten the schema to a display-shaped closed field set.** Editable and
  faithful, but caps the Agent's expressive range against the bottom-up
  discovery of rule types from Figma evidence; unanticipated rules would be
  distorted, flattened into prose anyway, or rejected at ingest.
- **Full prose including envelope and captures.** Loses the
  machine-consumed invariants (formalized gate, evidence join, capture
  staleness) whose failure modes are the ones that must stay loud.
- **Read-only structured fields + a separate editable notes field.**
  Superseded: the rule body already IS notes-like prose consumed by the
  Agent; a separate notes channel would only duplicate it and leave stale
  structured values permanently contradicting the notes.

## Consequences

- Rule-body schema validation becomes shallow by design; the Agent is the
  semantic layer, as it always was for rule content. Machine validation
  remains deep exactly where deterministic code consumes structure
  (envelope, token alias graph, captures).
- The formalized trust model now rests on the envelope alone; edit events
  keep the audit trail honest when designer edits diverge from the original
  evidence cards.
- Issue 02/12's proposal flow remains the channel for Agent-initiated rule
  updates and for self-audit move proposals; designer direct editing is a
  separate, lighter channel that does not require proposals.
- Future affected-items / drift-detection work must derive links at
  proposal time instead of relying on pre-declared per-rule link fields.
