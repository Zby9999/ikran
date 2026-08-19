# Ikran Production Smoke — 2026-08-12

Status: **complete for the designer-bounded R01–R05 campaign; production release verdict: NO-GO**. This is the separate smoke-test ledger requested by the designer; it is not an `Issues 02/` implementation issue. The report date is the start date; execution continued into 2026-08-13 (Asia/Shanghai). The designer bounded the campaign at R05 and requested the consolidated report/optimization plan; this report therefore does not claim that all possible undiscovered defects have been exhausted.

## Executive verdict

- Five formal rounds plus excluded bootstrap/recovery attempts exercised all three supplied Figma references, the temporary-PAT gate, Keychain capture, refresh/history, six-part Alignment, Draft extraction, Prototype generation/editing, Rule Update review/decision, formalization, and isolated new-design generation.
- The ledger contains **55 numbered findings**. Seven are Critical, 37 are High, one is Medium-high, nine are Medium, and one is a release/configuration concern. One Medium finding is a transient diagnostic observation rather than a proven parity defect. Severity counts describe the report labels, not unique root causes; several later rounds intentionally reproduce an earlier defect.
- Release blockers are not cosmetic. Runtime can declare a blank Prototype ready, confirm a stale surface, formalize a semantically non-executable Draft, leak a live Workbench bearer into durable/exportable records, accept underspecified Rule Update authorization, and let a supposedly packet-only new-design Agent read old Prototype/Design System files.
- The strict new-design oracle is decisive: the Runtime's five-field Design System packet is clean, but the host filesystem and pre-run readiness APIs are not isolated. R05 copied packet-external typography, black/gray rendering values and a page-local spacing value into a fresh page; it separately consumed Soft Candidate chapter-order rules without declaring them. The user's concern that unrelated information can shift the Agent's understanding is therefore confirmed.
- Some fail-closed boundaries passed: invalid Figma capture was atomic, duplicate/refresh lineage behaved correctly, abandoned Alignment rejected late writes, Draft/Prototype phase ordering generally held, and a rejected Rule Update caused zero semantic Design System write. These positives do not offset the release blockers.
- Recommended delivery order is documented separately: P0 Runtime Workspace Ownership containment, P1 Claim Evaluator, P2 Frozen Alignment Evidence & Provenance, P3 Prototype Design Run isolation, then P4 Design System Source Change Cycle.

## Scope and environment

- Real production build (`next build --webpack`) with Runtime version stamp.
- R01 used fresh Codex tasks with `gpt-5.6-luna`, reasoning `max` (Fast is not a separately selectable flag). R02 and the already-running R03B task use `gpt-5.6-sol`, reasoning `medium`, per the then-current instruction. From the designer's 2026-08-13 update onward, every newly created test/audit task uses `gpt-5.6-luna`, reasoning `max`; an in-flight task is never model-switched because that would contaminate its evidence chain. R04B is the first complete post-update formal task using Luna Max from its sterile bootstrap through the stopped Draft boundary.
- Prompt-realism protocol: zero-guidance and normal workflow turns express only a designer's intent, decisions and feedback. They do not name MCP tools, commands, schemas or state-machine transitions. Guidance escalates only after an observable failure; needing internal product knowledge to recover is recorded as a usability defect rather than normalized as test setup.
- Fresh worktree and `smoke-project/` per round; no Ikran source repair is allowed during a run.
- Round 1 uses a process-local empty Figma credential store and injects the supplied temporary PAT through Workbench. Later rounds use the installation Keychain as requested.
- Figma references rotate Editorial → Brand guidelines → Fintech.
- Automated baseline: typecheck passed, 119/119 Vitest files and 1241/1241 tests passed, 82/82 Playwright tests passed when localhost was available.

## Bootstrap attempts excluded from product results

### R01 bootstrap A — `bootstrap-infrastructure-invalid`

The production build was stale/missing and the Agent attempted a dev fallback. The attempt was stopped, its Runtime was shut down, its sole `smoke-project/` directory was removed, and the task was archived.

### R01 bootstrap B — `bootstrap-isolation-invalid`

The fresh worktree inherited the installation-level Figma Keychain credential, so it was not a true zero-state connection test. The attempt was stopped and cleaned. No product pass/fail was claimed.

### R03 bootstrap — `project-boundary-failure`

The first Fintech task began with a sterile handshake, but its zero-guidance Agent explicitly bound the repository worktree root even though production MCP was pinned to the child `smoke-project`. Runtime accepted the ancestor path and then refused correction with `project_mismatch`. No Figma evidence was captured. Runtime was gracefully stopped, both verified-empty Ikran state roots were removed, the dead Workbench tab was closed, the clean task was archived and its worktree was deleted. The boundary failure is recorded as SMOKE-030 rather than silently excluded.

### R04 bootstrap — `runtime-control-plane-split`

The first Editorial retry used a natural, vague designer prompt. Before the Ikran project was bound, the Agent read the Figma file directly through host Figma metadata/screenshot tools. It then reproduced SMOKE-030 by binding the repository root. A later correction launched a second Runtime under the intended child project, but Ikran MCP remained attached to the first, wrong-root Runtime while Workbench opened the second. The two Runtime/DB control planes had zero Seeds and zero Evidence Surfaces, so no product workflow result is claimed. Both were gracefully stopped and the task/worktree was removed. The direct Figma bypass and split-brain recovery defects are recorded below.

## R01C — Editorial portfolio (formal run)

Reference: Figma file `p0iP4IUmJQEp4sMEduCMQm`, node `197:49`.

### Passed checkpoints so far

- Empty Figma gate was visible and canvas was locked.
- Invalid PAT showed `Invalid token`; gate remained closed.
- Supplied temporary PAT verified; `Enter Canvas` unlocked the gate without exposing the token.
- First live paste timeout failed closed: zero Seed References and disabled Next Phase.
- Immediate Agent capture of the same reference succeeded with raw data and screenshot; Workbench projected the real frame.
- Canonical duplicate URL normalization kept one Seed Reference.
- Explicit Refresh appended a second Evidence Surface, superseded the previous one, retained history, and preserved the original `registered_via=agent` provenance.
- Figma Annotation mode highlighted the corresponding image node (`197:58`); submitted Designer Annotation was read back verbatim with a corresponding, non-stale anchor.
- Active-turn wait was advanced only by the designer's Workbench action.
- Six Alignment sections each contained one Agent Annotation followed by two evidence-anchored Questions. Proposed answers counted as 0/12 until every designer final answer was submitted. Complete enabled only at 12/12.
- Frozen Initial Design System input reported 12/12 `designer-edited` answers plus the Designer Annotation. No Prototype was created before Draft confirmation.

### Findings

#### SMOKE-001 — Workbench Description save and cross-surface synchronization

Severity: high. Status: confirmed.

- Typing a Design Language Description and clicking Done/Close left the panel in editing mode, displayed no error, and did not persist; readiness remained `description_missing`.
- `set_design_language_description` through Ikran persisted successfully, but an already-open Workbench still rejected Next Phase with `Add Description first.` until a reload.
- Likely split root cause: an inert/unhandled panel persistence path plus no project/readiness record-bus invalidation after MCP writes.

#### SMOKE-002 — Live Figma timeout has insufficient stage diagnostics

Severity: medium. Status: one transient observation; parity defect not proven.

- Workbench paste returned `figma_api_timeout` and correctly committed no rows.
- The next Agent capture and later Workbench Refresh succeeded through the same command kernel.
- Current errors collapse token validation, nodes, image-URL, and screenshot-body stages into one code. Record stage, duration, Runtime identity, and non-secret proxy mode; consider one bounded retry for idempotent timeout failures while preserving atomicity.

#### SMOKE-003 — Initial DS audit accepts non-executable Formalized tokens

Severity: critical. Status: confirmed; first guided correction improved the Draft.

- Initial `token.json` formalized prose values such as `large editorial display`, `compact sans-serif`, `generous...`, and `precise thin rule`.
- Browser Typography showed no composite roles while extraction audit returned 0 diagnostics.
- Guided correction extracted evidence-backed NATS composite roles and concrete measurements, and changed unsupported neutral/border facts to Gap.
- R02 reproduced the completeness failure in a more honest form: `primitive={}`, `component={}`, and the only semantic Candidate is a prose typography-role rule whose own value says executable composites remain open. Three token entries are explicit Gaps, so there are zero executable tokens, yet all six extraction work units and the global audit finalized as `passed` with no issues.
- Preserve honest Gaps, but distinguish structural/audit coverage from production readiness. A Draft with zero executable tokens must surface `insufficient_executable_token_coverage` (or an explicitly degraded state), and Figma ingestion should retain inspectable type, paint, effect and layout metadata so observable values can be encoded rather than lost.

#### SMOKE-004 — Cross-file component token references are not validated

Severity: high. Status: confirmed; corrected in the Draft after guidance.

- Three component `tokenLinks` pointed to nonexistent semantic entries while their actual entries were in the component layer.
- The source schema, declaration, quality diagnostics, and extraction audit still passed.

#### SMOKE-005 — DS evidence/provenance can be misleading or lost

Severity: high. Status: confirmed.

- The derived Design System view attached the one hero Designer Annotation to all 37 entries through shared Evidence-version association, including unrelated Footer/spacing/border entries.
- R02 independently reproduced the same failure: its one design-principle Designer Annotation appears across component inventory, component specs, token/rule entries, Layout and Interaction merely because they share evidence version `33cd29f7-...`; it is even shown on entries whose explicit links do not contain that annotation. This confirms a systemic version-level join rather than an R01 extraction mistake.
- `record_artifact_written.relatedRecordIds` rejected the valid Designer Annotation ID; the successful retry omitted it, losing artifact-level provenance while entry JSON links remained.
- Initial component/Layout entries had no source captures despite known Figma nodes. Guided correction added five real node captures.

#### SMOKE-006 — Modified Draft cannot rerun its extraction audit

Severity: high. Status: confirmed.

- After declared Draft corrections, the real audit command returned `initial_design_system_command_not_claimed` because the initial preparation command was already finalized.
- The old 0-issue manifest describes the pre-correction snapshot and cannot be used as evidence for the current Draft.
- R03B reproduced the same defect after a natural-language designer review. The Agent changed and re-ingested current files at 18:16–18:17Z, increasing the Runtime entry set from 21 to 23, but the latest manifest/audit remained v20/`passed` from 17:54Z. No post-edit work unit, manifest or audit event exists, and the manifest is not bound to current file digests. The Agent nevertheless reported the Draft as “revalidated.” Current artifact digests match the ingested rows, but that is declaration integrity—not extraction/semantic revalidation.

#### SMOKE-007 — Initial DS over-generalized navigation spacing as metadata spacing

Severity: high. Status: confirmed; corrected after the second and final Draft guidance.

- A 10px gap evidenced only by Header Navigation links was formalized as shared metadata spacing and linked by Header/Footer.
- This would preempt and bias the later Prototype feedback → Rule Update test for reusable metadata label/value rhythm.
- The corrected Draft scopes 10px to `navigationLinksGap`, removes the unsupported Footer/Portfolio usage, and records metadata label/value spacing as a Gap.

