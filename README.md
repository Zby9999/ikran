# Ikran

Ikran is a local-first research workbench for designer–Agent alignment around
designer-selected Figma seeds. One Runtime exposes stdio MCP to the Agent host
and an HTTP Workbench to the designer.

Validated delivery target: macOS on Apple Silicon. Node.js ≥ 22.13 and
npm 11.6.2 are required.

## Install

This Git repository is the research source. The installable Agent Plugin is the
**Product Test Kit** on GitHub Releases — a directory with `plugin.json`,
`mcp.json`, and `skills/`.

Do not register this checkout as the plugin root. Keep it only if you need the
research source. Download the newest `ikran-product-test-kit-*.tar.gz` from
GitHub Releases instead; during the alpha, that may be attached to a
pre-release. Extract it to a durable directory outside this checkout, then use
that extracted directory as the plugin root.

To install the Ikran Agent Plugin, follow this path only:

1. Open the latest GitHub Release for this project.
2. Download `ikran-product-test-kit-*.tar.gz`. That is the plugin. Skip the
   Contributor Verification Kit and skip using this clone as the plugin root.
3. Extract the archive to a durable directory. That extracted directory is the
   plugin root.
4. In the extracted directory, run `npm run setup:product`. Done when the
   production build exists (`npm run start:prod` no longer refuses for a
   missing or stale build).
5. Register **that extracted directory** as a local [Agent Plugin](https://agent-plugins.org/)
   1.0 package in the host (Cursor, Codex, and other 1.0 clients). Done when
   the host loads `skills/design-system-governance` and starts
   `./bin/ikran-mcp.mjs --prod` from `mcp.json`.
6. Leave `IKRAN_CWD` unset in plugin config so workspace Roots bind the
   designer's project. Runtime state stays under `${PLUGIN_DATA}/runtime`
   until `setup_workspace` pins a project-local `.ikran/`.

Then ask the Agent to open Ikran (`open_workbench`).

Designer-only launch from the same directory, without a plugin host:

```bash
npm run start:prod -- --folder /absolute/path/to/your-project
```

## Hosts that only speak MCP

Launch the same stdio entry from the extracted Kit after `setup:product`. The
working directory is the designer's project:

```text
node /absolute/path/to/extracted-kit/bin/ikran-mcp.mjs --prod
```

```text
IKRAN_CWD=/absolute/path/to/your-project
IKRAN_STATE_DIR=/absolute/path/to/your-project/.ikran
```

Cursor project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ikran": {
      "command": "node",
      "args": ["/absolute/path/to/extracted-kit/bin/ikran-mcp.mjs", "--prod"],
      "cwd": "/absolute/path/to/your-project",
      "env": {
        "IKRAN_CWD": "/absolute/path/to/your-project",
        "IKRAN_STATE_DIR": "/absolute/path/to/your-project/.ikran"
      }
    }
  }
}
```

Codex:

```bash
codex mcp add ikran \
  --env IKRAN_CWD=/absolute/path/to/your-project \
  --env IKRAN_STATE_DIR=/absolute/path/to/your-project/.ikran \
  -- node /absolute/path/to/extracted-kit/bin/ikran-mcp.mjs --prod
```

This MCP-only path does not load `skills/`. Prefer the Agent Plugin install
when the host supports it.

## Requirements

- macOS on Apple Silicon
- Node.js ≥ 22.13, npm 11.6.2 (`packageManager`)
- Network for npm (and Figma, when using Figma Connection)
- macOS Keychain for the production Figma credential (`security`). Tests use
  an in-memory adapter.

## Other downloads

| Artifact | Use |
| --- | --- |
| Product Test Kit | Run Ikran; install as the Agent Plugin |
| Contributor Verification Kit | Typecheck, Vitest, Playwright from the extracted archive (`npm run setup:contributor`, then `npm test` / `npm run test:full`) |
| This Git clone | Maintainers who need research archives (`workflow/`, `Issues 02/`, …). Not the plugin root |

`--prod` refuses to start when the build is missing or no longer matches
Runtime source. Automated tests use mock Figma and credentials; a green suite
is not a real-host or real-Figma claim. Pull-request Verify requires typecheck
and unit tests; GitHub macOS Intel Playwright is informational and does not
block merge. Product e2e is `npm run release:gate` on Apple Silicon.

Scripts live in `package.json`. Release archives are allowlisted; they exclude
`Attempts/`, `.scratch/`, `workflow/`, `Design issue/`, `Issues 02/`, and
`Research/`.

## License

Original Ikran software and documentation in either Release Kit are Apache-2.0
(`LICENSE`). Third-party material is not relicensed. The bundled font under
`app/fonts/` remains OFL-1.1. Icons under `public/icons/` remain their owners'.
Material excluded from both Kits is not licensed Apache-2.0 by this notice.
Apache-2.0 grants no trademark rights in the Ikran name or marks.
