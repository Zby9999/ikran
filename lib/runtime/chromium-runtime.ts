import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const EXECUTABLE_NAMES = new Set([
  "chrome",
  "chrome.exe",
  "chrome-headless-shell",
  "chrome-headless-shell.exe",
  "Google Chrome for Testing"
]);

function executableIn(root: string): string | null {
  if (!existsSync(root)) return null;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      if (entry.isFile() && EXECUTABLE_NAMES.has(entry.name)) return absolute;
    }
  }
  return null;
}

function validExecutable(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

export async function resolveIkranChromiumExecutable(): Promise<string> {
  const override = validExecutable(process.env.IKRAN_CHROMIUM_EXECUTABLE_PATH);
  if (override) return override;

  const appDir = process.env.IKRAN_APP_DIR
    ? path.resolve(process.env.IKRAN_APP_DIR)
    : process.cwd();
  const bundled = executableIn(path.join(appDir, ".playwright-browsers"));
  if (bundled) return bundled;

  const { chromium } = await import("playwright-core");
  const installed = validExecutable(chromium.executablePath());
  if (installed) return installed;

  if (process.env.IKRAN_RUNTIME_PROD !== "1" || process.env.IKRAN_ALLOW_SYSTEM_CHROME === "1") {
    const systemCandidates = process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium"
        ]
      : process.platform === "win32"
        ? [
            path.join(process.env.PROGRAMFILES ?? "", "Google/Chrome/Application/chrome.exe"),
            path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Google/Chrome/Application/chrome.exe")
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
    for (const candidate of systemCandidates) {
      const available = validExecutable(candidate);
      if (available) return available;
    }
  }

  throw new Error(
    "Ikran Chromium is unavailable. The release must include .playwright-browsers or setup:product must install Chromium."
  );
}

export async function launchIkranChromium() {
  const [{ chromium }, executablePath] = await Promise.all([
    import("playwright-core"),
    resolveIkranChromiumExecutable()
  ]);
  return chromium.launch({ headless: true, executablePath });
}

export async function probeIkranChromium(): Promise<
  { ok: true; executablePath: string } |
  { ok: false; reason: "browser_unavailable"; details: { message: string } }
> {
  try {
    const executablePath = await resolveIkranChromiumExecutable();
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ headless: true, executablePath });
    await browser.close();
    return { ok: true, executablePath };
  } catch (error) {
    return {
      ok: false,
      reason: "browser_unavailable",
      details: { message: error instanceof Error ? error.message : String(error) }
    };
  }
}