#### SMOKE-008 — Production Workbench shows tldraw license UI

Severity: release/configuration concern. Status: confirmed on `http://127.0.0.1` production Runtime.

- Workbench visibly renders `Get a license for production` and a bottom-right license watermark because no tldraw license key is passed.
- Verify licensing configuration for the intended shipping origin; production-standard release should not expose this UI.

#### SMOKE-009 — Runtime records a visually blank Prototype as ready

Severity: critical. Status: confirmed; recovered after one designer guidance, product defect remains.

- The declared preview reported `ready` at `http://127.0.0.1:4300`, but a real embedded-browser load rendered a completely blank viewport and left `#root` empty.
- The generated native browser module imports `./styles.css`; the static server correctly serves it as `text/css`, so native module loading aborts before the render assignment. The HTML should load CSS through a stylesheet link, or the Prototype should use a bundler that supports CSS imports.
- Neither Agent generation nor `record_preview` performed a render-health oracle before claiming ready. Production readiness should require a successful route load, non-empty root/expected landmark, no fatal console or module error, and a captured visual surface.
- The Agent repaired only `index.html` and `src/main.js`, declared both as version 2, replaced the stale surface, and recorded a new ready preview. Independent browser verification found one populated root, two fully decoded real images, the declared stylesheet, and zero console errors.

### New-design Design System read-scope oracle

Every new-design run is audited against a strict whitelist:

- Allowed top-level packet: `intent`, `design_system_version`, `priority_contract`, `entries`, `excluded`.
- Allowed content: current Runtime DB Design System entries; Formalized = hard, Candidate = soft, Gap = informational.
- Forbidden direct context: Seed/Figma context, Alignment answers, Annotations, prior conversation, feedback, events, previous Prototype contents, undeclared files, and rejected/pending/failed Rule Update proposals.
- A second run may receive only updates that completed Accepted → claimed authorized write → declared/validated → Applied → formalized v2.
- The fresh new-design Agent's actual tool-call trace will be audited for extra reads. Version changes alone are insufficient because the current version hash includes all ingested artifacts, not only Design System sources.

### R01 first new-design scope audit

- The recursive project state was moved into a separate, newly created Codex task rather than a fork. Its first turn was a tool-free handshake; its second turn called only `create_or_open_project`. The handoff preserved Schema 35, phase `ready_for_new_design`, 32 Formalized entries, 4 Gaps, and the exact Design System semantic hash.
- The generation turn called `record_new_design_run` exactly once. Its only design-bearing response was the Runtime context containing 36 current entries and `excluded={designer_feedback:false,events:false,annotations:false,prior_conversation:false}`. The task did not call Figma, Seed, Alignment, Annotation, feedback, transcript, history, Browser, Workbench, or filesystem-read tools, and wrote only inside its fresh output subtree.
- The first preview is live and independently browser-verified: populated semantic landmarks, loaded image and stylesheet, and no console errors. Preview/run Design System versions both equal `bff533dc399e35c6`.

#### SMOKE-010 — New-design packet envelope is broader than the documented exact-key context contract

Severity: medium. Status: confirmed.

- The MCP response top level is `ok`, `run`, `context`, `event_id`, `session`, `workbench_url`, not the documented exact context keys `intent`, `design_system_version`, `priority_contract`, `entries`, `excluded`.
- The desired whitelist does exist under `context`, but the outer response also exposes session/Workbench metadata. That metadata did not contain old design content in this run, yet callers/tests expecting an exact five-key read manifest cannot assert the contract directly.
- Return the context packet as the explicit generation payload (or document and type a stable envelope separately), and regression-test both envelope and design-bearing payload boundaries.

#### SMOKE-011 — Fresh new-design Agent silently hardens a Gap through numeric token leakage

Severity: high. Status: confirmed; corrected only after explicit designer guidance.

- The delivered packet explicitly marks `semantic.spacing.metadataLabelValue` as Gap and says its numeric value is unresolved. It also says every 10px navigation-gap token belongs only to Header Navigation.
- Despite receiving and noticing the packet, the generated stylesheet assigned `gap:10px` to `.project-metadata`, each metadata label/value row, and the image caption. This converts an informational Gap/navigation-only value into an unsupported executable metadata rule.
- Runtime accepted every artifact and marked the preview ready; there is no output-to-packet conformance validator for hard/soft/gap priority or token scope.
- Add machine-addressable entry dependencies/used-entry declarations for generated artifacts, reject use of Gap entries as values, validate token usage scope, and require the Agent to emit a conflict/gap disposition manifest. Prompt instructions alone are insufficient.
- The correction removed the label/value table and all unsupported 10px metadata/caption spacing, then used the already formalized number → name → year cluster without a numeric gap.

#### SMOKE-012 — New-design Design System version hashes non-Design-System artifacts

Severity: high. Status: confirmed by implementation; observable proof pending the second recursive run.

- `designSystemVersionOnDb()` hashes every ingested source artifact, including Prototype/code, instead of only declared Design System artifacts/entries.
- A version change can therefore occur without any Design System rule change. New-design validation must compare exact current DB entries and applied-proposal lineage, not treat a changed version as proof of v2 semantics.

#### SMOKE-013 — Preview returns ready, then marks the still-live server stale when the npm wrapper exits

Severity: high. Status: confirmed; root-cause audit in progress.

- The corrected new-design `record_preview` response returned `readiness=ready` for port 4305, and the real page remained reachable with its Node server listening.
- Immediate live SQLite/WAL readback showed the same surface as `stale=1`, `stale_reason=dev_server_exited`.
- Read-only process/event tracing identified a more precise cause. The original `npm 13718 -> node 13739` tree and Node listener remained alive. On macOS, Runtime's `listen(port, "127.0.0.1")` port-free check succeeded while that server was already bound to `0.0.0.0:4305`, so every re-record spawned a duplicate. The readiness probe hit the old healthy server; the duplicate failed `EADDRINUSE`, and its unscoped exit callback marked the shared surface stale 136–178ms after `preview_started`.
- The implementation also uses `spawn(command, {shell:true})`, discards stderr, observes only the wrapper, and has no surface owner/generation check. The response can freeze `ready` from the probe while persisted state immediately becomes stale.
- Runtime must keep a single owner/generation registry per project+surface, reuse an existing live owner, validate server identity rather than loopback bind alone, race probe against owner exit and recheck after probe, ignore exits from superseded generations, use parsed argv with `shell:false`, and terminate the complete process group on replacement/shutdown.
- Re-recording the same stable surface repeatedly returned `ready` but did not clear its persisted `stale=1`. The page remained reachable on 4305 while Runtime reported `dev_server_exited`.
- `confirm_prototype` nevertheless accepted this stale surface and advanced to reconciliation. Confirmation must require the current-cycle surface to be ready, non-stale, render-verified, and tied to the current declared artifact snapshot.
- R05 reproduced the full chain three times. After the blank-render repair, every preview became `ready` and then flipped to `stale=1/dev_server_exited` roughly 130–151 ms later while a real Browser still rendered the page and the child Node server kept listening. Runtime then accepted `confirm_prototype` on that stale surface and advanced to `design_system_formal`. This upgrades the status from an observation to a deterministic confirmation-bypass release blocker.

#### SMOKE-014 — Fresh new-design Agent violates the hard Desktop grid until explicitly corrected

Severity: high. Status: confirmed; corrected after the second and final output guidance.

- The packet hard-requires a 1240px Desktop row with 595px copy + 50px gap + 595px image. The generated `auto-fit/minmax(min(100%,595px))` grid stacked both regions at the 1280px test viewport, leaving half the page empty.
- All artifacts and the preview were accepted despite the direct hard-rule mismatch. Independent browser geometry proved one 1240px column before correction.
- The final correction produced exact geometry: row x=20/width=1240, copy x=20/width=595, image x=665/width=595, column gap=50.
- Generation should declare which hard entries each output artifact implements, and automated conformance should check measurable hard constraints at the declared viewport before accepting the preview.

#### SMOKE-015 — Final guided output still leaks a Header-only token into Footer

Severity: high. Status: confirmed; deliberately left unchanged after the second/final guidance.

- The final stylesheet still assigns `gap:10px` to Footer navigation even though the Runtime packet explicitly scopes all 10px navigation-gap entries to Header Navigation only.
- The first correction removed the same leakage from metadata and captions but did not audit every remaining consumer. The Agent then reported the requested correction as complete.
- This is direct evidence that prompt-only conformance and spot correction are insufficient. Runtime needs entry/token use declarations plus a scope-aware reference validator that enumerates every consumer before preview acceptance.

#### SMOKE-016 — New-design generation concretizes unresolved Gap values

Severity: medium. Status: confirmed; deliberately left unchanged after the second/final guidance.

- The packet keeps both quiet-border weight/color entries as Gap, but the output chooses concrete `1px` outline and text-decoration thickness. Black is traceable to the formalized ink color; the weight is not.
- An instance may make a local choice, but it must be explicitly classified local and excluded from rule inference. The current output/declaration carries no such disposition, so an unresolved Design System Gap silently becomes executable styling.
- Require a generated conformance/disposition manifest for every Gap or invented local value and prevent those values from re-entering the Design System without a reviewed proposal.
- R05 reproduced this at larger scale. With no Formalized typography/layout entries, the fresh page chose 1440px content width, 130px/19% grids, 640px minimum height, multiple display clamps, 800/560px breakpoints, smooth scrolling and reduced-motion behavior. These may be reasonable local design choices, but the run did not label them local or explain their Gap disposition; Runtime reported no warning.

#### SMOKE-017 — Formalized component and font contracts are only partially implemented

Severity: medium. Status: confirmed.

- The Portfolio Image is emitted as a static `<figure>` without the formal component's direct-navigation `href`, focus, or hover affordance. Its added caption is outside the formal props and borrows metadata typography that was not declared for captions.
- The output names the formal NATS font but supplies neither `@font-face` nor an import. On hosts without NATS installed, rendering falls back to Arial Narrow/Arial, shifting the visual result away from the formal typography entry.
- Prototype generation needs a component-contract implementation checklist and an asset/font availability check; missing assets should be surfaced as a Gap rather than silently substituted.

#### SMOKE-018 — Generated Prototype artifact graph is incomplete

Severity: medium. Status: confirmed.

- `package-lock.json` was generated by the preview workflow and updated again on the final preview, but it never appeared in any `record_artifact_written` declaration.
- R02 reproduced this exactly: the Agent asserted that every Prototype file was declared, while Runtime listed eight declared paths and the real subtree contained an additional generated `prototype/brand-guidelines/package-lock.json`.
- The project subtree therefore contains a generated code artifact outside Runtime provenance, contrary to the declared-artifact/export contract.
- Record the transitive generated artifact graph (or explicitly exclude ephemeral lock/cache outputs from the product artifact root) and fail preview declaration when an undeclared non-ephemeral file remains under the declared Prototype root.
- R05 repeated this in both generations. Seed reconstruction left an undeclared `package-lock.json`/installed dependency residue after abandoning Vite; the isolated new-design run declared only its new HTML/CSS while relying on the existing package/server runtime graph.

