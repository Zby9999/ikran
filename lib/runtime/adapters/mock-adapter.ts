// Deterministic mock AgentAdapter. Returns fixed JSON per task family so the
// full Browser UI -> Runtime -> Adapter -> SSE path can be exercised with no
// real Figma MCP or external CLI. Test modes are driven by payload.mock.

import type {
  AgentAdapter,
  AdapterEvent,
  TaskFamily,
  TaskPayload
} from "../adapter";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const never = () =>
  new Promise<void>(() => {
    /* never resolves: hang mode */
  });

// Family → deterministic output factory. Fresh object each call (isolation).
const MOCK_OUTPUTS: Record<TaskFamily, () => unknown> = {
  project_setup: () => ({
    projectId: "mock-project-0001",
    steps: ["scaffold", "bind-folder", "init-metadata"]
  }),
  generate_seed_alignment_questions: () => ({
    questions: [
      { id: "q-01", text: "What is the primary user goal?" },
      { id: "q-02", text: "Which platforms are in scope?" },
      { id: "q-03", text: "What is the visual tone?" }
    ]
  }),
  draft_design_system: () => ({
    designSystemId: "ds-mock-0001",
    foundations: {
      color: { primary: "#0B5FFF" },
      typography: { base: "Inter" }
    },
    components: [
      { id: "btn", name: "Button" },
      { id: "card", name: "Card" }
    ]
  }),
  reconstruct_seed_prototype: () => ({
    prototypeId: "proto-mock-0001",
    files: [
      { path: "index.html", content: "<!doctype html><h1>mock</h1>" },
      { path: "style.css", content: "body{font:Inter}" }
    ]
  }),
  generate_design_system_view: () => ({
    viewId: "dsv-mock-0001",
    foundations: [
      { id: "color", tokens: [{ name: "primary", value: "#0B5FFF" }] }
    ],
    components: [{ id: "btn", name: "Button", props: [] }]
  }),
  create_new_prototype: () => ({
    prototypeId: "proto-mock-0002",
    basedOn: null,
    files: [
      { path: "index.html", content: "<!doctype html><h1>new mock</h1>" }
    ]
  }),
  rule_update: () => ({
    proposalId: "ru-mock-0001",
    ruleId: "spacing-scale",
    change: "replace 4px base with 8px base",
    rationale: "improve readability at default zoom"
  }),
  export_research_package: () => ({
    exportId: "exp-mock-0001",
    manifest: { files: ["design-system.json", "evidence.md", "questions.json"] },
    format: "json+jsonl"
  }),
  // Type-completion only. real_agent_smoke is routed to the CLI adapter by
  // selectAdapter(), never to the mock; this entry just keeps Record<TaskFamily>
  // total. It returns a schema-valid smoke result so a hypothetical mock run
  // would still pass intake validation (no special-casing).
  real_agent_smoke: () => ({
    message: "mock smoke ok",
    checklist: [
      { label: "runtime reached agent", done: true },
      { label: "agent returned json", done: true }
    ]
  })
};

// Output deliberately shaped to FAIL every family schema (triggers
// invalid_output at the intake point without any hack).
const MALFORMED_OUTPUT = Object.freeze({ thisIs: "malformed", missing: true });

export function getMockAdapter(): AgentAdapter {
  return { run };
}

async function* run(payload: TaskPayload): AsyncIterable<AdapterEvent> {
  const mode = payload.mock?.mode ?? "normal";
  const ticks = payload.mock?.progressTicks ?? 3;
  const delay = payload.mock?.delayMs ?? 60;

  yield { kind: "progress", message: `starting ${payload.family}` };

  if (mode === "hang") {
    // Emit one progress tick, then never yield done. The runner's per-task
    // timeout fires → failed/timeout. Generalizes: a real adapter that hangs
    // is killed the same way.
    await sleep(delay);
    yield { kind: "progress", message: "working (will hang)" };
    await never(); // blocks until runner cancels via iterator.return()
    return;
  }

  for (let i = 1; i <= ticks; i++) {
    await sleep(delay);
    yield {
      kind: "progress",
      message: `step ${i}/${ticks}`,
      data: { step: i }
    };
  }

  if (mode === "invalid") {
    yield { kind: "output", data: { partial: "malformed" } };
    yield { kind: "done", output: { ...MALFORMED_OUTPUT } };
    return;
  }

  const output = MOCK_OUTPUTS[payload.family]();
  yield { kind: "output", data: output };
  yield { kind: "done", output };
}