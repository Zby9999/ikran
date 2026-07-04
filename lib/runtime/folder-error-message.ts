// Maps Runtime folder-binding error codes to short, designer-facing copy.
// Keep in sync with validateProjectFolder() reasons and /api/project/* errors.

const MESSAGES: Record<string, string> = {
  missing_path: "Enter a project folder path.",
  invalid_path: "That path is not valid.",
  not_a_directory: "Choose a folder, not a file.",
  path_not_found: "That folder could not be found.",
  not_accessible: "Ikran cannot access that folder.",
  binding_failed: "Could not bind this folder. Try again.",
  invalid_json: "Something went wrong. Try again.",
  no_active_project: "Select a project folder first.",
  native_picker_unavailable: "Could not open the folder picker.",
  native_picker_cancelled: ""
};

export function folderErrorMessage(code: string | undefined): string {
  if (!code) {
    return "Could not bind this folder. Try again.";
  }
  return MESSAGES[code] ?? "Could not bind this folder. Try again.";
}