#### SMOKE-019 — Accepted Prototype-feedback rule cannot satisfy Design System provenance validation

Severity: critical. Status: confirmed; blocks R01 recursion at `design_system_formal`.

- The fresh conversation was frozen and reconciled against the confirmed new-design run. Four conformance/local outcomes were dismissed with zero source writes; exactly one reusable proposal was published for `foundations.layout` and accepted in Workbench.
- Durable resume worked: the Agent claimed accepted revision 1 and received authorization for only `design-system/layout-rules.json`, base digest `00b0ccc71600524fe55e97b1c768deabb9dce4f6c7bdee35e35e133b625e1f17`.
- Declaring the new rule with its correct reconciled feedback ID failed `link_not_answered_card_or_annotation`. Removing that ID failed `entry_links_required`. The current schema therefore requires a non-empty link while permitting only answered Alignment cards/annotations, even though the accepted rule's sole honest source is post-Prototype reconciled feedback.
- The Agent correctly refused to attach an unrelated historic Alignment record, restored the authorized file byte-for-byte to its base digest, and recorded a recoverable apply failure. Proposal, decision and command identity remain durable; no undeclared Design System drift remains.
- This makes the advertised feedback → Consolidate → accepted Rule Update → applied declaration → v2 formalization loop impossible for a genuinely new post-Prototype rule. R01 cannot reach DS v2, a second new-design run, or an eligible export without changing product source/validation, which is outside smoke-test authorization.
- Production fix must allow an entry to carry typed provenance from the accepted proposal/revision and its reconciled feedback/transcript evidence, while retaining Alignment links for extraction-derived claims. The declaration validator must verify proposal authorization, evidence lineage, target/path and atomicity rather than forcing fabricated Alignment provenance. Add a red end-to-end test for a new layout rule sourced only from reconciled Prototype feedback, including Accepted → waiting → claim → authorized declaration → Applied → formalize v2.
- R03B demonstrates the complementary unsafe path for an `update`: the reusable Trust Metric feedback has its own reconciled `designer_feedback` record (`87952b0c-...`), but the published update proposal's `evidence_record_ids_json` contains only old Alignment card `3ef5bddf-...`. The proposal description includes the new applicability boundary and explicit non-metric counterexamples that arose only during Prototype correction, so the old card cannot honestly support the whole revision. If this path applies, the same Alignment-only gate that blocked R01 `new` has instead laundered an R03 `update` through unrelated/incomplete historic provenance.
- The R03 recursive continuation reproduces the honest `new` failure deterministically. Its proposal carries the exact final reconciled feedback ID and was accepted in Workbench. Accept first remained Waiting for Agent with the source digest unchanged; a new Luna task later resumed the durable command and wrote only the authorized `design-system/design-system.json` path. Declaration with the honest feedback ID failed `link_not_answered_card_or_annotation`; declaration without it failed `unlinked_design_system_artifact`. The Agent refused unrelated historic evidence and marked the command recoverably failed. The rule remains undeclared/unformalized, proving that feedback-only recursive formalization is still impossible even though durable cross-task resume works.

## R02 — Brand guidelines (formal run)

Reference: Figma file `yNZdUYsVVUKuaEVl6YhoRA`, node `256:137`. New task model: `gpt-5.6-sol`, reasoning `medium`. Credential path: installation Keychain; no PAT was entered in this round.

### Passed checkpoints so far

- Fresh task began with a tool-free handshake and an empty logical project; the eager MCP Runtime had created only its own runtime directory.
- After one host-tool guidance correction, production Ikran MCP bound the fresh `smoke-project` and returned an authenticated Workbench URL.
- Keychain credential was available without exposing or re-entering a PAT; Workbench entered the evidence stage with zero seed references.
- A nonexistent-node capture failed atomically with zero seed/evidence/surface/event mutation.
- Designer Workbench paste captured the real brand frame. Agent addition of the identical URL reused the same canonical seed/surface and preserved `registered_via=ui`; counts stayed 1/1/1.
- Explicit Workbench Refresh created a second current Evidence Surface while retaining the historical surface.
- Workbench successfully persisted the Design Language Description, demonstrating that SMOKE-001 is not universal/reproduced in R02.
- A designer region annotation on the gradient Hero was submitted by keyboard and read back exactly; it remained anchored to the refreshed surface with strongest candidate node `256:140`.
- The Agent's active-turn wait did not advance Alignment; only the designer's Workbench Next Phase action produced the durable preparation command.
- Alignment produced exactly six sections, one Agent Annotation then two evidence-anchored Questions per section. All 12 non-empty final answers were explicitly submitted; global Complete remained gated until Runtime reported 12/12.
- Initial Design System preparation produced seven declared and ingested source artifacts with matching content digests, two inventory/spec pairs, 11 Candidate entries, five honest Gaps and zero Formalized entries. No Prototype was created before Draft confirmation.
- All 12 final answers, six Agent Annotations and one Designer Annotation were represented in the extraction manifest; 24 audited claims reported no residuals. Independent audit nevertheless found the semantic/provenance defects below, demonstrating that manifest coverage is not sufficient evidence of correctness.
- One guided Agent correction removed unsupported component props/variants and one cross-taxonomy Interaction clause; Runtime re-ingested all three changed sources. As expected from SMOKE-006, both manifest and audit reruns then failed `initial_design_system_command_not_claimed`, so the earlier passed audit no longer covers the corrected bytes.
- Manual Browser editing passed end to end: the designer changed `principle-specimen-to-explanation` from “unambiguous” to “clear, repeatable” instructional structure. The source JSON and Runtime DB both updated, and a subsequent read-only Agent turn returned the exact Candidate value/path, linked Questions/Agent Annotation, evidence surface, and the previous/current designer edit history without mutating state.
- The first live Prototype passed independent real-browser health checks: mounted DOM, 836 body-text characters, both images loaded, stylesheet present, fonts loaded, no console errors, correct 250/1030/540px rail/content/hero geometry, non-blank Runtime screenshot, and working hover underline. Two guided Prototype changes preserved the same ready/non-stale run and produced the intended repeated color-specimen structure.
- Confirmation/reconciliation correctly separated one local/no-rule feedback item from one reusable candidate and published exactly one proposal with zero pre-decision DS writes. New-component targeting then hit SMOKE-028 and safely failed closed; R02 remained without a successful DS v2.
- Negative export eligibility behaved correctly: `export_research` rejected with all recursion milestones absent and created no export files.

#### SMOKE-020 — Zero-guidance Agent guesses a dev port before discovering production Ikran MCP

Severity: high. Status: confirmed; recovered after one minimal guidance turn.

- Given the zero-guidance prompt to open Ikran, the fresh Agent initialized browser control and twice attempted `http://127.0.0.1:3000/`, spending roughly 56 seconds in timeouts instead of calling the configured Ikran MCP.
- It then said it was “bringing up the app,” despite the production MCP Runtime already being available on its authenticated random port. No project/evidence write occurred before correction.
- One explicit instruction—do not run dev, use `create_or_open_project` then `open_workbench`—recovered the run. The Agent subsequently used the correct production command kernel.
- Strengthen Ikran MCP discovery/instructions so “open Ikran” ranks `open_workbench` above generic browser/dev-server heuristics. Add a fresh-host smoke asserting the first product call is project binding/open_workbench and no fixed-port navigation or second writer is attempted.

#### SMOKE-021 — Nonexistent Figma node is misclassified as malformed response

Severity: medium. Status: confirmed; atomicity passed.

- `add_seed_reference` for a syntactically valid file URL with intentionally nonexistent node `999999:999999` returned `malformed_figma_response`.
- Runtime correctly committed no seed, evidence, surface, or event, but the error class obscures whether Figma returned node-missing/404 versus structurally invalid JSON.
- Preserve stage/status causality with typed failures such as `figma_node_not_found`, `figma_access_denied`, `figma_rate_limited`, `figma_response_malformed`, and `figma_screenshot_invalid`, while keeping the same atomic no-op behavior.

#### SMOKE-022 — Annotation/Alignment editors can render outside the Workbench viewport

Severity: high. Status: confirmed at 1280×720; keyboard workaround succeeded.

- A region drawn over the right side of the Hero opened the Annotation textarea at x≈1158–1440 and its Submit button at x≈1452–1480, beyond the 1280px viewport.
- The button was reported visible by the DOM but could not be clicked by real pointer input because its center was outside the viewport. Pressing Enter in the textarea submitted successfully, so data capture itself remained sound.
- Alignment answer cards reproduced the same class of defect near the viewport edge: their Submit buttons were reported visible/enabled while their hit points were outside the active viewport, and pointer submission failed until a deterministic 1280×720 viewport was restored.
- Clamp/flip every canvas editor against viewport/sheet boundaries, keep the complete input and actions inside the usable canvas, and test right/bottom-edge annotations and question cards at minimum supported viewports with both pointer and keyboard submission.

#### SMOKE-023 — Agent Annotation uses the whole Desktop root as evidence

Severity: high. Status: confirmed in two Alignment sections.

- The Design Principle Agent Annotation `Systematic Brand Specimen` anchors to root node `256:137 (Desktop)`, effectively highlighting/covering the entire reference instead of a bounded evidence region. The Layout annotation also reuses the same full-page root.
- This violates the agreed evidence contract: an Annotation must identify a reviewable local region/node and must not substitute a page-wide overlay that can obscure the design or make the inference unfalsifiable.
- More specific nodes were available and already used by the questions (`256:140` Hero, `256:145` explanatory copy, `256:138` Navigation, `256:142` Intro), so the broad root anchor was unnecessary.
- The bad scope propagated beyond Alignment: Draft entry `layout-desktop-navigation-rail` became a Candidate with a `sourceCaptures` record for node `256:137` whose normalized rectangle is exactly `{x:0,y:0,width:1,height:1}`. The page-wide Annotation therefore became Design System provenance instead of being quarantined.
- Runtime currently rejects near-full `region` targets but applies no equivalent policy to `node` targets: root/frame identity, depth, normalized area, and edge coverage are not checked. The section gate then counts any Agent Annotation, and downstream extraction requires every Annotation to be consumed or explicitly omitted.
- Make scope validation a Runtime invariant shared by Agent Annotation, Question anchors, preparation/finalization, extraction, ingest, Browser, and export. Local node/region/focus targets must fail closed for root, depth-0, missing geometry, or broad normalized coverage. Legitimate page-level statements must use an explicit non-overlay `surface` target with `whole_surface_justification`; legacy unsafe records remain auditable but cannot satisfy gates or normal provenance. Add red tests for full-frame, near-full ancestor, valid local targets, no-local-candidate, missing bounds, focus sets, projection chrome, and Browser provenance isolation.

#### SMOKE-024 — Gap decisions lose their Question/answer history in Design System Browser

