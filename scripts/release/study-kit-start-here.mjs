function workspaceSummary(workspace) {
  return [
    `- Assignment: **${workspace.displayName}**`,
    `- Stable workspace ID: \`${workspace.id}\``,
    `- Workspace folder: \`${workspace.path}\``,
    `- Assigned Figma source: fileKey \`${workspace.frame.fileKey}\`, nodeId \`${workspace.frame.nodeId}\``
  ].join("\n");
}

export function studyKitStartHere(packageName, workspaces) {
  const single = workspaces.length === 1;
  const title = single
    ? `Ikran Study Kit — ${workspaces[0].displayName}`
    : "Ikran Study Kit — Codex";
  const assignments = workspaces.map(workspaceSummary).join("\n\n");

  return `# ${title}

The participant will provide this file to you. You own the complete setup. Do not ask the participant to copy a path, choose a folder, reinstall a plugin, restart MCP, create another task, or run a terminal command. The only participant-operated recovery allowed is the single return-to-Setup instruction below when a newly created task has not discovered Ikran MCP yet.

## Assigned study workspace

${assignments}

Read \`STUDY-KIT-MANIFEST.json\` from the same package directory and treat its stable workspace ID, number, plugin version, and Figma source identity as authoritative. Folder names are display labels only.

## Step 1 — install this exact bundled plugin

1. Resolve \`PACKAGE_ROOT\` as the directory containing this START-HERE file. Never ask the participant for it and never use a placeholder path.
2. Read the package manifest. Inspect \`codex plugin marketplace list\` and \`codex plugin list\`.
3. The required marketplace is \`ikran-study-kit\` rooted at this exact \`PACKAGE_ROOT\`. If the same marketplace name points elsewhere, remove the installed \`ikran@ikran-study-kit\` plugin if present, remove that marketplace source, then add this exact \`PACKAGE_ROOT\`.
4. Install \`ikran@ikran-study-kit\`. Verify the installed version equals the manifest and its marketplace source is this package. A folder with a similar name is not sufficient evidence.

## Step 2 — create the study task yourself

Plugin installation completes before the Codex host necessarily exposes the new MCP server to newly created tasks. Keep this original task as the recovery point and, when the host capability is available, rename it exactly **Ikran Installation and Setup** so the participant can identify it without understanding paths or MCP.

Before creating a new task, use the propagation window productively:

1. Run \`node --version\` yourself. Require Node.js \`>=22.13\`, matching the bundled plugin's declared runtime. Do not ask the participant to install or inspect Node.js manually. If it is missing or incompatible, stop here with \`STUDY_SETUP_BLOCKED_NODE_RUNTIME\` and report the detected value.
2. Re-read \`codex plugin marketplace list\` and \`codex plugin list\`. Confirm that \`ikran@ikran-study-kit\` is installed and enabled at the exact manifest version and that \`ikran-study-kit\` still points to this \`PACKAGE_ROOT\`.
3. Confirm the host-native Figma MCP is available and authenticated in this Setup task. Use it to perform a real read-only metadata or design-context request for the assigned manifest fileKey and nodeId. Verify both returned source identifiers. Tool presence alone is not sufficient, and this check must never request a Figma API token.
4. If the Figma read requires the Agent host's normal permission approval, leave that approval in the Agent host; do not replace it with a token, an Ikran Figma tool, or another client. Continue only after the host-native read succeeds.

These checks occupy the normal MCP discovery window, but elapsed time is not proof that Ikran is ready. The newly created task must still perform the Ikran readiness check in Step 3 before any study work.

### Create a candidate task after preflight

Plugin discovery is fixed for an already-running task. After the host preflight, create a **standalone, user-visible Codex task** with the host's \`create_thread\` capability. Use a local projectless task; the verified manifest activation in Step 3 selects the Ikran workspace, so the new task's cwd is not a workspace identity signal.

1. Do not use \`spawn_agent\`, a subagent, or \`fork_thread\`. Those are not a fresh independent plugin-discovery boundary.
2. Title the new task **Ikran ${single ? workspaces[0].displayName : "Assigned Workspace"}**. Resolve and place the concrete absolute \`MANIFEST_PATH\`, stable \`workspaceId\`, expected package \`${packageName}\`, expected plugin version, and assigned Figma fileKey/nodeId in its initial prompt. Never send a placeholder path or rely on a folder name.
3. The new task must first follow Step 3 below. Only after Ikran discovery passes may it follow Steps 4 and 5. Its prompt must explicitly authorize the complete bootstrap and tell it not to ask the participant to operate Codex.
4. Include the exact recovery text from Step 3 in the new task's initial prompt. A task that did not discover Ikran cannot repair its own fixed tool snapshot and must not reinstall the plugin.
5. Verify task creation returned a distinct \`threadId\` rather than an agent/subagent ID. Then use \`navigate_to_codex_page\` with that \`threadId\` so the participant is moved to the independent task without manual switching.
6. If \`create_thread\`, a distinct \`threadId\`, or programmatic navigation is unavailable, stop with \`STUDY_SETUP_BLOCKED_TASK_CREATION\`; do not transfer the operation to the participant.

Continuation instruction:

> Continue the authorized Ikran Study bootstrap using the concrete absolute MANIFEST_PATH and assigned stable workspaceId supplied in this prompt. First check that native activate_study_workspace, list_working_folders, and open_workbench tools are actually present. If any is absent, do not retry or reinstall here: show the exact Step 3 recovery instruction and stop. If all are present, call activate_study_workspace with exactly those two values and verify its returned package, plugin version, workspace ID, active project, and Figma identity. Then independently verify the host-native Figma MCP can read the assigned fileKey and nodeId, open and present the exact Workbench URL. Once the correct Workbench is visibly ready, tell the participant it is ready and wait for the participant to answer the Alignment questions in the Workbench. That participant handoff completes bootstrap: take no further study action until new participant input. Do not answer questions, advance Alignment, create or revise a Draft, request credentials, add or refresh evidence, or ask the participant to operate Codex except for the Step 3 recovery instruction.

## Step 3 — verify native Ikran MCP

### Recover when the candidate task has not discovered Ikran

The candidate task must inspect its native tool list before its first Ikran call. If \`activate_study_workspace\`, \`list_working_folders\`, or \`open_workbench\` is absent, it must stop immediately with \`STUDY_SETUP_IKRAN_NOT_READY\` and show the participant exactly this message:

> Ikran is still initializing. This is not your fault. Return to the task titled **Ikran Installation and Setup** and send only: **Please create the Ikran workspace task again.** Do not reinstall anything or choose a folder in this task.

When that exact request arrives in **Ikran Installation and Setup**:

1. Reuse the already resolved \`PACKAGE_ROOT\`, absolute \`MANIFEST_PATH\`, stable \`workspaceId\`, package identity, plugin version, and Figma identity. Do not ask the participant to provide them again.
2. Treat the request as an immediate execution trigger. Recheck \`codex plugin list\` once. If the exact plugin is still installed and enabled, preserve that installation and proceed directly to the next item in the same turn.
3. Your next action must be the host's \`create_thread\` call for a brand-new standalone candidate using the Step 2 values and prompt. Do not narrate a plan, wait, poll, run another diagnostic, or end the turn before making this call. As soon as it returns a distinct \`threadId\`, call \`navigate_to_codex_page\` with that ID.
4. Never tell the participant to retry inside a task that already reported \`STUDY_SETUP_IKRAN_NOT_READY\`; its MCP tool snapshot cannot refresh.

- Confirm \`activate_study_workspace\`, \`list_working_folders\`, and \`open_workbench\` are native tools in the new task.
- First call \`activate_study_workspace\` with \`manifestPath\` = the concrete absolute \`MANIFEST_PATH\` and \`workspaceId\` = the assigned stable ID. Do not call \`create_or_open_project\` with a guessed path.
- Require \`ok: true\` and verify the returned package, plugin version, \`workspace_id\`, workspace number, Figma fileKey/nodeId, and \`active_project\` against the manifest. This call is the authoritative workspace selection even when MCP Roots are empty, stale, or point at another downloaded Study Kit.
- Call \`list_working_folders\` as a diagnostic. After successful activation it must report the assigned folder with source \`study_manifest\`; the task cwd and a similarly named folder are not evidence.
- Call \`open_workbench\`. Its \`workspace_source\` must remain \`study_manifest\`, and its \`active_project\` and Workbench project must still equal the activated manifest workspace.
- If the tools are present but activation or identity verification fails, stop with \`STUDY_SETUP_BLOCKED_IKRAN_MCP\`. Do not use the not-ready recovery for a real activation error, build an ad-hoc client, manipulate plugin cache files, or edit the database.

## Step 4 — verify the host-native Figma MCP

This means the Figma MCP supplied by the Agent host, not any Ikran tool.

1. Even though the Setup task already passed Figma preflight, confirm the host-native Figma MCP tools are available and authenticated in this new task.
2. Use that MCP to read metadata or design context for the assigned manifest fileKey and nodeId shown above.
3. Verify the returned source identity matches both values. Tool presence alone is not sufficient.
4. Only a successful read permits the study to start. On any absence, authorization failure, access failure, or identity mismatch, stop with \`STUDY_SETUP_BLOCKED_FIGMA_MCP\`. Never request credentials through Ikran.

## Step 5 — present the Workbench

- Open the exact Workbench URL returned by \`open_workbench\` in the host's embedded browser yourself.
- Post that exact URL in chat as a fallback, but do not require the participant to use it when the embedded browser opened correctly.
- Confirm the visible title identifies ${single ? workspaces[0].displayName : "the assigned numbered workspace"}.
- After the Workbench is visible and both MCP checks pass, tell the participant it is ready and wait. The participant now answers the Alignment questions in the Workbench; this handoff is the completion criterion for bootstrap.
- Until new participant input arrives, take no study action: do not answer Alignment questions, advance the phase, create or revise a Draft, or add evidence.

The study evidence is preloaded and frozen. Never add, replace, or refresh a Seed Reference. If the Draft Design System has omissions, use Draft revision tools to create one new active revision; do not abandon the project phase or return to Seed.
`;
}
