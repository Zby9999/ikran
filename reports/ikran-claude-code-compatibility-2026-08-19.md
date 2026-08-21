# Ikran × Claude Code compatibility investigation

Date: 2026-08-19  
Status: research notes from primary sources; no product implementation

## Outcome

Claude Code does not consume Ikran's current `agent-plugins.org` 1.0 package
layout, but this does not block Claude Code users from using Ikran. Ikran's
portable product boundary is already a local stdio MCP server plus an HTTP
Workbench. Claude Code officially supports local stdio MCP servers, so the
existing prepared Product Test Kit can be registered manually today.

For a product-quality installation experience, ship a thin Claude Code-native
adapter in addition to the existing Agent Plugin files. Claude Code has its own
plugin and marketplace system; it expects `.claude-plugin/plugin.json` and a
root `.mcp.json`, not Ikran's root `plugin.json` and `mcp.json`. The existing
`skills/design-system-governance/SKILL.md` can be reused unchanged inside the
Claude plugin because Claude Code supports plugin `skills/<name>/SKILL.md`.

Do not restore the retired design in which Ikran spawns `claude -p` or an Agent
SDK worker. That creates a separate headless conversation with separate tools,
approvals, and UI continuity; it is not an adapter to the user's current Claude
Code session.

## What was verified

