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

Plugin discovery is fixed for an already-running task. After installation, use the host-native task creation capability to create a new Codex task rooted at the assigned numbered workspace and send that task this continuation instruction plus the manifest identity. Do not ask the participant to create or switch tasks. If the host cannot create a correctly rooted task programmatically, stop with \`STUDY_SETUP_BLOCKED_TASK_CREATION\`; do not transfer the operation to the participant.

Continuation instruction:

> Continue the Ikran Study bootstrap for the assigned workspace. Read the package manifest supplied by the bootstrap task, verify native Ikran tools and the host-native Figma MCP, open the exact Workbench URL, and only then continue the existing Alignment. Do not request credentials and do not add or refresh evidence.

## Step 3 — verify native Ikran MCP

- Confirm \`list_working_folders\` and \`open_workbench\` are native tools in the new task.
- Call \`list_working_folders\`. A missing host Root may produce an empty discovered folder; that alone is not a mismatch.
- Call \`open_workbench\`. The manifest workspace ID, numbered workspace, \`active_project\`, and Workbench project must resolve to the assigned workspace. A non-empty discovered folder that conflicts is a failure.
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
