export function studyKitStartHere(packageName, workspaces) {
  const single = workspaces.length === 1;
  const title = single
    ? `Ikran Study Kit ${workspaces[0].id.slice(-1)} — Codex`
    : "Ikran Study Kit — Codex";
  const workspaceInstruction = single
    ? `3. Start a **new Codex task** from the package's only workspace: \`${workspaces[0].path}\`.`
    : `3. Start a **new Codex task** from exactly one assigned workspace:\n${workspaces.map((workspace) => `   - \`${workspace.path}\``).join("\n")}`;
  const setupAudience = single ? "Participant setup" : "Researcher setup";
  const workspaceDescription = single
    ? "one preloaded study workspace"
    : `${workspaces.length} preloaded, independent study workspaces`;

  return `# ${title}\n\nThis package contains one Codex plugin and ${workspaceDescription}.\n\n## ${setupAudience}\n\n1. Keep this extracted folder intact.\n2. Ask Codex to install the bundled plugin, or run:\n\n   \`\`\`bash\n   codex plugin marketplace add <PATH_TO_${packageName}>\n   codex plugin add ikran@ikran-study-kit\n   \`\`\`\n\n${workspaceInstruction}\n4. Give this file to the Agent as context, then ask: \`打开 Ikran，并继续当前 Alignment。\`\n\n## Agent operating instructions\n\n### Step 0 — verify the native Ikran MCP connection\n\n- Before reading project state or continuing Alignment, verify that the installed Ikran MCP exposes both \`list_working_folders\` and \`open_workbench\` as native tools in this task. Then call them directly.\n- If either Ikran MCP tool is unavailable, stop and report the connection failure to the participant. Do not attempt a workaround.\n- Do not create an ad-hoc MCP client, launch or restart Ikran from the shell, modify the installed plugin or plugin cache, or read/write the Ikran database directly.\n\n### Bind the assigned workspace\n\n- First call \`list_working_folders\`. The reported folder must be the Study Kit \`workspace\` selected for this task. Then call \`open_workbench\` and confirm its \`active_project\` is that same folder before continuing.\n- If the discovered folder, \`active_project\`, or Workbench project differs, stop and report the mismatch. Do not repair it by switching Runtime processes or state directories.\n- Perform all Alignment and later source-of-truth changes through Ikran's semantic MCP tools.\n\nThe workspace already contains its Figma reference, evidence screenshot, positional nodes, and unanswered Alignment cards. Question answer fields are intentionally blank; no proposed answers are prefilled. A Figma Connection is not required. Do not refresh or replace the reference during the study.\n\nThe workspace is frozen before Draft Design System generation.\n`;
}
