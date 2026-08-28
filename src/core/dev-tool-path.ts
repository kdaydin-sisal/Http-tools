import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

/**
 * GUI-launched macOS apps (like a packaged Electron .app opened via Finder/Dock)
 * do not inherit the user's interactive shell PATH. Tools like `adb` (Android
 * platform-tools) and Homebrew binaries are commonly missing as a result, which
 * makes device discovery silently fail. This augments process.env.PATH with the
 * common install locations so child_process spawns (adb, xcrun, etc.) can find
 * them regardless of how the app was launched.
 */
export const ensureDevToolsOnPath = (): void => {
  const home = os.homedir();
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(home, "Library", "Android", "sdk");

  const candidateDirs = [
    path.join(androidHome, "platform-tools"),
    path.join(androidHome, "emulator"),
    path.join(androidHome, "cmdline-tools", "latest", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];

  const existingPath = process.env.PATH ?? "";
  const existingEntries = new Set(existingPath.split(path.delimiter).filter(Boolean));

  const toAdd = candidateDirs.filter((dir) => existsSync(dir) && !existingEntries.has(dir));
  if (toAdd.length === 0) return;

  process.env.PATH = [...toAdd, existingPath].filter(Boolean).join(path.delimiter);
};
