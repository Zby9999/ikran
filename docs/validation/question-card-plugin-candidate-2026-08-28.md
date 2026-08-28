# Question Card full-chain plugin candidate snapshot — 2026-08-28

## Outcome

This snapshot freezes the first validated full-chain Ikran development state in
which Alignment Question Cards carry variable Agent-authored answer choices,
allow a designer-authored custom answer, and remain revisable after completion.
The plugin capability boundary remains the complete Ikran workflow:
Alignment, Extraction, Prototype, and Governance.

The portable semantic fixture is
[`question-card-plugin-candidate-2026-08-28.json`](./question-card-plugin-candidate-2026-08-28.json).
It is the durable reference for the 8 Agent Annotations, 16 questions, and 49
answer choices used by the isolated real validation project.

## Git provenance

- Branch: `codex/question-card-answer-options`
- Feature baseline: `a1ff7fa4a2c27a798a880fee9b5d843722291afe`
- Parent capability baseline: `da0d7683f3e1f3dc7fbc0fc0a6fad5cbb766a239`
- Repository plugin version at capture: `0.1.0-alpha.16`
- Validated full-chain development plugin version:
  `0.1.0-dev.4+codex.20260828191150`
- The local RC tag created for this snapshot points at the commit containing
  this document and the JSON fixture.

Feature-source SHA-256 values at capture:

| Path | SHA-256 |
| --- | --- |
| `.codex-plugin/plugin.json` | `f0817acf5bbf0fbe53b73c769286b179773702a5510fe2800664e2daef71241b` |
| `bin/ikran-mcp.mjs` | `95c8f5dfa9fc7e7539201da817b7d8f7e19e90f59fa3d0c6145ea7d6e7659fa8` |
| `skills/ikran-alignment/SKILL.md` | `e509fcd382c6e81ee0278d5491d32563e8d7a0f30aac25d658c48c821b9cc99c` |
| `skills/ikran-extraction/SKILL.md` | `1cb922da2e5825d7e1cc6c7aab18efc01b4a0bd66ab0b9c7f95e06e0e7a55485` |
| `skills/ikran-prototype/SKILL.md` | `ba0574f30743ab9d7f4a5d7551e1e255593a2138fb0440f0be07b51336073730` |
| `skills/ikran-governance/SKILL.md` | `1417a518c6a7dd4ae7ec20b62642384b00185fdc127ba22ebb369aa982b079b8` |

## Isolated real-validation state

- Workspace: `/Users/bingyizhang/Desktop/Ikran Draft Fast Path Dev Test/workspace`
- Database schema: `45`
- Workflow: `alignment-answering`
- Current attempt: `2f1bb753-1180-4717-a2f2-1aedd82e297b` (`answering`)
- Legacy attempt: `01b01f67-e9bd-49b0-9c6d-0f3b8e66b75c` (`abandoned`)
- Question Cards: `16` (`2 / 2 / 3 / 3 / 3 / 3` by Section)
- Answer choices: `49` (15 cards × 3; 1 card × 4)
- Selected choices: `0`
- Final answers: `0`
- Complete remains disabled.

Validation database SHA-256 at capture:
`1ffb4b5b4d8ad18a3cf31bb9ed80f97b43ce2f4d41da74735f8d0d114d00f34d`.

An SQLite-consistent cold backup was created at
`/Users/bingyizhang/Desktop/Ikran Draft Fast Path Dev Test/snapshots/question-card-plugin-candidate-2026-08-28/ikran-question-card-candidate.db`.
Its SHA-256 is
`f5221f3bff2a72f0accd5f4eb9f4b5182d5636cc98230b819b79e39a57fa6099`.

Evidence surface SHA-256 at capture:
`9755fdf80df6e630ea5ff35d60f2552b87d6dcad9d4c2eade248eeb3ea676656`.

The database remains outside Git and outside any future plugin archive. Its
checksum is evidence that the mutable validation workspace matched this
snapshot at capture time; the JSON fixture is the portable semantic record.

## Packaging boundary

The future plugin package must be built from the tagged repository source. It
must not package the source-backed development plugin's `.mcp.json`, because
that file intentionally contains machine-absolute worktree and validation
workspace paths. Use the repository's portable Codex adapter, which invokes
`./bin/ikran-mcp.mjs --prod` from the plugin root.

Do not include runtime endpoints, session URLs, logs, Workbench layout, the
installed Codex cache, or the validation database in the plugin archive.

Before publishing a new version:

1. Choose and apply the next release version consistently to `package.json`,
   `plugin.json`, and host plugin manifests.
2. Run `npm run check`.
3. Run `npm run release:gate -- --version <new-version>` from a clean worktree.
4. Validate the extracted Codex plugin manifest and confirm all four Ikran
   skills plus the full MCP tool surface load in a new Codex task.
5. Re-run the real Alignment handoff and compare the resulting semantic cards
   against the JSON fixture without expecting Runtime-generated UUID equality.

## Capture checks

- Full-chain development plugin passed the Codex `plugin-creator` validator.
- `npm run check` passed outside the restricted network sandbox: 1,422 unit
  tests and 86 end-to-end tests passed.
- The new Alignment attempt was created through Runtime commands, not direct
  SQLite mutation.
- All 16 cards rendered their choices in Workbench and remained unanswered.
- The legacy no-choice attempt was abandoned through the official
  `return-to-seed-reference` path and remains auditable.