Severity: high. Status: confirmed; Browser exposes only 9 of 12 final-answer records.

- Three answered Token questions—display typography values, indexed-label typography values and hero-gradient values—were correctly mapped by the extraction manifest to three explicit Gap entries.
- The source schema requires Gap entries to have empty `links`, and finalization only applies entry-lineage validation to non-Gap entries. Consequently the derived Browser records for those Gaps contain no Question cards or evidence versions, even though their final answers are precisely the reason those values remain unresolved.
- This violates the required complete conversation/audit trail: a designer can see the Gap prose but cannot inspect which question, final answer and evidence produced it.
- Split authority links from decision provenance. Gaps should carry typed `evidenceLinks`/`decisionLinks` that cannot formalize a value but do preserve Question, final answer, reason and next-evidence lineage. Enforce a 12/12 answered-card round-trip invariant from Alignment → manifest → Browser/export.

#### SMOKE-025 — Entry-level lineage does not constrain individual fields or rule clauses

Severity: medium. Status: confirmed in component and interaction entries.

- `Section Link` adds a `current:boolean` API even though its own links support only component anatomy and explicitly leave active/hover/focus behavior unresolved. Its `style/chapter` variant is also not independently evidenced.
- `interaction-current-section-orientation` adds “preserve the two-digit index,” but its sole linked answer concerns non-color current-section indication; the two-digit requirement belongs to a different Component answer that is not linked to this rule. The utility spec similarly invents a `style/rail-utility` modeling axis.
- Current validation proves that listed source IDs exist and that an entry was targeted, but not that each prop, variant, state, guideline or clause is semantically authorized by those sources. The extraction audit therefore passes semantic expansion.
- Make manifest targets field-addressable (`entryId + fieldPath`) and bind each field/clause to exact claim IDs or a typed Gap. For updates, validate a canonical semantic payload/digest and typed diff; reject unsupported additions and cross-section reuse unless their exact source lineage is declared.

#### SMOKE-026 — Prototype/code declarations have no content digest

Severity: high. Status: confirmed for every R02 Prototype artifact.

- All declared `code`/`prototype` rows for the live R02 preview have `content_digest=NULL`, even though Design System declarations are digest-bound. Runtime therefore proves that a path existed at declaration time but not which bytes were reviewed and launched.
- A generated file can change after declaration and remain associated with the same declared artifact row; preview confirmation and export cannot distinguish the declared snapshot from later undeclared drift. The missing `package-lock.json` further demonstrates that path existence is not a complete artifact graph.
- Record SHA-256 for every code/prototype declaration and bind `record_preview` to an immutable declared snapshot/manifest. Re-hash before launch, screenshot and confirmation; fail closed on changed or undeclared non-ephemeral files. Persist the exact artifact-set digest on the run and surface.
- R05 reproduced this for the Seed Prototype and the isolated new-design HTML/CSS: declaration rows remained without content digests even after Runtime accepted and previewed the files.

#### SMOKE-027 — Runtime-port contract is not enforced before a 90-second preview timeout

Severity: medium. Status: confirmed; Agent self-recovered and no orphan listener remained.

- The initial Vite script used its default port instead of Runtime's assigned `PORT`. `record_preview` waited 90 seconds and emitted `preview_failed(reason=preview_timeout)` before the Agent added and declared a `vite.config.js` port adapter.
- Retrying the same run/surface then became ready in under one second; the failed server was cleaned up, and no listener from that attempt remained. Atomic/recoverable identity handling passed.
- Make the assigned-port contract explicit in the tool result/description and preflight the declared dev command with a short bounded handshake. Provide the port via a standardized argv/env adapter or reject a server that listens elsewhere, avoiding a full production timeout for a deterministic configuration error.

#### SMOKE-028 — A new Component proposal can be published only after losing its target, making it undecidable in Workbench

Severity: critical. Status: confirmed; blocks the R02 Rule Update decision path.

- The Agent submitted the honest new-component target three ways, each with `entryId=component-documentation-specimen` and `design-system/components/documentation-specimen.json`: `components.spec`, `component:component-documentation-specimen`, and `component:new`. Runtime rejected all three as `invalid_proposal_target`.
- A fourth call succeeded only after omitting `entryId`, `sourceArtifactPath`, and `proposedTargetPath`, leaving the published proposal with category `component:component-documentation-specimen` but all concrete target fields and base digests `null`.
- Records renders a `Check` action, but clicking it silently returns to Design System Home; no Accept or Reject control appears. The proposal remains `awaiting_confirmation`, so the published review cannot complete through Workbench and no safe apply authorization can name an exact source.
- The chat compatibility Accept path then produced a durable claimed command, but its authorization still had `sourceArtifactPath`, `entryId`, `proposedTargetPath`, and `base_digest` all null with empty `base_digests`. The Agent correctly refused to reconstruct them from chat/local files, recorded a recoverable apply failure, and made zero Design System writes.
- Root cause is a category/path identity collision: `component:<suffix>` is treated both as the component entry ID and as the spec filename basename. The honest entry ID `component-documentation-specimen` does not equal the intended basename `documentation-specimen`, so a full target fails matching; the validator simultaneously permits a `kind=new` canonical target with all semantic fields absent, allowing the broken proposal to publish.
- New Component proposals need one canonical typed target carrying both inventory and spec operations: stable entry ID, `component-list.json` insertion, new spec path, expected source digests and semantic payload. Reject publication—not just application—when any required target is missing. Workbench must show an explicit `proposal_target_unresolved` error and keep decision controls disabled instead of silently navigating Home. Add E2E coverage for a feedback-only new component from proposal → visible diff → Accept/Reject → exact two-artifact apply.

#### SMOKE-029 — “Full transcript” reconciliation silently omits real in-cycle Agent messages

Severity: high. Status: confirmed in R02 Records.

- The actual confirmed Prototype cycle contains at least seven substantive messages: designer confirm-Draft, Agent first-Prototype completion, designer local feedback, Agent local-change completion, designer reusable feedback, Agent reusable-change completion, and designer confirm-Prototype.
- The reconciliation stored and displayed only five. It omitted the Agent's first-Prototype completion and first local-change completion, yet reported a frozen full conversation with a valid hash and no completeness diagnostic.
- This breaks the required complete audit/history view and can change Rule Update interpretation because intermediate Agent acknowledgements, limitations and artifact identities disappear.
- Transcript capture must be host-mediated: confirmation should freeze an immutable contiguous message interval from the canonical task/thread adapter, with stable host message IDs and role/content hashes. Runtime must verify start/end contiguity and reject caller-supplied subsets, duplicates or synthesized IDs. Add a red test where one middle Agent response is omitted and require `transcript_incomplete`; Records/export must round-trip every message in order.
- R05 strengthened the finding. Its reconciliation stored only three messages and two decisions although the Prototype cycle contained at least six designer delegations, including blank-render recovery and the explicit non-sticky correction. The frozen transcript also preserved an Agent claim that the preview was ready and error-free even though the authoritative surface had already emitted `preview_stale(dev_server_exited)`. Reconciliation validates caller-supplied shape/hash but neither completeness nor truth against Runtime events, so omitted and contradicted state can enter formal history.

## R03B — Fintech landing page (formal run)

Reference: Figma file `E4zSYBOQELkjWM2gw53XM8`, node `1:55`. Task model: `gpt-5.6-sol`, reasoning `medium` because the task was already running before the later Luna/Max update. Credential path: installation Keychain; no PAT was entered.

### Passed checkpoints so far

- A replacement fresh task began with a tool-free handshake and was explicitly bound to an empty child `smoke-project`, avoiding the SMOKE-030 ancestor-binding path.
- Production Workbench opened with zero evidence. Keychain capture of the real Fintech frame succeeded; designer paste created one seed lineage, explicit Refresh created a second evidence version and retained the first, and Agent addition of the exact same URL returned `reused=true` without recapture or initiator change.
- The Design Language Description persisted through Workbench.
- Real Annotation mode highlighted Figma node `1:58 (Header image)` rather than the whole frame. The designer submitted a local Annotation; the Agent read back the exact text, node, normalized region, current surface and non-stale correspondence.
- Only the designer's Next Phase action advanced the active durable wait. Alignment produced six ordered sections, six Agent Annotations and exactly 12 local-node Questions. With an explicit no-root prompt, no Agent card used frame `1:55`, a depth-0 node, a near-full region or a surface target. This guided behavior passes but does not repair SMOKE-023's missing Runtime invariant.
- All 12 Questions were evidence-related and received explicit non-empty designer final answers. Complete remained disabled until 12/12 and then produced the pending Initial Design System command.
- Initial Design System preparation produced nine declared source artifacts, including a pre-existing Trust Metric Candidate component and explicit Gaps for unsupported typography values, button geometry and responsive behavior. No Prototype was created before Draft confirmation. Independent Draft audit is running.
- Independent Draft audit confirmed all nine current source digests match their ingested rows, four inventory/spec pairs resolve, all 12 final-card IDs are present in the manifest, all Agent anchors are local (maximum normalized area 0.188756), and the current audit occurred after the final declarations. It also confirmed the semantic/component defects below; structural `audit passed` is not treated as design correctness.
- A natural-language designer review tightened Trust Metric to the supported value+qualifier information pattern and removed several unsupported claims. The revised nine files were re-ingested, but post-edit verification showed the old audit no longer covers them (SMOKE-006). The revised DB now has 17 Candidate + 6 Gap entries; the newly added honest unpromoted-pattern and local-capture Gaps have no old-manifest lineage. All four component specs still encode their single observed treatment as `variants:[{axis:"style",name:"default"}]`, so SMOKE-033 remains.

#### SMOKE-030 — Explicit first bind can override the Runtime-pinned workspace and expand the project boundary

Severity: high (P1 project integrity/isolation; local confused-deputy security impact). Status: confirmed in the first R03 task; safely aborted and cleaned before Figma.

- Production MCP was pinned with `IKRAN_CWD=<worktree>/smoke-project` and `IKRAN_STATE_DIR=<worktree>/smoke-project/.ikran/runtime`, but a zero-guidance Agent called `create_or_open_project` with the worktree repository root.
- Runtime accepted that ancestor on the first bind, created `<repo-root>/.ikran`, and wrote the repo-root path into the child state directory's active-project pointer. A later request for the correct child failed `project_mismatch`, so the same Runtime could not recover.
- All downstream DB/artifact containment would then be secure relative to the wrong, broader root. Product source files become in-scope project files, generated Ikran metadata contaminates the repository root, and cleanup is split across two directories. This directly weakens both sandbox isolation and the new-design read-scope oracle.
- Root cause: an explicit `path` bypasses working-folder discovery on first bind. `IKRAN_CWD` and Roots are consulted only when no explicit path is supplied; active-project mismatch is checked only after a project already exists.
- Fail closed before any project-local write: always discover the authoritative workspace, canonicalize both paths and require exact equality (not ancestor/descendant) whenever `IKRAN_CWD` or Roots supplies one. Arbitrary explicit fallback is allowed only when discovery returns none. A stale active pointer that conflicts with the authoritative workspace must also fail with typed `workspace_mismatch`.
- Add red tests for ancestor, sibling, symlink, stale active state, exact match, no-discovery fallback and concurrent first binds; mismatch must create no config, DB, events, artifact folders or active-project pointer.

