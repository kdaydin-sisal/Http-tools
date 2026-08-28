import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { X509Certificate } from "node:crypto";
import { CommandExecutionError, runCommand } from "../../utils/process.js";
import type {
  AndroidDevice,
  AndroidDeviceHealth,
  AndroidProxyConfig,
  AndroidTrustSetupResult,
} from "./types.js";

const parseDeviceState = (rawState: string): AndroidDevice["state"] => {
  if (rawState === "device") return "device";
  if (rawState === "offline") return "offline";
  if (rawState === "unauthorized") return "unauthorized";
  return "unknown";
};

const buildAdbTargetArgs = (serial: string, args: string[]) => ["-s", serial, ...args];

const pemToDer = (certPem: string) => new X509Certificate(certPem).raw;
const formatCommandFailure = (error: unknown) => {
  if (error instanceof CommandExecutionError) {
    const details = [error.result.stderr.trim(), error.result.stdout.trim()].filter(Boolean).join(" | ");
    return details.length > 0 ? `${error.message} (${details})` : error.message;
  }

  return error instanceof Error ? error.message : String(error);
};

export class AndroidAdapter {
  async ensureAdbAvailable() {
    try {
      await runCommand("adb", ["version"]);
    } catch (error) {
      throw new Error("ADB not available. Install Android platform-tools and ensure `adb` is in PATH.");
    }
  }

  async listDevices(): Promise<AndroidDevice[]> {
    const result = await runCommand("adb", ["devices", "-l"]);
    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("List of devices attached"));

    return lines.map((line) => {
      const [serial, rawState, ...attrs] = line.split(/\s+/);
      const modelAttr = attrs.find((attr) => attr.startsWith("model:"));
      const transport = attrs.find((attr) => attr.startsWith("transport_id:"));
      return {
        serial,
        state: parseDeviceState(rawState),
        model: modelAttr?.replace("model:", "").replace(/_/g, " "),
        transport,
      };
    });
  }

  async setGlobalHttpProxy(serial: string, config: AndroidProxyConfig) {
    const value = `${config.host}:${config.port}`;
    await runCommand("adb", buildAdbTargetArgs(serial, ["shell", "settings", "put", "global", "http_proxy", value]));
  }

  async clearGlobalHttpProxy(serial: string) {
    await runCommand("adb", buildAdbTargetArgs(serial, ["shell", "settings", "put", "global", "http_proxy", ":0"]));
  }

  async createReverseTunnel(serial: string, localPort: number, remotePort: number) {
    await runCommand("adb", buildAdbTargetArgs(serial, ["reverse", `tcp:${remotePort}`, `tcp:${localPort}`]));
  }

  async removeReverseTunnel(serial: string, remotePort: number) {
    await runCommand("adb", buildAdbTargetArgs(serial, ["reverse", "--remove", `tcp:${remotePort}`]));
  }

  async prepareCertificateInstall(serial: string, certPem: string): Promise<AndroidTrustSetupResult> {
    const tmpDir = path.join(os.tmpdir(), "http-tools");
    const localCertPath = path.join(tmpDir, `http-tools-ca-${Date.now()}.cer`);
    await mkdir(tmpDir, { recursive: true });
    await writeFile(localCertPath, pemToDer(certPem));

    const remoteDir = "/storage/emulated/0/Download";
    const remotePath = `${remoteDir}/http-tools-ca.cer`;
    try {
      try {
        await runCommand("adb", buildAdbTargetArgs(serial, ["shell", "mkdir", remoteDir]));
      } catch (error) {
        const details = formatCommandFailure(error);
        if (!details.includes("File exists")) {
          throw error;
        }
      }
      await runCommand("adb", buildAdbTargetArgs(serial, ["push", localCertPath, remotePath]));
    } catch (error) {
      throw new Error(`Failed to push CA certificate to device: ${formatCommandFailure(error)}`);
    }

    return {
      certPushedPath: remotePath,
      installIntentStarted: false,
    };
  }

  async getDeviceHealth(serial: string): Promise<AndroidDeviceHealth> {
    const notes: string[] = [];

    let hasAdbRoot = false;
    try {
      const rootResult = await runCommand("adb", buildAdbTargetArgs(serial, ["root"]));
      hasAdbRoot = /restarting adbd as root|already running as root/i.test(
        `${rootResult.stdout}\n${rootResult.stderr}`,
      );
      if (!hasAdbRoot) {
        notes.push("ADB root not available on this device/build.");
      }
    } catch (error) {
      notes.push("ADB root command failed (common on production devices).");
    }

    let canSetGlobalProxy = true;
    try {
      await runCommand("adb", buildAdbTargetArgs(serial, ["shell", "settings", "get", "global", "http_proxy"]));
    } catch (error) {
      canSetGlobalProxy = false;
      notes.push("Cannot read global proxy setting.");
    }

    return {
      hasAdbRoot,
      canSetGlobalProxy,
      notes,
    };
  }

  async runDeviceHttpProbe(serial: string): Promise<boolean> {
    try {
      await runCommand("adb", buildAdbTargetArgs(serial, ["shell", "curl", "-I", "http://example.com"]));
      return true;
    } catch (error) {
      if (error instanceof CommandExecutionError) {
        return false;
      }
      throw error;
    }
  }
}
