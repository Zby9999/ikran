# 56 — Dev-Only Real-Agent Incremental Planning Gate

Status: ready-for-human

## User Story

As the study owner, I want to exercise incremental Design System planning in an
isolated development build with a real Agent before changing or publishing the
production plugin.

## Description

Wire the new active and recovery paths into the development Agent contract and
run an isolated end-to-end performance and resilience gate using a realistic
six-section Alignment with pre-existing Question Card and Reference content.
Measure the hidden work that overlaps designer answering and the remaining
Complete-to-Draft latency separately.

This ticket produces evidence and a cutover recommendation. It does not publish
a plugin or make the incremental path the production default.

## Context and constraints

- Enable the experiment only through a development opt-in; production Active
  behavior remains unchanged until a later approved cutover ticket.
- The Workbench UI, Question Cards, submission behavior, and visible workflow
  remain unchanged.
- Use a real Agent host for the manual evidence. Report deterministic automation
  separately and do not present it as real-Agent timing.
- `Wait for Agent Commands` latency is not counted as an optimization delivered
  by this ticket, although waiting and recovery correctness must still be tested.
- Preserve fixture isolation and do not mutate an existing study project.

## Acceptance criteria

- [ ] Active development instructions take the Agent directly from Question
      preparation into the continuous section-monitoring loop without source
      code guidance or broad tool discovery.
- [ ] Each section triggers at most one initial planning pass after all of its
      Question Cards are submitted; a later answer edit triggers a second pass
      only for invalidated dependencies.
- [ ] A realistic run covers all six sections, final Complete, and a valid Draft
      Design System with no visible intermediate planning state.
- [ ] A second run interrupts the Agent during monitoring and resumes through
      `打开 Ikran，恢复当前 Alignment 的答案检查。` without restarting analysis.
- [ ] A third case completes Alignment while the Agent is absent and proves the
      final backlog or existing full-analysis fallback remains correct.
- [ ] Timing evidence separately records answer-submit-to-delta,
      delta-to-plan-persisted, final-Complete-to-final-delta, semantic commit,
      Draft-visible, and total elapsed time.
- [ ] When the plan is caught up at Complete, Complete-to-Draft reaches P50 at
      or below 30 seconds and P95 at or below 90 seconds across the agreed
      repeated fixture run.
- [ ] The report compares like-for-like results with the current approximately
      eight-minute fast-path baseline and distinguishes model reasoning time
      from Runtime write time.
- [ ] Typecheck, relevant unit and integration tests, Runtime/MCP parity,
      production-build compatibility, and real-browser verification pass.
- [ ] No production plugin is packaged or released by this ticket.
- [ ] The final report recommends production cutover, further iteration, or
      rejection with concrete timing and failure evidence; any release or
      cutover is represented by a separate future ticket.

## Technical Notes

- Preserve exact event timings and plan revisions without storing credentials,
  session tokens, or private Agent transcript content.
- The gate should include one normal run, one edited-answer run, one interrupted
  run, and one no-active-Agent fallback run.
- Prefer the same fixture and machine conditions for baseline and experiment so
  the comparison measures the new seam rather than setup variance.

## Dependencies

- 53 — Atomic Finalize-to-Monitor Section Loop.
- 54 — Durable Incremental Planning Recovery.
- 55 — Frozen-Revision Plan-Backed Draft Commit.

## Comments

- 2026-08-28: Automated dev implementation and one-process MCP vertical are
  complete; typecheck, Runtime tests, production-build compatibility, and the
  unchanged Workbench path pass. The feature remains opt-in through
  `IKRAN_ENABLE_INCREMENTAL_DESIGN_SYSTEM_PLANNING=1`. Real-Agent normal,
  edited-answer, interrupted/resumed, and absent-Agent runs plus P50/P95 timing
  are still required, so this ticket intentionally remains `ready-for-human`
  and no plugin is packaged or released.
- 2026-08-28: The product owner approved the cutover as a determined behavior
  before the timing gate was complete. The environment opt-in is removed from
  current code: incremental tools and instructions are now always available,
  Alignment answering resumes through the semantic checkpoint, and generic
  `wait_for_agent_command` fails closed there with the resume action. The
  missing opt-in in the full-chain dev plugin was the reproduced cause of the
  failed recovery. Real-Agent timing and resilience evidence above remain open,
  so this issue stays `ready-for-human`; this decision does not itself publish
  the production plugin.
