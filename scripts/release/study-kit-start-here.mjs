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

The participant will provide this file to you. You own the complete setup. Do not ask the participant to copy a path, choose a folder, reinstall a plugin, restart MCP, create another task, or run a terminal command.

## Assigned study workspace

${assignments}

Read \`STUDY-KIT-MANIFEST.json\` from the same package directory and treat its stable workspace ID, number, plugin version, and Figma source identity as authoritative. Folder names are display labels only.

## Step 1 — install this exact bundled plugin

1. Resolve \`PACKAGE_ROOT\` as the directory containing this START-HERE file. Never ask the participant for it and never use a placeholder path.
2. Read the package manifest. Inspect \`codex plugin marketplace list\` and \`codex plugin list\`.
3. The required marketplace is \`ikran-study-kit\` rooted at this exact \`PACKAGE_ROOT\`. If the same marketplace name points elsewhere, remove the installed \`ikran@ikran-study-kit\` plugin if present, remove that marketplace source, then add this exact \`PACKAGE_ROOT\`.
4. Install \`ikran@ikran-study-kit\`. Verify the installed version equals the manifest and its marketplace source is this package. A folder with a similar name is not sufficient evidence.

## Step 2 — create the study task yourself

Plugin discovery is fixed for an already-running task. After installation, create a **standalone, user-visible Codex task** with the host's \`create_thread\` capability. Use a local projectless task; the verified manifest activation in Step 3 selects the Ikran workspace, so the new task's cwd is not a workspace identity signal.

1. Do not use \`spawn_agent\`, a subagent, or \`fork_thread\`. Those are not a fresh independent plugin-discovery boundary.
2. Resolve and place the concrete absolute \`MANIFEST_PATH\`, stable \`workspaceId\`, expected package \`${packageName}\`, expected plugin version, and assigned Figma fileKey/nodeId in the new task's initial prompt. Never send a placeholder path or rely on a folder name.
3. The new task must first follow Step 3 below, then Step 4, then Step 5. Its prompt must explicitly authorize the complete bootstrap and tell it not to ask the participant to operate Codex.
4. Verify task creation returned a distinct \`threadId\` rather than an agent/subagent ID. Then use \`navigate_to_codex_page\` with that \`threadId\` so the participant is moved to the independent task without manual switching.
5. If \`create_thread\`, a distinct \`threadId\`, or programmatic navigation is unavailable, stop with \`STUDY_SETUP_BLOCKED_TASK_CREATION\`; do not transfer the operation to the participant.

Continuation instruction:

> Continue the authorized Ikran Study bootstrap using the concrete absolute MANIFEST_PATH and assigned stable workspaceId supplied in this prompt. First call the native activate_study_workspace tool with exactly those two values and verify its returned package, plugin version, workspace ID, active project, and Figma identity. Then verify the host-native Figma MCP, open and present the exact Workbench URL, and only then continue the existing Alignment. Do not request credentials, do not add or refresh evidence, and do not ask the participant to operate Codex.

## Step 3 — verify native Ikran MCP

- Confirm \`activate_study_workspace\`, \`list_working_folders\`, and \`open_workbench\` are native tools in the new task.
- First call \`activate_study_workspace\` with \`manifestPath\` = the concrete absolute \`MANIFEST_PATH\` and \`workspaceId\` = the assigned stable ID. Do not call \`create_or_open_project\` with a guessed path.
- Require \`ok: true\` and verify the returned package, plugin version, \`workspace_id\`, workspace number, Figma fileKey/nodeId, and \`active_project\` against the manifest. This call is the authoritative workspace selection even when MCP Roots are empty, stale, or point at another downloaded Study Kit.
- Call \`list_working_folders\` as a diagnostic. After successful activation it must report the assigned folder with source \`study_manifest\`; the task cwd and a similarly named folder are not evidence.
- Call \`open_workbench\`. Its \`workspace_source\` must remain \`study_manifest\`, and its \`active_project\` and Workbench project must still equal the activated manifest workspace.
- If verification fails, stop with \`STUDY_SETUP_BLOCKED_IKRAN_MCP\`. Do not build an ad-hoc client, manipulate plugin cache files, or edit the database.

## Step 4 — verify the host-native Figma MCP

This means the Figma MCP supplied by the Agent host, not any Ikran tool.

1. Confirm the host-native Figma MCP tools are available and authenticated.
2. Use that MCP to read metadata or design context for the assigned manifest fileKey and nodeId shown above.
3. Verify the returned source identity matches both values. Tool presence alone is not sufficient.
4. Only a successful read permits the study to start. On any absence, authorization failure, access failure, or identity mismatch, stop with \`STUDY_SETUP_BLOCKED_FIGMA_MCP\`. Never request credentials through Ikran.

## Step 5 — present the Workbench

- Open the exact Workbench URL returned by \`open_workbench\` in the host's embedded browser yourself.
- Post that exact URL in chat as a fallback, but do not require the participant to use it when the embedded browser opened correctly.
- Confirm the visible title identifies ${single ? workspaces[0].displayName : "the assigned numbered workspace"}.
- Continue the preloaded Alignment only after the Workbench is visible and both MCP checks passed.

The study evidence is preloaded and frozen. Never add, replace, or refresh a Seed Reference. If the Draft Design System has omissions, use Draft revision tools to create one new active revision; do not abandon the project phase or return to Seed.
`;
}