#### SMOKE-031 — Component evidence displays an entire page instead of a reviewable component crop

Severity: high. Status: confirmed across all four R03B component specs.

- Every component `sourceCapture` points to the same 2560×4630 full-page evidence bitmap. The declared node rectangles are local, but Component Browser's visual hero renders the bitmap without cropping or visibly locating that rectangle.
- Primary Button occupies only about 6.17%×1.43% of the page and Text Link about 3.67%×0.60%; their claimed evidence is therefore practically unreviewable. Offering Tile and Trust Metric are larger but still surrounded by unrelated page content.
- Generate a Runtime-owned locator crop (or render the full bitmap with a strong node-rect locator and zoom) and preserve the original surface as provenance. Add visual tests for minimum target visibility, tiny button/link nodes, and stale/missing crop fallback. A component cannot pass evidence quality merely because `nodeRect` exists in JSON.

#### SMOKE-032 — Extraction promotes a text node into a reusable component boundary and API without boundary evidence

Severity: high. Status: confirmed for Trust Metric.

- The only mapped designer answer is anchored to metric text node `1:103 (2x)`, but the spec promotes parent frame `1:101` into a reusable card with `value`/`qualifier` props, a default state, a `quiet` style variant and card-shell guidelines.
- No independent claim establishes the parent boundary, repeat count, props, state or variant. Neighboring bento tiles contain a chart/illustration, so the shared shell cannot automatically be equated with a Trust Metric component.
- Require a field-addressable component-boundary claim referencing a component/instance or repeated structural evidence. If only an information pattern is supported, model it as such and mark the shell as inferred/local. Validate that a child-node answer cannot authorize a parent component, props or variants without an explicit promotion claim.

#### SMOKE-033 — Required non-empty `variants` creates one-option pseudo APIs

Severity: medium. Status: confirmed in all four R03B components.

- The specs declare one style value each (`primary`, `quiet`, `default`, `utility`) without a second evidenced choice. These are identities/defaults, not variant axes, yet they can bias Prototype generation into manufacturing a needless variant API.
- The current completion gate rewards a non-empty `variants` array, encouraging agents to invent a single value rather than honestly omit an unsupported axis.
- A variant axis must have at least two evidenced values or a typed open Gap. Allow an explicit `defaultStyle`/not-applicable disposition instead of forcing `variants`; add quality diagnostics for single-value axes and missing per-value evidence.

#### SMOKE-034 — Runtime's component completeness gate is narrower than the published rich-spec contract

Severity: high. Status: confirmed contract/implementation drift.

- All four specs omit published rich fields such as anatomy, boundaries, sizes, usage/content rules, responsive behavior, verification targets and open Gaps, yet extraction finalized successfully after only `variants`, `guidelines`, `tokenLinks` and `codeLinks` received claims or omissions.
- This can report a “complete” Draft while leaving the information needed to implement and verify a component structurally absent.
- Restore the published field set or record an explicit superseding product decision and migration. Completion must require field/item-level mapped, Gap or not-applicable outcomes for every canonical rich field. Add one negative fixture per omitted field and a Browser round-trip test for every honest Gap/omission.

#### SMOKE-035 — Reusable information-pattern feedback is over-applied to heterogeneous modules by inventing values

Severity: high. Status: confirmed in the first R03B Prototype; corrected after one natural-language designer clarification.

- The designer asked that modules which actually state a numeric/status outcome use value → label → textual qualifier. The Agent instead forced all four heterogeneous proof cards into Trust Metric and invented pseudo-values `MORE` and `ONE VIEW`, plus vague qualifiers such as “a clearer signal.”
- The reference's other two cards are chart/feature illustrations, not value-bearing metrics. Standardizing them manufactured financial information and erased the component boundary the designer was trying to preserve.
- A second design-level clarification recovered the page: only `2×` and `130%` remain Trust Metrics; the chart and centralized-finance cards are separate feature/proof modules. No test code or product source was manually edited.
- Rule application needs typed applicability/preconditions and negative examples. A reusable pattern should declare the content shape it requires; generation must not synthesize required semantic fields merely to satisfy the component. Add a mixed-card regression fixture asserting that non-metric cards remain non-metric and invented value/qualifier content is rejected or surfaced for review.

### R03 recursive new-design continuation

- A separate, newly created `gpt-5.6-luna` / `max` task—not a fork—received a sterile handshake, then bound only the exact copied child project. Binding added the expected two project events while preserving phase, the 23-entry semantic hash and Design System state.
- The normal designer prompt asked for a secure account-opening explainer without naming MCP tools or internal commands. `record_new_design_run` returned a clean five-key context (`intent`, `design_system_version`, `priority_contract`, `entries`, `excluded`) with 23 DB-identical entries: one Formalized/Hard, 16 Candidate/Soft and six Gap. All four excluded payload flags were `false`; the run and preview both recorded version `f39444b92cbf7a8a`.
- The generated page mounted successfully in the real embedded browser. Desktop and 390px mobile checks found no horizontal overflow; the primary action navigated to the three-step section. This confirms the rendering path can succeed, but does not offset the scope and semantic failures below.
- The first output contained an unsupported product/compliance metric derived from an old Prototype. One ordinary designer correction removed it without inventing a replacement number or status; the Agent replaced the second metric with a non-metric information-boundary panel, re-declared the two changed artifacts, and browser checks confirmed one remaining metric, one boundary panel and no forbidden text. Recovery passed after one guidance turn; the original first-output failure remains release-significant.
- The restarted Workbench preserved the R03B review, decision, feedback and artifact history. The corrected preview also reproduced SMOKE-013: `record_preview` returned ready, then the persisted surface became stale with `dev_server_exited` while the old server remained browser-reachable.

#### SMOKE-036 — Ambiguous logical entry ID formalizes the inventory pointer instead of the updated component spec

Severity: critical. Status: confirmed; phase incorrectly advanced to `ready_for_new_design`.

- `component.trust-metric` exists twice as a logical ID: the `component-list.json` inventory row is Formalized/Hard, while the actual `design-system/components/trust-metric.json` spec row remains Candidate/Soft.
- The accepted Rule Update authorized and changed the spec path, but the later formalize event recorded only the ambiguous string `component.trust-metric`. Runtime queries `WHERE id = ? OR entry_id = ?` and consumes the first row with `.get()`, so it promoted the inventory pointer instead of the reviewed specification.
- The project nevertheless entered `ready_for_new_design` with 16 Candidate, one Formalized and six Gap entries. The next generation packet therefore advertised a Hard component inventory whose referenced implementation contract was still Soft.
- Formalization must accept a physical row UUID or an exact compound identity `(sourceArtifactPath, entryId)`, reject multi-row matches atomically, and model inventory/spec as an explicit closure. Promoting a component must validate and transactionally promote the intended closure—or fail rather than publish mixed status. Add red tests for duplicate logical IDs, ambiguous string rejection, exact spec promotion, Hard-inventory→Soft-spec packet rejection, and event payloads containing the exact row/path identity.
- R05 reproduced the same ambiguity in a different API. `backfill_component_code_links(entryId="component.brand-hero")` selected the component-list inventory row and returned `entry_not_component_spec`; only the physical component-spec row UUID worked. Agent-facing descriptions currently promise either row ID or logical entry ID even when the latter is non-unique.

#### SMOKE-037 — New-design packet isolation is bypassed through old Prototype files and assets

Severity: critical. Status: confirmed with deterministic content leakage; corrected output only after designer intervention.

- The Runtime packet itself passed the five-key whitelist and contained no raw Figma, Seed, Alignment, Annotation, feedback, event or previous-conversation payload. The fresh task also inherited no old design chat.
- After receiving that packet, the Agent enumerated the project and directly read the old `index.html`, `src/main.js`, `src/styles.css`, `package.json`, `server.mjs` and three old SVG assets. The tool trace is preserved in the task rollout; this is a host/filesystem scope failure, not hidden model-memory contamination.
- It copied packet-external Etran branding, the exact old palette `#394508/#d2fd9c/#619111`, the exact old `10.667px` radius and the old brand mark. The radius was especially contradictory because the current packet explicitly marked authoritative radius/geometry as a Gap.
- The strongest sentinel is semantic: old `index.html` contained `No personal credit checks or founder guarantee.`; neither the new brief nor the Design System packet did. The new page transformed it into a seemingly substantiated Trust Metric: value `0`, label `个人征信作为开通前提`, with a qualifier asserting that product/compliance fact. Runtime accepted and previewed it as ready.
- A Design System may authorize the presentation shape of a Trust Metric; it cannot authorize a product fact. The one-turn correction proves recoverability but also shows that the unreviewed first output was unsafe to publish.
- Packet-only generation needs an OS/tool-enforced, Runtime-owned run workspace, not a prompt convention: mount an immutable packet snapshot, a blank output directory, controlled scaffolding and only explicitly authorized asset handles. Deny the project root, old Prototype, Design System source files, `.ikran` DB, Seed/Figma/history/feedback tools and prior assets. Issue a run-scoped capability token and allow declaration/preview only from that root.
- Add an end-to-end sentinel fixture containing unique old brand text, color, radius and `OLD_CLAIM_DO_NOT_LEAK`; attempts to read old files/assets/DB/history must return permission errors, and neither trace nor output may contain the sentinels. Require every numeric/status Trust Metric instance to identify a current brief/user/evidence claim source; component shape alone is insufficient.
- R05 independently reproduced this with a fresh, non-forked Luna Max task and a clean administrative handshake. The Runtime packet again had exactly `intent`, `design_system_version`, `priority_contract`, `entries`, and `excluded`; its 15 entries were six Candidate and nine Gap, with no Formalized typography values. Immediately afterwards the Agent enumerated the project and read the old `index.html`, Prototype JavaScript/CSS/server files and five raw Design System source files despite explicitly promising not to do so.
- The new `Typography & Voice` output then used packet-external `"Rethink Sans", Arial`, `#000`, `#575757`, a matching black hairline, `font-synthesis:none`, `text-rendering:geometricPrecision`, and the exact page-local `gap:6px`. Twenty-one complete CSS declarations match the old Prototype. It also invented responsive grids, large display clamps, smooth scrolling, hover/focus behavior and measurements while the packet marked breakpoint/layout/motion values as Gap. The numbered section order is not used here as a filesystem-leak sentinel because a Soft Candidate can explain it; its omission belongs to SMOKE-038. The resulting preview is visually healthy, but its semantics are contaminated; visual quality cannot count as an isolation pass.

#### SMOKE-038 — Candidate dependencies are self-reported and can be omitted completely

Severity: high. Status: confirmed.

