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
  const taskName = single ? `Ikran ${workspaces[0].displayName}` : "Ikran Assigned Workspace";
  const visibleWorkspace = single ? workspaces[0].displayName : "the assigned numbered workspace";

  return `# ${title}

The participant will provide this file to you. You own the complete setup. Do not ask the participant to copy a path, choose a folder, reinstall a plugin, restart MCP, create another task, or run a terminal command. The participant performs one required host action: after installation, fully quit and reopen Codex Desktop, return to this same Setup task, and ask the Agent to continue the Ikran setup. Closing a window, opening another task, or restarting an MCP server does not satisfy this requirement.

## Assigned study workspace

${assignments}

Read \`STUDY-KIT-MANIFEST.json\` from the same package directory and treat its stable workspace ID, number, plugin version, and Figma source identity as authoritative. Folder names are display labels only.

## Step 1 — install this exact bundled plugin

1. Resolve \`PACKAGE_ROOT\` as the directory containing this START-HERE file. Never ask the participant for it and never use a placeholder path.
2. Read the package manifest. Inspect \`codex plugin marketplace list\` and \`codex plugin list\`.
3. The required marketplace is \`ikran-study-kit\` rooted at this exact \`PACKAGE_ROOT\`. If the same marketplace name points elsewhere, remove the installed \`ikran@ikran-study-kit\` plugin if present, remove that marketplace source, then add this exact \`PACKAGE_ROOT\`.
4. Install \`ikran@ikran-study-kit\`. Verify the installed version equals the manifest and its marketplace source is this package. A folder with a similar name is not sufficient evidence.

## Step 2 — complete pre-restart checks, then stop

Plugin installation does not refresh the capability snapshot of the running Codex Desktop host. Keep this original task as the recovery point and rename it exactly **Ikran Installation and Setup** so the participant can identify it without understanding paths or MCP.

Complete these checks before requesting the restart:

1. Run \`node --version\` yourself. Require Node.js \`>=22.13\`, matching the bundled plugin's declared runtime. Do not ask the participant to install or inspect Node.js manually. If it is missing or incompatible, stop here with \`STUDY_SETUP_BLOCKED_NODE_RUNTIME\` and report the detected value.
2. Re-read \`codex plugin marketplace list\` and \`codex plugin list\`. Confirm that \`ikran@ikran-study-kit\` is installed and enabled at the exact manifest version and that \`ikran-study-kit\` still points to this \`PACKAGE_ROOT\`.

After every check passes, give the participant this restart guidance and end the turn. Do not create a task before the participant returns:

> Ikran installation is complete. Please fully quit Codex Desktop, reopen it, return to the task titled **Ikran Installation and Setup**, and ask it to continue the Ikran setup. Do not create another task yourself.

The completion criterion for Step 2 is that this guidance has been shown and the Agent has stopped without calling \`create_thread\`.

## Step 3 — resume after restart and prove that the host refreshed

Run this step when the participant returns to **Ikran Installation and Setup** and asks to continue the Ikran setup. Treat any clear equivalent wording, capitalization, and punctuation as the same continuation intent. Reuse the \`PACKAGE_ROOT\`, absolute \`MANIFEST_PATH\`, manifest identities, and preflight results already established in this task.

1. Re-run \`node --version\`, \`codex plugin marketplace list\`, and \`codex plugin list\`. Require the same compatible Node.js runtime, exact installed plugin version, and package source.
2. Confirm \`activate_study_workspace\`, \`list_working_folders\`, and \`open_workbench\` are now native Ikran tools in this resumed task. Tool names inferred from documentation do not count.
3. Prove Ikran and its bundled browser availability with a real call: call \`activate_study_workspace\` using the concrete absolute \`MANIFEST_PATH\` and stable \`workspaceId\`. Require \`ok: true\` and \`browser_preflight.ok: true\`; verify package, plugin version, workspace ID and number, Figma fileKey/nodeId, and \`active_project\` against the manifest. This preflight launches the packaged Playwright Chromium before Alignment, so never repair component code when it reports \`study_browser_unavailable\`. Then call \`list_working_folders\` and require the assigned folder with source \`study_manifest\`.

If any native Ikran tool is absent, stop with \`STUDY_SETUP_HOST_NOT_REFRESHED\` and give this recovery guidance:

> Codex has not refreshed Ikran yet. Please fully quit Codex Desktop again, reopen it, return to **Ikran Installation and Setup**, and ask it to continue the Ikran setup.

If an Ikran tool is present but the real activation or identity check fails, stop with \`STUDY_SETUP_BLOCKED_IKRAN_MCP\`. A failed real call is not an initialization delay and must not trigger task creation.

The completion criterion for Step 3 is successful real Ikran activation in this resumed Setup task.

## Step 4 — create the study task yourself

Immediately after Step 3 passes, resolve the assigned workspace's absolute \`WORKSPACE_ROOT\` by joining the package directory with the manifest workspace \`path\`. Ensure that exact directory is registered as a local Codex Project, then create one **standalone, user-visible Codex task** inside that Project with the host's \`create_thread\` capability. The Codex Project root and the Ikran manifest activation are separate identities and both must resolve to the assigned workspace.

1. Use \`create_thread\`, not \`spawn_agent\`, a subagent, or \`fork_thread\`.
2. Verify that \`WORKSPACE_ROOT\` exists and that the selected Codex Project root equals it exactly. If the directory is not yet a saved Project, register that exact directory first and verify the resulting Project identity before task creation. Do not use a projectless task.
3. Title the new task **${taskName}**. Put the concrete absolute \`WORKSPACE_ROOT\`, \`MANIFEST_PATH\`, stable \`workspaceId\`, expected package \`${packageName}\`, expected plugin version, and assigned Figma fileKey/nodeId in its initial prompt. Never send placeholders or rely on a folder name.
4. Instruct the new task to execute Steps 5–7 and include the recovery guidance below.
5. Require a distinct \`threadId\`, verify the new task is rooted at the exact \`WORKSPACE_ROOT\`, then call \`navigate_to_codex_page\` with it. If Project registration, task creation, exact root verification, a distinct ID, or navigation is unavailable, stop with \`STUDY_SETUP_BLOCKED_TASK_CREATION\`.

Use this continuation instruction in the new task:

> Continue the authorized Ikran Study in the assigned Project and manifest workspace. Verify the Project, workspace, Ikran, and host-native Figma identities, open and visibly present the exact Workbench, then continue the current Alignment using the native Ikran tools while the designer answers in the Workbench.

## Step 5 — verify native Ikran MCP in the new task

The new task must confirm the three native Ikran tools and then:

- Call \`activate_study_workspace\` with the concrete absolute \`MANIFEST_PATH\` and assigned stable \`workspaceId\`.
- Require \`ok: true\` and \`browser_preflight.ok: true\`; verify package, plugin version, \`workspace_id\`, workspace number, Figma fileKey/nodeId, and \`active_project\` against the manifest.
- Call \`list_working_folders\`; require the assigned folder with source \`study_manifest\`.
- Call \`open_workbench\`; require \`workspace_source: study_manifest\` and the activated project identity.

If any native Ikran tool is absent, stop immediately with \`STUDY_SETUP_IKRAN_NOT_READY\` and give this recovery guidance:

> Ikran is unavailable in this workspace task. Return to **Ikran Installation and Setup** and ask it to continue the Ikran setup. Do not reinstall anything or choose a folder here.

The resumed Setup task must repeat Step 3 before creating another candidate. If tools are present but activation fails, stop with \`STUDY_SETUP_BLOCKED_IKRAN_MCP\`; do not edit caches, databases, or workspace paths.

## Step 6 — verify the host-native Figma MCP in the new task

1. Use the Figma MCP supplied by the Agent host, not an Ikran tool.
2. Perform a real read-only metadata or design-context request for the assigned fileKey and nodeId.
3. Verify both returned identifiers. Tool presence alone is insufficient.
4. On absence, authorization failure, access failure, or identity mismatch, stop with \`STUDY_SETUP_BLOCKED_FIGMA_MCP\`. Never request a Figma API token.

## Step 7 — present the Workbench

- Open the exact Workbench URL returned by \`open_workbench\` in the host's embedded browser yourself.
- Post that exact URL in chat as a fallback, but do not require the participant to use it when the embedded browser opened correctly.
- Confirm the visible title identifies ${visibleWorkspace}.
- After the Workbench is visible and both MCP checks pass, tell the participant it is ready and continue the current Alignment in this same task using the native Ikran tools while the designer answers in the Workbench.
- The bootstrap reaches its handoff when the participant can answer in the visible Workbench and the Agent has entered the active Alignment continuation flow.

The study evidence is preloaded and frozen. Never add, replace, or refresh a Seed Reference. If the Draft Design System has omissions, use Draft revision tools to create one new active revision; do not abandon the project phase or return to Seed.
`;
}
