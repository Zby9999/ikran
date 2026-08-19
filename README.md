# Ikran

Ikran is a local-first research workbench for recursive designer-Agent
alignment around designer-selected Figma seed references. One local Ikran
Runtime exposes two surfaces: a stdio MCP server for the Agent host and an HTTP
Workbench URL for the designer.

This repository is preparing an alpha release. The validated delivery target
is macOS on Apple Silicon. The Draft Release workflow requires a configured
GitHub arm64 macOS larger runner; ordinary public-repository PR checks use the
available Intel macOS runner as a compatibility gate.

## Requirements

- macOS on Apple Silicon. Other operating systems are not yet validated with
  equivalent product capability.
- Node.js 22.13 or newer.
- npm 11.6.2, as pinned by `packageManager`.
- A browser for the Workbench URL.
- Network access to install npm packages and, when using Figma Connection, to
  reach Figma.
- macOS Keychain access. The production Figma credential implementation uses
  the macOS `security` command. Automated tests use an in-memory adapter and do
  not require a real Figma credential.

## Product Test Kit

When consuming a GitHub Release, use its Product Test Kit archive, or use a clean
clone at the corresponding tag. From the extracted or cloned directory:

```bash
npm run setup:product
npm run start:prod -- --folder /absolute/path/to/your-project
```

The Product Test Kit profile installs the build and Runtime dependency set but
omits Vitest and shadcn, then removes the Playwright test runner that npm pulls
only to satisfy Next's optional peer. `playwright-core` and its Chromium binary
remain required for Runtime screenshot and rule capture. The
launcher prints the Workbench URL and opens the default browser. Add
`--no-open` when you only want the URL printed.

`--prod` intentionally refuses to start when the build is missing or no longer
matches the Runtime source.

### Agent host setup