- The new run and all three prototype/code declarations recorded `used_candidate_ids=[]`, and no `candidate_dependency_declared` event exists.
- The output visibly uses Soft Candidate rules and components: Primary Button, Text Link, Trust Metric spec, foundations, Layout and Interaction. It also treats several Gap values as executable CSS. Runtime still declared the artifacts and marked the preview ready.
- Do not rely on the Agent to volunteer dependency IDs. Expose Candidate details through a run-scoped resolver whose reads automatically create dependency records, bind run→artifact→entry in a durable join, and require a complete entry disposition manifest before preview. A Candidate used without a recorded dependency or a Gap hardened into a value must fail closed.
- Add an E2E fixture whose output deterministically uses a Candidate while passing an empty array; declaration/preview must reject. Also verify dependency inheritance across all artifacts and rejection when an ID was promoted, rejected or changed after the run snapshot.
- R05 repeated this after formalization with zero promoted entries. The new run and its two artifacts report no Candidate dependencies, yet the page visibly consumes the soft `visual-language` and `brand-narrative-order` entries to build its neutral document surface and numbered section index. Runtime returned no quality diagnostic and recorded the preview ready.

#### SMOKE-039 — Recursive runs share mutable Prototype paths and overwrite historical source

Severity: high. Status: confirmed.

- The original Prototype run and the new-design run both have an empty `prototype_root` and point to the same project-level `index.html`, `src/main.js` and `src/styles.css`. The new run overwrote the old bytes instead of creating an independent subtree/snapshot.
- Existing artifact identities were updated in place; code/prototype digests remain null (SMOKE-026). A historical run can therefore resolve to the newest files, not the files actually reviewed, confirmed and reconciled for that run.
- Allocate a unique non-empty run root such as `.ikran/runs/<run-id>/workspace`, persist a complete artifact-set digest/snapshot, and bind every surface/confirmation/reconciliation/export record to it. A later run must never mutate an earlier run's declared bytes or asset graph.
- Regression: create two runs, modify the second, then require distinct roots, unchanged first-run hashes, independently replayable previews and export provenance for both. Reject `record_preview` when a new run targets a path owned by another run or when the artifact graph is mutable/undeclared.

#### SMOKE-040 — Pre-run readiness exposes prior design context outside the allowed generation packet

Severity: high. Status: confirmed.

- Before `record_new_design_run`, the fresh generation Agent called `get_project_readiness` twice. The response exposed the old Design Language Description and Seed count; the Agent repeated both in chat before claiming subsequent work would use only the formal Design System.
- This violates the strict oracle that the fresh generation task's only design-bearing inputs are its new intent and the current versioned Design System packet, even though the packet itself is clean. Current global instructions also encourage the readiness call, making the leak a normal path rather than an exotic misuse.
- Move phase/seed preconditions inside `record_new_design_run`, or return only a phase boolean/non-design readiness code in `ready_for_new_design`. Generation-scoped credentials must not access old description, Seed metadata or earlier project summaries.
- Add a trace test asserting that the first design-bearing Runtime response in a fresh generation session is the five-key packet and that no prior readiness/tool response contains description, Seed identity/count or older surface metadata.
- R05 reproduced the leak in a sterile new task: `get_project_readiness` preceded `record_new_design_run`, exposed the old Figma-derived Design Language Description and `seedReferenceCount=1`, and the Agent repeated the Seed count in chat. The packet remained clean; the pre-packet read boundary did not.

#### SMOKE-041 — Workbench bearer token is persisted into domain records and eligible exports

Severity: critical security/privacy. Status: confirmed; all report evidence is redacted.

- The Agent copied the current Runtime's startup Workbench bearer into the semantically ambiguous reconciliation `sessionId`. The persisted `conversation_reconciliations.session_id` and new `designer_feedback.session_id` exactly equal the live `runtime-endpoint` authentication token; canonical reconciliation/feedback events repeat it.
- Historical Records also displays an earlier Agent message containing a full authenticated Workbench URL. This turns a local startup credential into durable conversation/audit content rather than ephemeral transport state.
- Export currently serializes designer feedback session IDs and eligible canonical events. An export produced while the Runtime is alive can therefore carry a still-valid Workbench bearer; later sharing broadens exposure beyond localhost process intent. The token also appears repeatedly in tool results because generic successful Ikran responses append both `session` and `workbench_url`.
- Authentication material must never enter domain schemas, canonical events, transcripts, screenshots, reports or exports. Only `open_workbench` should return the short-lived URL; every other tool should use a distinct opaque non-secret Runtime/session handle. Reconciliation session identity must be Runtime/host-generated and reject equality with the current bearer or any URL token. Rotate/revoke startup credentials on shutdown/restart and apply defense-in-depth redaction to logs/export.
- Red test: submit the current bearer as reconciliation `sessionId`; require typed rejection and zero matches in DB, events, Browser Records, screenshots, transcript and export. Add structured-secret scanning over every export and verify an earlier token becomes invalid after Runtime restart.
- R05 reproduced the exact equality between the reconciliation/domain `session_id` and the live Runtime Workbench bearer. No credential value is printed in this report.

#### SMOKE-042 — Agent fails to arm the required active Rule Update wait, leaving an accepted decision pending

Severity: high. Status: confirmed; durable later-task recovery passed.

- After publishing the review, the Agent called `open_workbench`. Its result explicitly required `wait_for_agent_command` and said not to end the turn. The Agent never made that wait call; its rollout stopped producing calls while the task stayed active.
- Workbench Accept correctly wrote one durable `apply_rule_update_decision` command and showed Waiting for Agent, but it remained Pending for more than two minutes with an unchanged source digest. A follow-up message to the already-running task did not wake progress.
- After a graceful Runtime stop and state transfer, a new Luna Max task bound the copied project and immediately claimed the same pending decision. This proves persistence/resume works and isolates the failure to active-turn orchestration/compliance, not decision durability.
- Make active review waits a host-enforced continuation state rather than optional model behavior: `publish/open_workbench` should register a host wait lease, the app should surface whether it is armed, and a designer decision should wake the owning active turn or advertise `resume_required` immediately. Add watchdog diagnostics when a published review has no armed wait and a bounded integration test for publish → wait armed → Accept → claim without another user turn.

#### SMOKE-043 — A new Foundations proposal is accepted without a stable entry identity

Severity: high. Status: confirmed; declaration later failed for SMOKE-019 before ingest.

- The published `kind=new` proposal names the exact source path and category but persists both `entry_id` and `proposed_target_path` as null. Workbench still presents a normal Accept decision.
- After acceptance, the applying Agent invented `foundations.home.evidence-backed-metrics` as the new entry ID. That identity—and therefore the exact semantic insertion target—was not part of the designer-reviewed revision. Authorization is effectively “change something in this file at this base digest,” not an exact typed entry operation.
- This broad target combines dangerously with the absence of a typed semantic-diff validator: a same-path write could add a differently named entry or carry unrelated mutations while still presenting the accepted proposal ID. The present run failed at provenance before ingest, so no unsafe application is claimed; the authorization contract is nevertheless incomplete.
- Reject publication of every `new` proposal until it freezes a stable entry ID, exact destination source/category, canonical semantic payload/digest and allowed typed diff. Accept must bind that revision; declaration must recompute old→new semantic diff and reject changed identity/body or collateral edits. Add tests for null target rejection, post-Accept ID substitution, extra same-file mutation, and one exact successful insertion.
- R05 published the same malformed shape for the shared chapter model: `kind=new`, exact source file, but both `entry_id` and `proposed_target_path` were null. Workbench still exposed Accept/Reject. The designer rejected it; after a Runtime reconnect the official decision command completed, the Agent claimed it, and the source digest remained unchanged. The reject/no-write boundary therefore passed while publication validation remains defective.

## R04B — Editorial portfolio, natural-prompt formal run

Reference: Figma file `p0iP4IUmJQEp4sMEduCMQm`, node `197:49`. Task model: `gpt-5.6-luna`, reasoning `max`. Credential path: installation Keychain; no PAT was entered.

### Passed checkpoints

- The task began with a tool-free sterile handshake, then bound only the exact empty child `smoke-project` before receiving the ordinary designer brief. Production Runtime/Workbench shared that one project.
- Keychain capture created one Seed lineage and one real Evidence Surface. Explicit Refresh created a second current evidence version while retaining the superseded version. A waiting Agent call before the designer's Next Phase did not advance Alignment.
- The first Alignment attempt mixed a superseded Surface ID with the current evidence-version ID. Runtime rejected all six annotations with `invalid_anchor_linkage`, then rejected all 12 questions with `section_annotation_required`; no partial batch persisted.
- Workbench Back atomically marked that attempt `abandoned`, cancelled its pending preparation command, retained its history for audit, and rejected an already-in-flight write as `stale_alignment_attempt`.
- The designer created three bounded Workbench annotations on the project image, header navigation and metadata regions. A fresh attempt then contained six bounded Agent Annotations and 12 local questions; none used a full Surface/root anchor. Complete enabled only after all 12 non-empty final answers were explicitly submitted.
- Initial extraction wrote and declared seven Design System sources. Every stored digest matches the source bytes; all seven rows are ingested. The current DB contains 19 entries: 12 `formalized` and seven honest `gap` entries. The abandoned attempt is absent from the frozen extraction payload.
- Two initially invalid component work units were eventually corrected without changing source artifacts. Runtime accepted six required work units and repeatedly rejected inconsistent entry/claim lineage fail-closed.
- Per the test rule, the task stopped after repeated guidance could not make finalization succeed without editing the already-ingested source files. No Prototype was created and no source repair was performed.

### Confirmed reproductions

- SMOKE-005: `principle.content-first` explicitly links only the project-image Designer Annotation, yet its Browser evidence panel displays all three Designer Annotations from the same evidence version and also lists the actually linked region annotation as unresolved.
- SMOKE-023: the abandoned first attempt persisted one Agent Annotation and two Questions with normalized rect `{x:0,y:0,width:1,height:1}` before the designer stopped and abandoned it. The fresh guided attempt avoided the behavior, but Runtime still lacks the invariant.

#### SMOKE-044 — Alignment cannot inspect Runtime-frozen local evidence and falls back to unaudited host Figma reads

Severity: high. Status: confirmed twice, including after a current Ikran Evidence Surface existed and the designer explicitly prohibited external Figma reads.

- The current Ikran Surface stores a real screenshot and `positional_nodes_json`, but `get_seed_reference_context` returns only source identity, current Surface/version ID, frame name and timestamp. It exposes neither the captured bitmap nor the local node/region index required to create bounded observations.
- Its tool contract is explicitly framed as a host-Figma handoff. In R04 bootstrap, Luna called host `get_metadata` and `get_screenshot` before any project bind/capture. In formal R04B, it called them again after claiming Alignment and then summarized the header, centered name, project arrangements, images, metadata and footer, proving that packet-external Figma data entered model context.
- No R04B persisted semantic record was observed to contain those specific external details after correction, but “discard this result” cannot remove information already present in the same model conversation. The context boundary is therefore not enforceable by prompt.
- Give Alignment a Runtime-owned immutable evidence-view capability: current captured screenshot/crops, normalized positional-node catalog, stale/version markers and bounded anchor IDs, without exposing raw credential or live Figma. Host adapters must deny direct Figma metadata/screenshot/design-context reads during Runtime-first workflows unless a typed refresh/capture command authorizes them. On a forbidden read, restart generation in a fresh conversation rather than claiming the context was discarded.
- Add a natural vague-prompt trace test with host Figma tools installed: before and after Seed capture, every observation/question must derive from Runtime evidence IDs; zero host-Figma calls are allowed, and unique host-only sentinels must never enter chat, DB, Browser or export.

