// Native folder picker wrapper.
//
// The Browser UI cannot (and should not) open the system file dialog directly.
// The Runtime owns the dialog and returns the selected absolute path. This
// module provides best-effort platform support:
// - macOS: AppleScript `choose folder`, with AppKit `NSOpenPanel` as fallback
// - Linux: zenity
// - Windows: PowerShell FolderBrowserDialog
// If no native dialog is available, it returns a structured unavailable result
// so the caller can fall back to a manual path input.

import { spawn } from "node:child_process";
import { platform } from "node:os";

const CANCELLED = "__IKRAN_PICKER_CANCELLED__";

export type FolderPickerResult =
  | { ok: true; path: string }
  | { ok: false; reason: "cancelled" | "unavailable"; detail?: string };

export function selectFolder(): Promise<FolderPickerResult> {
  const os = platform();
  if (os === "darwin") return selectMacOS();
  if (os === "linux") return selectLinux();
  if (os === "win32") return selectWindows();
  return Promise.resolve({ ok: false, reason: "unavailable" });
}

async function selectMacOS(): Promise<FolderPickerResult> {
  const script = `POSIX path of (choose folder with prompt "Select an Ikran project folder")`;
  const appleScript = await runAppleScript(script);
  if (appleScript.ok || appleScript.reason === "cancelled") {
    return appleScript;
  }

  const appKit = await selectMacOSAppKit();
  if (appKit.ok || appKit.reason === "cancelled") {
    return appKit;
  }

  return appleScript;
}

function selectMacOSAppKit(): Promise<FolderPickerResult> {
  const script = `
ObjC.import("Cocoa");
$.NSApplication.sharedApplication;
$.NSApp.setActivationPolicy($.NSApplicationActivationPolicyRegular);
$.NSApp.activateIgnoringOtherApps(true);
const panel = $.NSOpenPanel.openPanel;
panel.canChooseFiles = false;
panel.canChooseDirectories = true;
panel.allowsMultipleSelection = false;
panel.canCreateDirectories = true;
panel.message = "Select an Ikran project folder";
panel.prompt = "Select";
const result = panel.runModal;
if (result === $.NSModalResponseOK) {
  const urls = panel.URLs;
  if (urls.count > 0) {
    console.log(ObjC.unwrap(urls.objectAtIndex(0).path));
  } else {
    console.log(ObjC.unwrap(panel.URL.path));
  }
} else {
  console.log("${CANCELLED}");
}
`;
  return runPickerCommand("osascript", ["-l", "JavaScript", "-e", script]);
}

function runAppleScript(script: string): Promise<FolderPickerResult> {
  return runPickerCommand("osascript", ["-e", script]);
}

function runPickerCommand(
  command: string,
  args: string[]
): Promise<FolderPickerResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      const output = stdout.trim();
      const error = stderr.trim();

      if (output === CANCELLED || error.includes("User canceled")) {
        resolve({ ok: false, reason: "cancelled" });
        return;
      }

      if (code !== 0) {
        resolve({
          ok: false,
          reason: "unavailable",
          detail: error || `${command} exited with code ${code}`
        });
        return;
      }

      if (!output) {
        resolve({ ok: false, reason: "cancelled" });
        return;
      }

      resolve({ ok: true, path: output });
    });

    child.on("error", (error) =>
      resolve({ ok: false, reason: "unavailable", detail: error.message })
    );
  });
}

function selectLinux(): Promise<FolderPickerResult> {
  return new Promise((resolve) => {
    const child = spawn("zenity", ["--file-selection", "--directory"]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          reason: code === 1 ? "cancelled" : "unavailable",
          detail: stderr.trim() || `zenity exited with code ${code}`
        });
        return;
      }
      const output = stdout.trim();
      resolve(output ? { ok: true, path: output } : { ok: false, reason: "cancelled" });
    });
    child.on("error", (error) =>
      resolve({ ok: false, reason: "unavailable", detail: error.message })
    );
  });
}

function selectWindows(): Promise<FolderPickerResult> {
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = "Select an Ikran project folder"
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.SelectedPath
}
`;
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", psScript]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          reason: "unavailable",
          detail: stderr.trim() || `powershell.exe exited with code ${code}`
        });
        return;
      }
      const output = stdout.trim();
      resolve(output ? { ok: true, path: output } : { ok: false, reason: "cancelled" });
    });
    child.on("error", (error) =>
      resolve({ ok: false, reason: "unavailable", detail: error.message })
    );
  });
}
