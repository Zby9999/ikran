# Component Preview real validation — 2026-08-27

This gate ran against an isolated project with Next.js 16, React 19, local Chromium, and no Storybook dependency or configuration. Temporary project/database paths, browser sessions, and localhost processes were removed after validation.

## Runtime performance evidence

| Metric | Result | Gate |
| --- | ---: | ---: |
| Cold Time to Visual | 5,923 ms | reported separately |
| Cold Time to Verified Candidate | 5,960 ms | reported separately |
| Warm Time to Visual P95 (10 samples) | 888 ms | ≤ 3,000 ms |
| Warm Time to Verified Candidate P95 (10 samples) | 919 ms | ≤ 60,000 ms |

The warm fixture repeatedly declared the same real `TextLink` module with a changed default recipe. Each digest caused one real shared-route render and one internal Verified Candidate event; it required no Story, per-component route, manual code-link backfill, separate live declaration, or Agent verification loop. The Design System entry remained `candidate` throughout.

## Real Browser evidence

- Text Link shared route: visible `Read details 10`, root geometry `108.609375 × 18.5`, no browser warning/error.
- Sticky Navigation `expanded`: visible `Study / Overview · Notes · Sources`, root geometry `251.09375 × 43.5`.
- Sticky Navigation `broken`: intentional runtime exception, zero `[data-ikran-component-root]` nodes, persisted verification result `failed/http_error`.
- Sticky Navigation after returning to `default`: visible `Study / Overview`, root geometry `139.109375 × 43.5`. Its read model remained `surfaceStale=false`, `liveAvailability=available`, `verificationFreshness=failed`, and the Workbench planner still chose `kind=live`; the failed non-default state did not remove the valid default hero.

The first real run also found that `/__ikran/...` maps to a Next App Router private folder and returns 404. The shared adapter was corrected to the routable `/ikran/component-preview/<registrationId>` namespace before the passing measurements above were collected.

## Vite React follow-up

The Ikran Draft Fast Path project exposed a second real failure: its React 18 prototype used Vite, while Preview Registration only recognized a Next App Router directory. A read-only copy of that exact project was replayed after adding the Vite adapter:

- all five existing component specs registered against their exact exports in `prototype/src/components.jsx`;
- the first registration created `prototype/ikran-component-preview.html` plus `prototype/src/ikran/component-preview-registry.jsx`, and the other four reused them;
- the generated registry included the direct `./styles.css` import from the module entry referenced by `index.html`;
- the in-app browser rendered Text Link at the shared adapter URL with a valid `[data-ikran-component-root]` (`98.59375 × 19.5`), both with the default URL and with `&state=hover`, and reported no console warning/error;
- the temporary project copy, browser tab, and Vite process were removed after validation.

## Agent exception evidence

The provider fixture did not enter mechanical verification. Runtime emitted this bounded, digest-pinned packet, and the validating Agent chose an existing structured disposition without changing entry approval state:

```json
{
  "kind": "provider_recipe",
  "exception_digest": "0cd4866fb233e5b78e809bd8d9934e94a49bd902967dc33aac7c6f4c0664a9f3",
  "identity": {
    "run_id": "run-real",
    "entry_id": "component.provider-card",
    "module_path": "prototype/components/ProviderCard.tsx",
    "export_name": "ProviderCard"
  },
  "implementation_delta": {
    "semantic_impact": "possible",
    "provider_recipe": {
      "modulePath": "prototype/providers/ThemeProvider.tsx",
      "exportName": "ThemeProvider",
      "props": { "theme": "study" }
    },
    "undeclared_states": []
  },
  "verification_delta": {
    "status": "not_started",
    "reason": "provider_recipe_requires_judgment"
  },
  "evidence_record_ids": ["card-real"],
  "detected_conflicts": ["provider_recipe_requires_judgment"],
  "disposition": {
    "value": "retain_open_gap",
    "target_category": "open_gap",
    "next_action": "existing_rule_update_review"
  }
}
```

## Automated evidence (separate from real evidence)

Unit coverage verifies registration fail-closed behavior, idempotence, live/freshness separation, default-first resume, digest cache, priority and bounded concurrency, exactly-once Verified Candidate recording, provider-exception validation, true surface failure fallback, migration integrity, timing breakdowns, and MCP instruction cutover. Full-suite results are recorded on Issue 50 after the release gate finishes.
