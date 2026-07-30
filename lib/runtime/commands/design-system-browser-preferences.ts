// Design System Browser preferences commands — UX pane state (not research / MCP).

import {
  readDesignSystemBrowserPreferences,
  writeDesignSystemBrowserPreferences,
  type DesignSystemBrowserPreferencesDocument,
  type DesignSystemBrowserPreferencesErrorReason
} from "../design-system-browser-preferences";

export type GetDesignSystemBrowserPreferencesCommandResult =
  | { ok: true; preferences: DesignSystemBrowserPreferencesDocument }
  | { ok: false; reason: DesignSystemBrowserPreferencesErrorReason };

export function getDesignSystemBrowserPreferencesCommand(
  projectPath: string
): GetDesignSystemBrowserPreferencesCommandResult {
  return readDesignSystemBrowserPreferences(projectPath);
}

export type PutDesignSystemBrowserPreferencesCommandResult =
  | { ok: true; preferences: DesignSystemBrowserPreferencesDocument }
  | { ok: false; reason: DesignSystemBrowserPreferencesErrorReason };

export function putDesignSystemBrowserPreferencesCommand(
  projectPath: string,
  input: unknown
): PutDesignSystemBrowserPreferencesCommandResult {
  return writeDesignSystemBrowserPreferences(projectPath, input);
}