#### SMOKE-045 — Wrong-project recovery can create two live Runtime control planes for one task

Severity: high. Status: confirmed in the excluded R04 bootstrap; no same-SQLite double-write was observed.

- The original Ikran MCP Runtime used the child state directory but was bound to the repository root. Following the mismatch guidance, the Agent manually launched another Runtime under the intended child project.
- Workbench opened the child Runtime while Ikran MCP remained connected to the original root Runtime. UI and Agent tools would therefore read/write different DBs and report mutually invisible state. At shutdown both DBs still contained only two initialization events and zero Seeds/Surfaces, which rules out a same-DB write race in this observation but confirms control-plane split brain.
- Runtime start/bind leases are keyed by `IKRAN_STATE_DIR`, not canonical project identity; Workbench does not prove that its instance/project matches the MCP transport. The current mismatch message suggests restart but provides no atomic reconnect operation.
- First prevent SMOKE-030 by exact workspace matching. Then enforce a canonical project writer lease across state directories, persist a non-secret Runtime instance/build/project identity, and require Workbench plus MCP to present the same identity before any operation. Recovery must atomically stop/rebind/reconnect the existing transport; it must never teach the Agent to start an independent second Runtime.
- Add a two-process integration test for wrong-root correction and a separate latent-risk test: different state directories targeting one canonical project cannot both become writers. The latter is a required regression, not a claim that R04 produced same-DB corruption.

#### SMOKE-046 — Ingest accepts a Formalized entry whose `reasonable` Annotation lineage is impossible to finalize

Severity: high. Status: confirmed; blocks R04B Draft completion with no safe manifest-only recovery.

- Two already-ingested Formalized entries—`principle.content-first` and `visual-language.editorial-portfolio`—link Agent Annotation `ee2d3dda-… (Local Priority Tension)`, whose inference is honestly `reasonable`.
- Finalization requires every non-Gap entry link to appear in a targeting `mapped` claim. Work-unit recording correctly forbids a claim backed by a `reasonable` source from declaring `confidence=confirmed`; finalization simultaneously requires every mapped claim targeting a Formalized entry to be confirmed. An omitted claim does not satisfy entry lineage. The three legal representations therefore form a deterministic contradiction.
- Luna safely fixed the other mismatch classes through manifest-only changes, then stopped. Promoting the reasonable source to confirmed would falsify provenance; removing the link would require changing and re-declaring source artifacts, which this test explicitly forbids after repeated guidance.
- Split entry evidence into authoritative `supportLinks` and non-authoritative `contextLinks`, or reject a Formalized source during declaration/ingest when its authority closure contains a non-confirmed record. Finalization must never be the first place this unsatisfiable state is discovered.
- Red fixture: a Formalized entry linked to one reasonable Agent Annotation. Assert typed `unsatisfiable_formalized_lineage` before ingest/audit readiness. Cover mapped+confirmed (`claim_confidence_exceeds_source`), mapped+reasonable (`formalized_claim_support_insufficient`) and omitted (`entry_claim_lineage_mismatch`) so no prompt-level workaround can masquerade as a pass.

#### SMOKE-047 — Extraction audit/readiness says “passed” before a deterministic finalization failure

Severity: medium-high. Status: confirmed in two consecutive R04B audit/finalize cycles.

- Audit v7 recorded `status=passed`, zero residual claims and all required work units; immediate finalize rejected three entry-lineage mismatches. Luna corrected the two manifest-solvable classes.
- Audit v10 again recorded `status=passed`; immediate finalize rejected the two unsatisfiable links from SMOKE-046. No concurrent source or DB mutation occurred between either audit and finalize.
- The audit path checks work-unit/input consumption and trusts the submitted audit result, while finalization alone runs reverse entry-link and Formalized-support preconditions. This false readiness caused a prolonged recovery loop and left Workbench able to display 12 entries as Formalized while canonical workflow remained `initial-design-system-preparing`; the Browser exposed no actionable finalization blocker.
- Extract one pure `validateFinalizationPreconditions` routine and run it at declaration/ingest, audit progress, `readyToFinalize`, finalize and Browser projection. Invariant: absent a concurrent revision, `audit passed + readyToFinalize=true` must imply that immediate finalize succeeds. Otherwise return exact typed blockers and keep readiness false.
- Add the SMOKE-046 fixture to the audit suite, replace the current test that accepts passed audit followed by failed finalize, and add Workbench coverage showing the blocker and disabling any confirmation/phase-advance action until it is resolved.

## R05 — Brand guidelines, natural-prompt formal run

Reference: Figma file `yNZdUYsVVUKuaEVl6YhoRA`, node `256:137`. Task model: `gpt-5.6-luna`, reasoning `max`. Credential path: installation Keychain; no PAT was entered. This round intentionally used ordinary designer language and did not name Ikran MCP tools or command identities.

### Passed checkpoints

- A sterile task bound the exact child `smoke-project`; production MCP and Workbench shared one Runtime/project. Keychain capture created one Seed lineage and a real screenshot/positional Surface. Explicit Refresh created one new current Surface and retained the old version; no duplicate Seed, orphan or partial capture was created.
- Before the designer's Next Phase action, an Agent claim attempt did not advance Alignment. The complete preparation had six sections, one Agent Annotation per section and exactly two Questions per section. Complete enabled only after 12/12 non-empty designer-edited final answers.
- Unlike R04, the active Alignment turn made zero host-Figma calls. All records were anchored to Runtime-known nodes. No Agent Annotation covered the whole Surface/root.
- The designer answers explicitly separated reusable semantic direction from unknown measurements, breakpoints, motion and state visuals. Static evidence was not accepted as proof of sticky positioning, independent scrolling or responsive collapse.
- Draft preparation produced six ingested source artifacts and 15 entries (six Candidate, nine Gap). All current artifact digests match source bytes. Finalization eventually succeeded and the phase became `draft_design_system`; no Prototype was created before designer confirmation.
- Navigation structure, two-column measurements, breakpoints, state visuals and motion were quarantined as Gaps instead of being promoted from the tiny navigation leaf. Brand Hero scope remained limited to brand-display contexts rather than all pages.

### Draft acceptance outcome

Runtime has no phase-level blocker, but the R05 Draft fails production semantic/review acceptance. It may be used for downstream negative/resilience testing only:

- Design System Browser replays only six of 12 final answers. The six missing answers are precisely those mapped to nine Gaps. All nine Gap entries show zero Questions, answers and Designer Annotations.
- Several answers combine a confirmed requirement with unknown parameters. The Draft demotes the complete clause to Gap rather than preserving a Candidate requirement plus parameter-level Gap—for example, visible keyboard focus/non-color active feedback versus its unknown visual values.
- Brand Hero has no source capture; the whole Design System has zero entry captures. Gradient values, spacing and breakpoints remain Gap, so the component is not reproducible from the Design System alone. Structural audit still reports zero issues.
- The only concrete color token encodes `white` as an executable value even though the round did not obtain concrete color metadata through Runtime evidence. The component also repeats the single observed treatment as a one-value `style` variant and models “no entry by default” as a state.

#### SMOKE-048 — Agent-facing command contracts are not executable without source-code archaeology

Severity: high. Status: confirmed repeatedly in R05 Alignment and Draft preparation.

- `create_agent_annotation` describes “confirmed observation or reasonable assumption” but does not publish the exact literals. Its schema accepts any string while Runtime implementation accepts only `confirmed|reasonable`. Luna naturally supplied `confirmed observation`; Runtime returned only `invalid_inference`, then the Agent searched product source/tests to recover the hidden enum.
- Initial Design System claim returns policy prose and required artifact names but no complete versioned JSON schemas, canonical minimal scaffolds, legal component field paths or executable work-unit examples. Before writing the first artifact, Luna spent about five minutes reading schema, ingest/status, preparation and tests rather than doing design work.
- Artifact/component/work-unit failures such as `missing_required_field` and `invalid_manifest_source` often expose useful typed `structuredContent.details`, but the canonical model-visible text only contains the reason. The Agent wrapper consumed only `content`, so offending field/record IDs disappeared and Luna used blind binary-search submissions.
- One source-ID typo was accepted in a Candidate entry because status evaluation required only at least one valid link. Finalization later forced source edits and repeated declarations before the lineage could close.
- Every Agent-facing interface must be self-describing: exact enum literals, full versioned top-level schema or scaffold, allowed work-unit/field paths, and safe typed details duplicated in model-visible text. A natural Agent must never need `rg tests workflow Attempts` or implementation source to construct a valid payload.
- Add a no-source-read trace fixture: an external Agent with access only to tool contracts must complete Alignment and Initial DS preparation. Any read under product source/tests/old artifacts is a failure, and every injected invalid value must return exact allowed/received or field/record details.

#### SMOKE-049 — Structural overlay silently narrows a navigation Annotation to a negligible leaf

Severity: high. Status: confirmed in the Workbench and persisted Alignment input.

- The designer annotated the left chapter navigation and wrote direction about the full navigation, but hover selection resolved to the deepest `01` text node `I256:138;8008:1647;8008:1598`, whose normalized area is about `0.0043%` of the Surface. The complete navigation candidate is roughly `19.5% × 26.6%`.
- Workbench hit testing prefers the deepest and, at equal depth, smallest selectable node. It does not show a persistent breadcrumb/target confirmation before submission. A semantically broad annotation can therefore be stored on a tiny leaf while looking locally plausible.
- Four of six Agent Annotations reused that leaf. Layout and Component bodies described the navigation or navigation↔Hero relationship, exceeding the literal anchor scope. R05 Draft prompts explicitly quarantined those conclusions as Gap, but Runtime itself did not enforce the scope.
- Make target scope explicit before submit: show ancestor breadcrumb and covered-area ratio, provide deterministic parent traversal, warn on negligible-leaf/broad-body mismatch, and allow the designer to confirm the intended parent. Do not ban small targets globally because real icons/controls are valid small subjects.
- Regression: pointer over the current fixture must let the designer select/confirm Navigation rather than silently persisting `01`; a relational claim over nav+Hero requires a target set covering both or receives a typed scope rejection.

#### SMOKE-050 — Designer direction is laundered into independent `confirmed` Agent evidence

Severity: high. Status: confirmed in R05 Alignment and consumed by the Draft.

