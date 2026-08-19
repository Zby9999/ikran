# Issue 07 staged Agent smoke — 2026-07-23

## Result

**Pass.** The Alignment command workflow passes its deterministic one-process
vertical, real Codex Agent Browser Use review, and a host-native Codex Agent
smoke after reloading the Ikran MCP catalog. No result depends on Ikran spawning
a Codex, Cursor or Claude worker, and no deterministic/headless client is
counted as the host-native pass.

## Automated

**Pass** — `tests/alignment-command-staged-smoke.spec.ts` runs one isolated
stdio MCP process that also owns the HTTP Workbench Runtime. It verifies:

- an MCP `wait_for_agent_command` begins before Workbench `Next phase` and the
  resulting preparation command returns to that same pending call;
- immutable snapshot, attempt and command identities are returned by claim;
- returning from `preparing` abandons the first attempt, a new `Next phase`
  creates a different attempt, and a stale MCP write is rejected;
- the second snapshot drives twelve MCP-created questions across the six
  required sections, followed by MCP finalize;
- the already-open Workbench receives `alignment-answering` through SSE,
  switches freely across all six sections and persists a designer-edited answer;
- a second active MCP wait is woken by Workbench `Complete`, which immediately
  projects `initial-design-system-preparing` and a pending
  `prepare_initial_design_system` command;
- Workbench reload preserves the completed stage and pending command;
- after MCP disconnect and one-process Runtime restart, MCP read restores the
  completed attempt/workflow/command and the next wait returns that same pending
  command.

Related regression coverage remains explicit:

- `tests/unit/adaptive-agent-wait.test.ts` uses fake clocks for the rolling
  three-minute boundary, engaged extension, idle/page-close/cancel behavior,
  and proves presence emits no research event;
- `tests/unit/alignment-attempt-abandon.test.ts` and the staged smoke reject
  stale-attempt writes;
- `tests/unit/alignment-completion-handoff.test.ts` covers command durability,
  idempotency and atomic failure;
- Workbench presence is ephemeral and creates no canonical event; the future
  research-export selection also excludes abandoned Alignment lineage while
  the canonical event log remains a complete audit trail;
- only the designer-facing Workbench Complete action can advance Alignment;
  the Agent MCP catalog intentionally exposes no Complete tool.

## Real Agent + Browser Use

**Pass for the portable Browser workflow.** The current Codex Agent used Browser
Use against an isolated latest-code Runtime and mock Figma fixture; no headless
model worker was started.

Observed evidence:

1. Workbench began in `alignment-preparing`; Browser Use selected **Back to Seed
   Reference**, observed `seed-reference-registration`, selected the existing
   **Next phase**, and observed a new `alignment-preparing` attempt.
2. The Agent used the new attempt's actual immutable snapshot (description,
   Seed Reference and Evidence Surface IDs) to author two evidence-linked
   questions in each of the six sections. After semantic finalize, Browser Use
   observed `alignment-answering` and `2/2`, `12/12` progress.
3. Browser Use expanded the existing stage control and selected Visual language,
   Token, Layout, Component, Interaction and Design Concept in arbitrary
   order; every selected button became the current step.
4. Browser Use edited the first answer to “Clarity leads, while expression
   should reinforce comprehension.” The final command payload preserved that
   value as `designer-edited`; the remaining proposals were accepted with
   `agent-proposed-designer-accepted` provenance.
5. A deliberately bounded waiter ended with `idle_no_command` while the workflow
   remained in answering. Browser Use then selected the existing **Complete**;
   Runtime immediately projected `initial-design-system-preparing` and command
   status `pending`. A later Agent read returned the durable
   `prepare_initial_design_system` command first, proving the portable next-turn
   fallback.
6. Reload preserved stage, questions, edited answer and pending command. Trying
   the existing Back control after completion left the stage unchanged.
7. Browser inspection found no visible Codex, Cursor, Claude, Adapter, Wake
   Agent, countdown, waiting banner, toast, or test-only control.

The same-active-waiter path is a deterministic one-process pass above. The real
review intentionally also exercised the complementary offline/next-turn path.

## Visual baseline

Commit `34a703f` is the explicitly checkpointed, pre-ticket Alignment visual
baseline. The no-new-visual requirement applies to the 07A–07G capability work
after that checkpoint. Browser Use found no new visible surface, status panel,
banner, toast, countdown, or Agent-host control in those ticket changes.

An independent Agent repeated the Browser Use review in a separate isolated
fixture. It independently observed the old attempt become `abandoned` and its
command `cancelled`, a new attempt complete, all six stage buttons become the
current step when selected, a designer-edited answer persist, Complete create a
pending Initial Design System command, and reload preserve all of that state.
It made no repository edits and did not count its fixture MCP client as a real
host pass.

## Host-native Codex Agent

**Pass after MCP reload.** A newly created Codex task loaded the native Ikran
catalog with `wait_for_agent_command`, `claim_alignment_preparation`, and
`finalize_alignment_preparation`; it correctly did not expose an Agent-side
Alignment Complete tool.

1. The Agent entered native `wait_for_agent_command` before Workbench **Next
   phase**. A real Workbench engaged interaction occurred before the initial
   three-minute deadline. The same native call remained blocked beyond that
   boundary and returned after 234,604 ms with
   `prepare_design_intent_alignment` for attempt
   `39e6ec89-7b3b-4b5e-b6c3-c9ad2691df6a` and immutable snapshot
   `db6a84ea-5480-450f-9290-a551f2a78224`.
2. Native claim returned the snapshot description and two actual Evidence
   Surface identities. With no safe sub-node identity available, the Agent did
   not invent nodes or regions: it authored twelve meaningful questions using
   legal whole-surface anchors, two per required section, each with a proposed
   answer. Native finalize returned `alignment-answering`.
3. Browser Use observed `2/2`, `12/12`, selected all six sections in arbitrary
   order, and persisted the designer-edited answer “Yes. Preserve a quiet white
   canvas while allowing imagery to carry the primary narrative.”
4. A second native wait first remained blocked instead of replaying the old
   command. Workbench **Complete** then woke it with
   `reason=command_available`, command
   `ecb57ee0-3efb-495c-9f34-a6e01442837a`, and
   `prepare_initial_design_system`. The MCP tool call duration was 26,202 ms;
   the Agent's end-to-end observation was 29,419 ms. Native read-only inspection
   confirmed `initial-design-system-preparing`, Alignment `completed`, and the
   next command still `pending`; the Agent did not claim it. Reload returned the
   next-stage Workbench rather than the editable Alignment view.

The host-native task made no repository edits, clicked neither product advance
control, and used no replacement client. The earlier stale-catalog/schema
blocker is resolved by the successful reload and is retained only in task
history, not as an outstanding result.

## Host-specific activation

- **Codex host-native Ikran MCP: pass**, as detailed above.
- **Codex App Server activation adapter: not attempted.** Issue 07F classifies it
  as post-MVP prototype work in Issue 17.
- **Cursor / Claude activation: not attempted.** Issue 07F classifies current
  official surfaces as limited headless or user-side transports.

## External state and cleanup

The Browser reviews used local Runtime sessions and mock Figma where noted.
No session token, host credential, personal conversation or fixture database is
recorded in this report or committed. The host-native smoke left the next
`prepare_initial_design_system` command pending intentionally.