- Ikran's documented runtime is stdio MCP + localhost HTTP Workbench, and hosts
  that only speak MCP can start the same `ikran-mcp --prod` entry. See the
  repository [README](../README.md#agent-host-setup).
- The installed local Claude Code is `2.1.191`; it exposes both `claude mcp add`
  and a complete `claude plugin` command family.
- `claude plugin validate .` against the current repository fails with:
  `No manifest found ... Expected .claude-plugin/marketplace.json or
  .claude-plugin/plugin.json`. This confirms a packaging mismatch, not an MCP
  protocol mismatch.
- Claude Code officially supports local stdio MCP, injects
  `CLAUDE_PROJECT_DIR`, and supports `local`, `project`, and `user` MCP scopes.
  Project scope is stored in `.mcp.json`; local/user entries are stored in
  `~/.claude.json`. [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)
- Claude Code plugins can bundle skills, agents, hooks, MCP servers, LSP
  servers, and monitors. Plugin MCP configuration lives in root `.mcp.json` and
  may use `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, and
  `${CLAUDE_PROJECT_DIR}`. [Create plugins](https://code.claude.com/docs/en/plugins),
  [plugins reference](https://code.claude.com/docs/en/plugins-reference)
- Claude Code supports plugin and standalone Agent Skills. Plugin skills live
  at `<plugin>/skills/<name>/SKILL.md`. [Skills documentation](https://code.claude.com/docs/en/slash-commands)

## Path A — usable now: register the prepared Kit as MCP

First prepare the extracted Product Test Kit as Ikran already documents:

```bash
cd /absolute/path/to/extracted-ikran
npm run setup:product
```

Then, from the user's project, register the same stdio entry at Claude's local
scope:

```bash
cd /absolute/path/to/user-project
claude mcp add --transport stdio --scope local \
  --env IKRAN_CWD=/absolute/path/to/user-project \
  --env IKRAN_STATE_DIR=/absolute/path/to/user-project/.ikran \
  ikran -- node /absolute/path/to/extracted-ikran/bin/ikran-mcp.mjs --prod

claude mcp get ikran
```

The user can then ask Claude Code to open Ikran and open the returned localhost
Workbench URL in the system browser. An embedded host browser is not required;
the system-browser path is already an Ikran fallback.

This path provides Ikran's MCP tools and Runtime contracts. It does not
automatically install the optional design-system-governance Skill. That is a
quality difference, not a correctness boundary: Ikran explicitly keeps
correctness-critical behavior in MCP instructions, tool descriptions, and
on-demand command payloads rather than only in a host Skill.

Use `local` scope for the initial documentation because the Product Kit path is
machine-specific. Do not commit another user's absolute Kit path in a shared
project `.mcp.json`.

## Path B — recommended next: dual-format prepared Kit

Add a Claude adapter layer to the allowlisted Product Test Kit while keeping the
existing Agent Plugin files:

```text
plugin.json                         # Agent Plugin 1.0 (existing)
mcp.json                            # Agent Plugin 1.0 (existing)
.claude-plugin/plugin.json          # Claude Code metadata (new)
.mcp.json                           # Claude Code MCP adapter (new)
skills/design-system-governance/    # shared by both formats
bin/ikran-mcp.mjs                   # shared runtime entry
```

The Claude MCP adapter should use host-native variables rather than a relative
working directory:

```json
{
  "mcpServers": {
    "ikran": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bin/ikran-mcp.mjs", "--prod"],
      "env": {
        "IKRAN_CWD": "${CLAUDE_PROJECT_DIR}",
        "IKRAN_STATE_DIR": "${CLAUDE_PROJECT_DIR}/.ikran"
      }
    }
  }
}
```

Generate both manifests from one version/metadata source and test version
parity; do not maintain copied release metadata by hand. The first beta can be
loaded from an already prepared Kit with:

```bash
claude --plugin-dir /absolute/path/to/extracted-ikran
```

This gives Claude Code the MCP server and the existing Skill in one adapter.

## Path C — later: Marketplace distribution

Claude Code supports independent marketplaces and persistent plugin installs:

```text
/plugin marketplace add <org>/<marketplace-repo>
/plugin install ikran@<marketplace-name>
```

However, the current raw repository/Release source must not be published as a
working Claude marketplace plugin yet. Ikran production setup performs more
than dependency installation: it runs a Next.js production build and installs
Playwright Chromium. Claude Code's automatic plugin dependency step uses a
bounded `npm ci --ignore-scripts`; it does not replace `npm run setup:product`,
and Ikran `--prod` intentionally refuses to run without a current build.

Choose one explicit runtime distribution strategy before Marketplace release:

1. Recommended: install/version the Ikran Runtime separately, then let a thin
   Claude plugin provide MCP configuration + Skills and invoke a stable
   `ikran-mcp` executable on `PATH`.
2. Acceptable beta: distribute an already prepared, validated Claude plugin
   artifact that includes the production build and a deliberate Chromium
   installation strategy.
3. Higher-risk: bootstrap dependencies/build/browser into
   `${CLAUDE_PLUGIN_DATA}` on first use. This adds slow startup, network, race,
   update, and partial-install failure modes and should not be the default.

## Claude-specific compatibility gaps

Claude Code's default MCP tool search is helpful for Ikran's 56 tools: it
defers tool definitions and has no fixed per-server tool-count limit. But
Claude truncates every MCP server instruction string and every individual tool
description at 2KB. [Official limit](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)

Current measurements:

| Contract | UTF-8 bytes | Claude limit | Result |
| --- | ---: | ---: | --- |
| `IKRAN_MCP_INSTRUCTIONS` | 2,150 | 2,048 | tail is truncated |
| `declare_component_live_heroes` description | 2,531 | 2,048 | tail is truncated |
| next-largest tool description | 1,758 | 2,048 | within limit |

The server-instruction truncation removes roughly the last 102 bytes, including
part of the formalization tail chain. The essential `OPEN-AND-WAIT` contract is
near the beginning and remains visible, but Claude cannot be claimed fully
compatible until both over-limit strings are reduced below 2,048 bytes.

Keep critical routing text near the front. Move the long live-hero procedure to
an on-demand, versioned contract returned by the relevant preparation/tool
payload, using the same pattern Ikran already uses for `section_contract` and
`source_contract`. Add UTF-8 byte-budget tests at 2,048, not the current 2,150
allowance, and run a real Claude Code smoke of discovery, open-and-wait,
artifact declaration, live-hero verification, and formalization.

## Recommended sequence

1. Publish the manual `claude mcp add` instructions now; no runtime redesign is
   required.
2. Fix the two 2KB truncation gaps and add a real Claude Code smoke gate.
3. Add the two Claude-native manifest files to the prepared Product Test Kit,
   reuse the existing Skill, and validate with `claude plugin validate` plus
   `claude --plugin-dir`.
4. Decide the stable Runtime installation/bootstrap boundary, then publish the
   thin adapter through an Ikran marketplace.
5. Keep Ikran's correctness contract in MCP and treat every host plugin as a
   distribution/quality adapter, not as the product's semantic source of truth.

## Sources

- Anthropic, [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)
- Anthropic, [Create plugins](https://code.claude.com/docs/en/plugins)
- Anthropic, [Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- Anthropic, [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins)
- Anthropic, [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- Anthropic, [Extend Claude with skills](https://code.claude.com/docs/en/slash-commands)
- Ikran, [README](../README.md)
- Ikran, [Agent host activation feasibility](../docs/agent-host-activation-feasibility-2026-07-22.md)
- Ikran, [MCP contract channel split](../Issues%2002/18-mcp-instructions-contract-channel-split.md)
