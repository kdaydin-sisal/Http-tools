import { AndroidAdapter } from "./android-adapter.js";
import {
  COMPANION_MAIN_ACTIVITY,
  COMPANION_PACKAGE_ID,
  resolveCompanionApk,
} from "./companion-release.js";

export type CompanionBootstrapAction = "launched-existing" | "installed" | "updated";

export interface CompanionBootstrapResult {
  ok: boolean;
  action?: CompanionBootstrapAction;
  message: string;
  apkSource?: "cache" | "remote" | "bundled";
  versionName?: string;
}

/**
 * Ensures the HTTP Tools companion app is present (and current) on the given
 * device, then launches it — mirroring HTTP Toolkit's ADB-driven install flow
 * so users don't need a Play Store listing or manual `adb install`.
 *
 * This only installs/launches the companion app; it never touches Android's
 * global proxy settings or any other installed app.
 */
export const bootstrapCompanionApp = async (
  androidAdapter: AndroidAdapter,
  serial: string,
): Promise<CompanionBootstrapResult> => {
  const apk = await resolveCompanionApk();
  const installed = await androidAdapter.getInstalledPackageVersion(serial, COMPANION_PACKAGE_ID);

  let action: CompanionBootstrapAction;
  if (!installed) {
    await androidAdapter.installApk(serial, apk.apkPath);
    action = "installed";
  } else if (installed.versionCode < apk.versionCode) {
    await androidAdapter.installApk(serial, apk.apkPath);
    action = "updated";
  } else {
    action = "launched-existing";
  }

  await androidAdapter.launchApp(serial, COMPANION_PACKAGE_ID, COMPANION_MAIN_ACTIVITY);

  const messageByAction: Record<CompanionBootstrapAction, string> = {
    installed: `Companion app v${apk.versionName} installed and launched. Scan the pairing QR code from this Mac's onboarding page to start listening.`,
    updated: `Companion app updated to v${apk.versionName} and launched. Scan the pairing QR code if this device isn't already paired.`,
    "launched-existing": `Companion app (v${installed?.versionName ?? apk.versionName}) launched. Scan the pairing QR code if this device isn't already paired.`,
  };

  return {
    ok: true,
    action,
    apkSource: apk.source,
    versionName: apk.versionName,
    message: messageByAction[action],
  };
};
