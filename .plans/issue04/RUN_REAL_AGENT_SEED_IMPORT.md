# Run real Agent seed import locally

This path keeps the normal mock workflow unchanged. Use it only when you want
the Browser UI seed import to call an external Agent CLI for
`seed_evidence_import`.

## Start Runtime in real-seed mode

Stop any existing server on `127.0.0.1:3000`, then run:

```sh
npm run dev:real-seed
```

The script uses a dedicated `.next-real-seed` dev cache so this manual
integration mode does not reuse the normal `.next/dev` cache.

In real-seed mode, the Setup screen Agent choice selects the real CLI profile
used by `seed_evidence_import`:

- Codex -> `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --color never`
- Cursor -> `agent -p --yolo --trust --approve-mcps --output-format text`
- Claude -> `claude -p --output-format text --dangerously-skip-permissions`

Each profile can be overridden independently:

```sh
export IKRAN_CURSOR_AGENT_COMMAND="agent"
export IKRAN_CURSOR_AGENT_ARGS='["-p","--yolo","--trust","--approve-mcps","--output-format","text"]'
export IKRAN_CODEX_AGENT_COMMAND="codex"
export IKRAN_CODEX_AGENT_ARGS='["exec","--dangerously-bypass-approvals-and-sandbox","--skip-git-repo-check","--color","never"]'
export IKRAN_CLAUDE_AGENT_COMMAND="claude"
export IKRAN_CLAUDE_AGENT_ARGS='["-p","--output-format","text","--dangerously-skip-permissions"]'
```

The wrapper requires the selected Agent to return a `figmaProbe.status="ok"`
envelope before the seed evidence package. It checks:

- the returned `fileKey` / `nodeId` match the Figma URL,
- the package preserves the exact Figma URL,
- the package preserves the exact Description / `originalDesignIntent`.

If any check fails, the wrapper returns a blocked JSON object so Runtime schema
validation fails honestly instead of rendering a fake success.

## Browser flow

1. Open `http://127.0.0.1:3000/`.
2. Select/bind a project folder.
3. Select Codex/Cursor/Claude in the setup UI. This only unlocks Start
   Building; the actual seed import is controlled by the env above.
4. Click Start Building.
5. Paste a real Figma design URL into the seed field.
6. Enter the design intent.
7. Click Enter Canvas.

Expected success: Runtime validates the Agent stdout against
`seedEvidencePackageSchema`, renders the Figma Evidence Surface, and writes
`figma_evidence_package_returned` to the project `.ikran/events.jsonl`.

Expected honest failure: if the external Agent cannot access Figma MCP or does
not return schema-valid JSON, the import returns to the Description state and
the task is recorded as failed. This is not a mock success.

## Environment switches

- `IKRAN_SEED_EVIDENCE_ADAPTER=cli`: route `seed_evidence_import` to the CLI
  adapter. `npm run dev:real-seed` sets this for you.
- `IKRAN_AGENT_CLI_COMMAND` / `IKRAN_AGENT_CLI_ARGS`: Runtime adapter command.
  `npm run dev:real-seed` points these at the local wrapper.
- `IKRAN_<AGENT>_AGENT_COMMAND` / `IKRAN_<AGENT>_AGENT_ARGS`: actual external
  Agent profile commands, where `<AGENT>` is `CURSOR`, `CODEX`, or `CLAUDE`.
- `IKRAN_PORT`: optional local port override for the Next dev server. Defaults
  to `3000`.
