// scaffold_component_harness: Runtime-owned sizing helper for component live
// hero harnesses.
//
// The helper is protocol glue — it speaks the v2 `ikran:component-size`
// contract the Workbench hero verifies — not project code. It used to exist
// only as prose inside the declare_component_live_heroes tool description, so
// every Agent hand-wrote it (and the frame importing it) from scratch; a
// wrong relative import in one such frame made the dev server answer 500 and
// killed all of that project's live heroes while the declaration still
// succeeded. Runtime now writes the canonical file itself: byte-identical
// every time, idempotent on re-run, and declared by the Agent through the
// normal record_artifact_written ledger like any other code file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  assertArtifactPathInProject,
  resolveProjectArtifactPath
} from "./evidence-package";
import { canonicalizeArtifactPath } from "./source-artifact";

export const IKRAN_COMPONENT_SIZING_PROTOCOL_VERSION = 2;

/** On-demand live-hero harness contract. Rides scaffold_component_harness so
 * MCP tool descriptions stay inside Claude Code's 2048-byte truncation. */
export const LIVE_HERO_CONTRACT_VERSION = 1;

export const LIVE_HERO_CONTRACT = Object.freeze({
  version: LIVE_HERO_CONTRACT_VERSION,
  protocol_version: IKRAN_COMPONENT_SIZING_PROTOCOL_VERSION,
  layout:
    "The Design System Browser renders <previewUrl><harnessPath>. Default route keeps native pointer hover; declared states use ?state=<name>. Reset html/body margin to 0 and overflow to hidden. Wrap the specimen plus symmetric focus/shadow/portal halo in exactly one non-transformed [data-ikran-component-root] at non-negative document coordinates, with no negative overflow; its horizontal extent x + width MUST fit the 1133px presentation viewport.",
  sizing:
    "Install the Runtime helper anew for every default/state document. Bind const href = window.location.href at install time so a queued old-state report keeps its old href. On mount, root ResizeObserver updates, and window resize, read one rect and post { type: \"ikran:component-size\", version: 2, href, x: rect.left, y: rect.top, width: max(root.scrollWidth, rect.width), height: max(root.scrollHeight, rect.height) } to parent. Each default/state navigation must report independently. Legacy body-size/v1 messages are rejected and fall back after timeout.",
  browser:
    "The Browser verifies source + preview origin + current href, preserves the fixed presentation viewport, centers the measured root, grows around tall roots, and proportionally fits roots wider than the hero stage. On failure it falls back to the existing source capture or explicit unavailable state.",
  nextjs_chrome:
    "Suppress framework development chrome locally without disabling it for the normal prototype. For Next.js, add `nextjs-portal { display: none !important; }` to the harness route only; do not set global next.config devIndicators=false."
});

/** Canonical sizing helper source. Deliberately plain JS so the same bytes
 * serve .ts and .js prototype apps; the Workbench validates the wire shape,
 * not the file. Keep in sync with parseComponentHeroSizeMessage. */
export const IKRAN_COMPONENT_SIZING_HELPER_SOURCE = `// ikran-component-harness — Runtime-owned sizing reporter (protocol v2).
// Written by scaffold_component_harness; do not hand-edit — re-run the
// scaffold to update.
//
// Contract: install once per default/state document; href binds at install
// time so a queued old-state report keeps its old href. Reports on mount,
// root ResizeObserver updates, and window resize.
export function installIkranComponentSizing(root) {
  const href = window.location.href;
  const report = () => {
    const rect = root.getBoundingClientRect();
    window.parent.postMessage(
      {
        type: "ikran:component-size",
        version: 2,
        href,
        x: rect.left,
        y: rect.top,
        width: Math.max(root.scrollWidth, rect.width),
        height: Math.max(root.scrollHeight, rect.height)
      },
      "*"
    );
  };
  const observer = new ResizeObserver(report);
  observer.observe(root);
  window.addEventListener("resize", report);
  const animationFrame = requestAnimationFrame(report);
  return () => {
    cancelAnimationFrame(animationFrame);
    window.removeEventListener("resize", report);
    observer.disconnect();
  };
}
`;

export interface ScaffoldComponentHarnessInput {
  /** Project-relative path for the sizing helper, e.g.
   * "prototype/src/lib/ikran-component-harness.ts". */
  helperPath: string;
}

export type ScaffoldComponentHarnessResult =
  | {
      ok: true;
      helper_path: string;
      /** True when the file already existed with identical content. */
      already_present: boolean;
      protocol_version: number;
      live_hero_contract: typeof LIVE_HERO_CONTRACT;
    }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "artifact_path_escape"
        | "helper_file_conflict"
        | "write_failed";
      details?: unknown;
    };

export function scaffoldComponentHarness(
  projectPath: string,
  input: ScaffoldComponentHarnessInput
): ScaffoldComponentHarnessResult {
  const helperPath =
    typeof input.helperPath === "string" ? input.helperPath.trim() : "";
  if (helperPath.length === 0) {
    return { ok: false, reason: "invalid_input" };
  }
  if (assertArtifactPathInProject(projectPath, helperPath) !== null) {
    return {
      ok: false,
      reason: "artifact_path_escape",
      details: { path: helperPath }
    };
  }
  const canonical = canonicalizeArtifactPath(projectPath, helperPath);
  const absolute = resolveProjectArtifactPath(projectPath, helperPath);
  if (canonical === null || absolute === null) {
    return { ok: false, reason: "artifact_path_escape" };
  }

  if (existsSync(absolute)) {
    let existing: string;
    try {
      existing = readFileSync(absolute, "utf8");
    } catch {
      return { ok: false, reason: "write_failed" };
    }
    if (existing !== IKRAN_COMPONENT_SIZING_HELPER_SOURCE) {
      // Never clobber a hand-maintained file; the Agent picks another path
      // or reconciles the drift itself.
      return {
        ok: false,
        reason: "helper_file_conflict",
        details: { path: canonical }
      };
    }
    return {
      ok: true,
      helper_path: canonical,
      already_present: true,
      protocol_version: IKRAN_COMPONENT_SIZING_PROTOCOL_VERSION,
      live_hero_contract: LIVE_HERO_CONTRACT
    };
  }

  try {
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, IKRAN_COMPONENT_SIZING_HELPER_SOURCE, "utf8");
  } catch {
    return { ok: false, reason: "write_failed" };
  }
  return {
    ok: true,
    helper_path: canonical,
    already_present: false,
    protocol_version: IKRAN_COMPONENT_SIZING_PROTOCOL_VERSION,
    live_hero_contract: LIVE_HERO_CONTRACT
  };
}