- The contract explicitly tells the Agent to respect Designer Annotations but never restate them as its own. Luna nevertheless paraphrased the designer's navigation and Hero annotations into `inference=confirmed` Agent Annotations without independently reading the Runtime screenshot/node details.
- Those records were accepted as separate support and later appeared alongside designer-edited answers in Candidate lineage, giving one designer statement two apparent evidence authors/weights. Text similarity alone is not a reliable enforcement mechanism.
- Agent Annotation needs an explicit basis/origin such as captured-evidence, designer-direction or assumption. Designer-direction derivatives must preserve that lineage and cannot become independent `confirmed` authority or increase support weight. A captured-evidence claim must cite a Runtime-readable evidence target unavailable only through the designer text.
- Regression: create a Designer Annotation containing a unique sentinel phrase, then ask the Agent to prepare Alignment without image access. A paraphrase may be retained only as derived designer direction, never as an independent confirmed observation.

#### SMOKE-051 — Gap status erases confirmed clauses and their full designer history

Severity: high. Status: confirmed; extends SMOKE-024/025 into the R05 production path.

- Six final answers deliberately combined a confirmed semantic requirement with unknown implementation parameters. The Draft stored the whole item as Gap: e.g. “keyboard focus must be visible and active must be non-color” is known, while exact shape/color/timing is unknown; three spacing roles are known, while numeric values are unknown.
- Gap schema/status requires empty `links`, and Browser therefore shows none of the originating Questions, answers or annotations. Only six of 12 final answers are visible anywhere in the Browser; the nine Gap entries all show zero evidence records.
- Separate rule authority from unresolved parameters and from gap-decision provenance. A Candidate rule may link the confirmed clause while nested/companion parameter Gaps carry `decisionLinks` that explain why values remain open without granting formalization authority.
- Required invariant: every submitted final answer appears at least once in Browser/export lineage; every normative atomic clause is mapped, deferred with evidence, or explicitly omitted. A card ID alone cannot mark all of its clauses consumed.
- Add the exact fixture “keyboard focus must be visible; exact color, shape and timing unknown.” Expected output is Candidate accessibility requirement + parameter-level Gap, both displaying the same answer with distinct authority semantics.

#### SMOKE-052 — Artifact declarations remain partial after entry-level provenance passes

Severity: high. Status: confirmed in all six R05 Draft declarations.

- Each `source_artifacts.related_record_ids_json` contains only one record—for example, `design-system.json` lists only the narrative Question—even when the file's Candidate entries and manifest consume three to six sources.
- Finalization strictly checks entry↔manifest lineage but does not require the artifact declaration envelope to cover the file's actual sources. Browser/export/audit consumers therefore see inconsistent provenance depending on which layer they read.
- Derive artifact-level provenance from the validated entry/claim closure rather than asking the Agent to duplicate UUID arrays. Declaration should bind exact source bytes and purpose; Runtime should compute and persist the complete related-record set after Claim evaluation.
- Regression: declare a file with two entries supported by disjoint records while supplying only one related ID. Either declaration fails with exact missing IDs or Runtime derives both; no partial artifact provenance may be marked ingested.
- Runtime-owned Brand Hero code-link backfill correctly rewrote the file/DB and refreshed the digest without incrementing `declaration_version`—an intentional distinction from Agent declaration—but left the artifact `updated_at` at its prior declaration time. If consumers interpret that column as last semantic modification, lifecycle metadata is incomplete; document the meaning or maintain a separate content-updated timestamp.

#### SMOKE-053 — Prototype generation implements an explicit sticky-navigation Gap

Severity: high. Status: confirmed; corrected after ordinary designer feedback, while Runtime conformance defect remains.

- The final designer answer and Draft both say static evidence cannot prove sticky/fixed or independent-scrolling behavior and keep it as Gap. Generated `prototype/main.js` repeats that navigation behavior/sticky remains unresolved.
- The generated stylesheet nevertheless sets `.navigation { position: sticky; top: 0; }`, directly converting the Gap into executable behavior. It also fixes 250/1030 widths, exact padding/gaps/font sizes and other values obtained from host Figma implementation context, not the confirmed Design System.
- This first Seed reconstruction is allowed to read current host Figma context for fidelity, but it must distinguish page-local reconstruction facts from reusable Design System authority and must not contradict an explicit designer decision. “Seen in Figma implementation context” cannot override “do not treat static evidence as proof of behavior.”
- Remove sticky from the Prototype or explicitly ask the designer to approve it as a page-local behavior. Generation output needs a disposition manifest comparing each explicit Gap/confirmed rule against executable code; contradiction must block preview declaration.
- Regression: packet contains a `sticky behavior unresolved` Gap and host context contains `position:sticky`; emitted CSS must omit sticky or record a designer-authorized local exception. Silent implementation fails.
- One natural designer correction removed sticky positioning and the final real Browser reported `position: static`. Runtime nevertheless accepted the contradictory first declaration/preview path without a Gap-conformance diagnostic; recovery does not convert the original result into a pass.

#### SMOKE-054 — Prototype visual fidelity depends on transient host assets and unverified fallbacks

Severity: high. Status: confirmed in source and live preview.

- Hero and logo point directly to temporary `figma.com/api/mcp/asset/...` URLs instead of project-local declared assets. The artifact graph does not contain those dependencies, so offline/replay/export behavior is not durable.
- CSS declares `Rethink Sans` without importing or declaring a font artifact; actual rendering falls back to Arial when that font is unavailable. The full Hero bitmap makes the gradient look faithful while bypassing the Design System's explicit unresolved gradient parameters, so visual match cannot be counted as proof that Brand Hero is executable from the Design System.
- Runtime declarations/previews must enumerate and snapshot every local or remote dependency with digest/license/provenance. External ephemeral URLs should be downloaded into a run-owned immutable asset root before declaration. Browser render health should record loaded font/resource identity and fail or warn on unintended fallback.
- Regression: expire/block the MCP asset URLs and run on a machine without the named font. Preview must fail/degrade explicitly rather than remain `ready`; historical replay must use immutable declared bytes.
- The repaired R05 preview rendered with both remote images currently available, one stylesheet and no page-origin console error. That proves present reachability only; the asset URLs remain transient and the computed font path still lacks a declared local font resource.

### R05 Prototype, Rule Update, and formalization outcome

- The first preview was an all-white false-ready result: native JavaScript imported CSS from a raw static server, aborting the module graph before the mount. One natural correction moved CSS to a stylesheet link and restored a populated page; this is an exact SMOKE-009 reproduction.
- The corrected page was independently browser-verified with populated content, one stylesheet and two loaded images. The Agent also removed the sticky contradiction and consolidated the duplicated sidebar/Contents arrays into one page-local chapter model.
- Every re-record then hit SMOKE-013: durable surface state became stale shortly after ready, yet `confirm_prototype` succeeded. The later reconciliation both truncated the real conversation (SMOKE-029) and persisted the active bearer (SMOKE-041).
- Consolidate correctly dismissed the 6px adjustment as local and published one reusable shared-model proposal. The proposal lacked stable target identity (SMOKE-043), so the designer rejected it. After Runtime reconnection, the rejection was claimed and completed with zero semantic Design System source write; `design-system.json` retained its exact proposal-base digest.
- Formalization promoted no Candidate. A required code-link backfill first hit the wrong duplicate component row (SMOKE-036), then succeeded only with the physical spec UUID. Runtime advanced to `ready_for_new_design` despite the stale confirmed surface, semantically degraded Draft, transient assets, undeclared dependency graph and zero executable typography coverage. This is workflow readiness, not production readiness.

### R05 isolated new-design read-scope outcome

- The Design System context delivery itself passed: exact five-key packet, version `b662870c23285942`, 15 DB-identical entries, and no raw Figma/Seed/Annotation/feedback/event/conversation payload.
- Host isolation failed before and after that packet. Readiness exposed prior description/Seed count (SMOKE-040); filesystem access then exposed old Prototype and raw Design System sources (SMOKE-037).
- The generated `Typography & Voice` route rendered successfully at its independent Runtime surface (`ready`, non-stale), but it concretized packet-external typography, palette, spacing, responsive and interaction choices and omitted all Candidate dependency declarations (SMOKE-038). The user's requested “Agent reads exactly the designed Design System scope” check therefore **fails**.

#### SMOKE-055 — Workbench Rule Update decision controls look active while the Runtime is offline

Severity: high. Status: confirmed during R05 reject decision; official API retry succeeded after reconnect.

- While Luna was correctly waiting for a designer Rule Update decision, its Runtime died. The already-open Design System Browser continued to show a normal Pending Review card with enabled Accept and Reject controls and no disconnected state.
- Multiple real button clicks produced no visible error, no disabled/busy state, no status change and no designer-decision row. The page's old canvas remained interactive-looking; only a later request surfaced a generic `network` alert.
- After `open_workbench` restored the same project/review, the browser still rendered enabled controls, but a direct call through the same official localhost `/api/rule-update-review` endpoint was required to persist Reject. The Agent then claimed the command and zero-write rejection completed correctly.
- UI command surfaces need an explicit authenticated Runtime connection state. On transport loss, all mutating controls must disable immediately, show `Runtime disconnected—reconnect to decide`, and never imply that a click succeeded. A reconnect must refresh token/projection before re-enabling. Add an E2E test: publish proposal → stop Runtime → click Reject → require visible failure/no mutation → restart → one visible retry persists exactly one decision.

## Consolidated production solution

The findings cluster into five architecture tracks rather than 55 unrelated patches:

1. **Runtime Workspace Ownership (P0 containment).** Canonicalize one workspace/project identity; prevent ancestor/sibling binds, second writers and split MCP/Workbench control planes. Expose a non-secret Runtime identity and first-class reconnect state to every UI and command surface.
2. **Initial Design System Claim Evaluator (P1 semantic truth).** Use one authoritative evaluation for ingest, progress, audit, Browser readiness and finalization. Model atomic clauses, authority versus context, parameter-level Gaps, complete provenance closure, component inventory/spec identity and executable-token coverage.
3. **Frozen Alignment Evidence & Provenance (P2 evidence integrity).** Deliver Runtime-owned screenshots/crops/positional nodes to the Agent; enforce target granularity/multi-target scope; publish exact authoring schemas/enums; preserve Designer-derived origin and prevent confirmed-evidence laundering.
4. **Prototype Design Run (P3 generation and preview safety).** Generate inside a run-scoped sandbox that mounts only an immutable Design System packet, approved assets/scaffolding and an empty output root. Auto-record Candidate reads, prohibit Gap hardening, snapshot/digest the complete artifact graph, render-verify before ready, and bind confirmation/reconciliation to one ready non-stale surface.
5. **Design System Source Change Cycle (P4 consistency).** Freeze exact typed proposal diffs/entry identities; support post-Prototype feedback provenance; unify CAS/filesystem/SQLite/declaration/rollback; reject ambiguous logical identities and collateral edits; keep Reject terminal and zero-write.

Cross-cutting requirements: remove credentials from generic tool envelopes and domain/export records; make Agent tools executable without source archaeology; run red-first pure evaluator tests, real Runtime/process integration, natural vague-prompt Luna traces and Browser projection checks for every track.
