# 43 — Storybook-free instant code-backed preview

**What to build:** Let one standard implemented component become a live code-backed hero in the Design System Browser through an Ikran-owned Preview Registration and one shared component adapter in the existing Prototype preview environment. The project must not install, configure, start, or depend on Storybook, and the component must not require a bespoke Story or per-component harness route before it becomes visible.

Blocked by: 42 — Code-backed formalization timing baseline.

Status: resolved

## Acceptance criteria

- [x] A declared standard component with an exact module/export and default preview recipe appears as the existing code-backed Browser hero after its default document reports valid geometry.
- [x] One shared adapter per Prototype root renders registered components; registering another component does not create another adapter, Storybook configuration, Story, or per-component harness route.
- [x] The existing Runtime-owned Preview Server and sandbox boundary remain the only execution environment; Runtime never imports project component code into its own process.
- [x] No new intermediate status badge, panel, or other Browser UI is added. Before the live document settles, the existing honest source-capture/unavailable behaviour remains intact, and a broken render never produces a blank hero.
- [x] Warm Time to Visual is measured from accepted registration to the first valid code-backed geometry report and is exposed through Issue 42 timing.
- [x] Automated tests cover registration validation, shared-adapter reuse, Browser live projection, sandboxing, unavailable fallback, and the absence of a Storybook dependency.

## Real Agent validation

A real Agent registers an already-implemented Text Link-level component in a project without Storybook. The designer confirms that the code-backed hero appears without the Agent writing a Story or a component-specific harness.

## Open gaps

- Components that require non-default providers, fixtures, portals, or application state remain explicit preview-recipe cases and are handled by later exception-boundary work.

## Comments

- 2026-08-27: Claimed. Implementing a Next.js App Router shared adapter as the first supported Preview Registration adapter; the registration manifest uses static imports while all project code continues to execute only inside the existing Preview Server sandbox.
- 2026-08-27: Implementation complete. Schema v39, exact export validation, one shared App Router adapter/manifest, `register_component_preview`, and existing Browser liveHero projection pass 54 related tests and typecheck. No Storybook dependency, Story, per-component route, or new UI was added. Real geometry and warm timing remain in Issue 50's consolidated gate.
- 2026-08-27: Resolved. Real Next 16/React 19/Chromium validation confirmed the routable shared `/ikran/component-preview/<registrationId>` adapter, exact default/state geometry, no Storybook, and warm Time to Visual P95 of 888 ms across 10 samples.
- 2026-08-27: Follow-up after the Ikran Draft Fast Path real project exposed `unsupported_preview_adapter`: Preview Registration now selects through an explicit adapter seam supporting both Next App Router and Vite React. The Vite adapter uses one shared HTML/registry pair, preserves `registrationId` while state navigation adds `&state=`, and carries direct CSS imports from the Vite HTML entry module. Prototype confirmation/formalization now reject code-linked Candidate components that have neither a Preview registration nor a resolved `retain_open_gap`; compatibility backfill cannot masquerade as Live Preview completion.
