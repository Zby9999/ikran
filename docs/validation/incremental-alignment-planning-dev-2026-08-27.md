# Incremental Alignment planning dev gate — 2026-08-27

This document records deterministic Runtime/MCP validation for the development-only
incremental planning path. It is not real-Agent timing evidence and is not a
production cutover recommendation.

## Experiment boundary

- Opt in with `IKRAN_ENABLE_INCREMENTAL_DESIGN_SYSTEM_PLANNING=1`.
- Without the flag, the production MCP instructions and existing Alignment to
  Initial Design System path are unchanged.
- The Workbench UI and visible Alignment states are unchanged.
- Semantic revisions, section deltas, plan checkpoints, and the frozen commit
  boundary are persisted in the project database at schema version 44.
- An interrupted Agent can resume with
  `resume_initial_design_system_planning`; opening an active project returns this
  durable recovery action instead of arming the generic Agent-command wait.

## Deterministic Runtime evidence

The six-section fixture contains three answered Question Cards and one evidence
annotation per section. Measurements use local SQLite and exclude model
reasoning, MCP transport, browser interaction, and designer answering time.

| Measurement | Result | Automated gate |
| --- | ---: | ---: |
| Section read + plan persist, six samples | 3.5–4.4 ms | < 500 ms each |
| Plan-backed semantic commit | 108.9 ms | < 2,000 ms |
| Existing full semantic commit | 92.2 ms | < 2,000 ms |
| Compact semantic claim | 2.3 ms | < 500 ms |
| Compact claim response | 5,537 bytes | < 12,000 bytes |
| Original preparation response | 63,293 bytes | comparison only |

The data supports the intended mechanism: Runtime bookkeeping is not the
dominant cost, and a caught-up plan can reach the existing artifact, lineage,
audit, and Draft gates without asking the Agent to re-read the full Alignment.
It does not prove the 30-second P50 or 90-second P95 real-Agent targets.

## Automated behavior covered

- semantic revisions advance monotonically for final answers and designer
  annotation edits, deletes, and restores;
- a section becomes available only after all of its Question Cards have final
  answers;
- one section delta carries stable source IDs and content digests;
- changing a source invalidates only dependent plan decisions;
- final Complete freezes the semantic revision and digest;
- a fresh, complete plan commits through the existing semantic projection and
  Draft eligibility gates;
- a missing or stale plan cannot create a Draft and explicitly falls back to
  `claim_initial_design_system_preparation`;
- active monitoring wakes on answer changes, persists a paused checkpoint on
  interruption, and resumes from backlog;
- the development MCP contract enters, continues, and recovers the section loop
  without a frontend change.

## Remaining real-Agent gate

Before production cutover, run an isolated realistic fixture with a real Agent:
normal completion, edited answer, interrupted/resumed monitoring, and completion
while the Agent is absent. Record answer-to-delta, delta-to-plan, final
Complete-to-final-delta, semantic commit, Draft-visible, total, P50, and P95.
Until that evidence exists, keep Issue 56 at `ready-for-human` and do not package
or publish this path.