The Product Test Kit root is an [Agent Plugin](https://agent-plugins.org/)
1.0 package (`plugin.json`, `mcp.json`, and `skills/`) and a Claude Code plugin
(`.claude-plugin/plugin.json`, `.mcp.json`, and the same `skills/`). Install
**the extracted Kit directory**, not this Git repository. A clone of the
research repo includes internal archives that must not ship inside a plugin.

After `npm run setup:product`, register the extracted Kit as a local plugin in
a host that supports Agent Plugins (Cursor, Codex, and other 1.0 clients) or
load it in Claude Code with `--plugin-dir`. The host discovers
`skills/design-system-governance` and starts `ikran-mcp --prod`. Leave
`IKRAN_CWD` unset in Agent Plugin hosts so workspace Roots can bind the
designer's project; Runtime state stays under the plugin data directory until
`setup_workspace` pins a project-local `.ikran/`. Claude Code's bundled
`.mcp.json` binds `IKRAN_CWD` and `IKRAN_STATE_DIR` to `${CLAUDE_PROJECT_DIR}`.

Hosts that only speak MCP still launch the same stdio entry. An installed
package exposes the designer launcher as `ikran` and the Agent host entry as
`ikran-mcp`; `ikran-runtime` remains an internal implementation. An installed
adapter can therefore launch:

```text
ikran-mcp --prod
```

From an extracted archive, Cursor and Codex can launch the same MCP entry
through Node using its absolute path:

```text
node /absolute/path/to/ikran/bin/ikran-mcp.mjs --prod
```

The Agent host working directory should be the designer's project folder. Set
both of these values to keep discovery and Runtime state project-local:

```text
IKRAN_CWD=/absolute/path/to/your-project
IKRAN_STATE_DIR=/absolute/path/to/your-project/.ikran
```

For Cursor, the equivalent project-level `.cursor/mcp.json` entry is:

```json
{
  "mcpServers": {
    "ikran": {
      "command": "node",
      "args": ["/absolute/path/to/ikran/bin/ikran-mcp.mjs", "--prod"],
      "cwd": "/absolute/path/to/your-project",
      "env": {
        "IKRAN_CWD": "/absolute/path/to/your-project",
        "IKRAN_STATE_DIR": "/absolute/path/to/your-project/.ikran"
      }
    }
  }
}
```

For Codex CLI/Desktop, register the same stdio entry (the Desktop app shares
the CLI MCP configuration):

```bash
codex mcp add ikran \
  --env IKRAN_CWD=/absolute/path/to/your-project \
  --env IKRAN_STATE_DIR=/absolute/path/to/your-project/.ikran \
  -- node /absolute/path/to/ikran/bin/ikran-mcp.mjs --prod
```

Use `codex mcp get ikran` to inspect it and `codex mcp remove ikran` to remove
it. The command above is the current Product Test Kit interface. Contributors
may drop `--prod` to use the development surface.

For Claude Code, prepare the extracted Kit first, then load it from the
designer's project directory so `${CLAUDE_PROJECT_DIR}` is the project, not
the Kit:

```bash
cd /absolute/path/to/extracted-ikran
npm run setup:product

cd /absolute/path/to/your-project
claude --plugin-dir /absolute/path/to/extracted-ikran
```

That adapter starts `ikran-mcp --prod` and exposes
`skills/design-system-governance`. Do not publish this repository as a Claude
marketplace plugin: `--prod` still requires the production build created by
`npm run setup:product`, which Claude's bounded `npm ci --ignore-scripts` does
not replace.

If you only need the MCP tools without the plugin Skill, register the same
stdio entry at Claude's local scope. Do not commit another machine's Kit path
into a shared project `.mcp.json`:

```bash
claude mcp add --transport stdio --scope local \
  --env IKRAN_CWD=/absolute/path/to/your-project \
  --env IKRAN_STATE_DIR=/absolute/path/to/your-project/.ikran \
  ikran -- node /absolute/path/to/extracted-ikran/bin/ikran-mcp.mjs --prod

claude mcp get ikran
```

After the MCP server is available, ask the Agent to open Ikran. If a host does
not surface the MCP tool, `npm start` remains the launcher fallback for opening
the Workbench URL, but it does not replace the Agent's semantic MCP tools.

## Contributor Verification Kit

Use the allowlisted Contributor Verification Kit attached to the GitHub
Release. It contains the Product files plus the complete automated test corpus
and its configuration, without the repository's research archives. From the
extracted kit:

```bash
npm run setup:contributor
```

A normal Git clone remains available to maintainers who need the complete
research and development history, but it is not the recommended external
verification download.

The Contributor profile installs the Playwright test runner, Vitest, and shadcn
in addition to the Product Tester dependency set. Chromium is required for the
Playwright suite and Runtime screenshot capture.

The standard test command is the fast contributor gate:

```bash
npm test
```

It runs TypeScript checking followed by the Vitest suite. The full gate also
builds the isolated Playwright Runtime and runs the Chromium specifications:

```bash
npm run test:full
```

Available commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next development surface on `127.0.0.1:3000`. |
| `npm start` | Start or reuse Ikran Runtime and open its Workbench URL. |
| `npm run build` | Create a production build and Runtime version stamp. |
| `npm run setup:product` | Install only product/build dependencies, install Chromium, and build. |
| `npm run start:prod` | Start or reuse the production Runtime. |
| `npm run setup:contributor` | Install the complete verification dependency set and Chromium. |
| `npm test` | Run the fast gate: typecheck plus unit tests. |
| `npm run test:quick` | Explicit alias for the fast gate. |
| `npm run test:unit` | Run Vitest only. |
| `npm run test:e2e` | Run Playwright only; its global setup builds first. |
| `npm run test:full` | Run typecheck, unit tests, and Playwright. |
| `npm run check` | Existing alias for the same full gate. |
| `npm run release:build` | Build both deterministic, allowlisted Release archives. |
| `npm run release:gate` | Rebuild, safely extract, clean-install, and verify both archives. |

Automated tests use deterministic Figma and credential adapters. Passing them
is automated evidence; it does not claim that a real Agent host or real Figma
Connection has been validated.

## Release scope

The Product Test Kit archive is for running and product-level smoke testing. It
does not need repository research archives, historical attempts, designer-only
communication, contributor plans, the automated test corpus, or test-only
dependencies.

The Contributor Verification Kit is also an allowlisted lightweight asset. It
adds the full tests and verification configuration to the Product files, while
still excluding `Attempts/`, `.scratch/`, `workflow/`, `Design issue/`,
`Issues 02/`, `Research/`, and other internal research or planning archives.

Release maintainers build the two deterministic archives with:

```bash
npm run release:build -- --version v0.1.0-alpha.3
```

Before a Draft Release is created, the full gate rebuilds both archives,
verifies their checksum and embedded manifest, extracts them with traversal and
symlink defenses, then exercises each clean-download profile:

```bash
npm run release:gate -- --version v0.1.0-alpha.3
```

The Product gate performs an omitted-dev install and drives the extracted MCP
entry through `open_workbench`, the Workbench HTTP shell, Runtime health, reuse,
and shutdown. The Contributor gate runs the complete typecheck, Vitest, and
Playwright suite from the extracted archive. GitHub Release uploads only the two
Kit archives; their manifests are also embedded inside each archive.

## License

Except where a file or directory states otherwise, original Ikran software and
documentation selected into the Product Test Kit or Contributor Verification
Kit are licensed under the Apache License 2.0. See [`LICENSE`](LICENSE).

This grant does not relicense any third-party material, whether or not that
material is present in a Release Kit. The bundled font under `app/fonts/`
remains licensed under the SIL Open Font License 1.1. Third-party names and
brand assets under `public/icons/` remain subject to their owners' rights.
Research archives and project material excluded from both Release
Kits—including `Attempts/`, `.scratch/`, `workflow/`, `Design issue/`,
`Issues 02/`, `Research/`, and third-party Figma or evidence content—are not
licensed under Apache-2.0 by this notice and retain their existing copyright
or license status.

Apache-2.0 does not grant permission to use the Ikran name, logo, or other
project marks except as required to describe the origin of the software.
