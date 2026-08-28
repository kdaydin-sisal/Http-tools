import { runCommand } from "../../utils/process.js";
import type { IosOnboardingPlan, IosSimulator } from "./types.js";

interface SimctlDevicesResponse {
  devices: Record<string, Array<{
    name: string;
    udid: string;
    state: string;
    isAvailable?: boolean;
  }>>;
}

const parseState = (state: string): IosSimulator["state"] => {
  if (state === "Booted") return "Booted";
  if (state === "Shutdown") return "Shutdown";
  return "Unknown";
};

export class IosAdapter {
  async ensureXcodeToolsAvailable() {
    await runCommand("xcrun", ["--find", "simctl"]);
  }

  async listAvailableSimulators(): Promise<IosSimulator[]> {
    const result = await runCommand("xcrun", ["simctl", "list", "devices", "available", "--json"]);
    const parsed = JSON.parse(result.stdout) as SimctlDevicesResponse;

    const simulators: IosSimulator[] = [];
    for (const [runtime, devices] of Object.entries(parsed.devices)) {
      for (const device of devices) {
        simulators.push({
          udid: device.udid,
          name: device.name,
          state: parseState(device.state),
          runtime,
        });
      }
    }

    return simulators;
  }

  async bootSimulator(udid: string) {
    await runCommand("xcrun", ["simctl", "boot", udid]);
  }

  async installCaCertificateOnSimulator(udid: string, certPath: string) {
    await runCommand("xcrun", ["simctl", "keychain", udid, "add-root-cert", certPath]);
  }

  async probeSimulatorProxy(udid: string, host: string, port: number): Promise<boolean> {
    try {
      await runCommand("xcrun", [
        "simctl",
        "spawn",
        udid,
        "curl",
        "-I",
        "--max-time",
        "6",
        "--proxy",
        `${host}:${port}`,
        "http://example.com",
      ]);
      return true;
    } catch {
      return false;
    }
  }

  buildSimulatorOnboardingPlan(host: string, port: number, certPath: string): IosOnboardingPlan {
    return {
      target: "simulator",
      steps: [
        `Ensure simulator is booted.`,
        `Install CA certificate in simulator keychain (automated): ${certPath}`,
        `In Simulator app, open Settings > Wi-Fi > active network > Configure Proxy > Manual.`,
        `Set Server=${host}, Port=${port}, then save.`,
        `Enable full trust for the root cert if required in Settings > General > About > Certificate Trust Settings.`,
      ],
    };
  }

  buildRealDeviceOnboardingPlan(host: string, port: number, certPath: string): IosOnboardingPlan {
    return {
      target: "real-device",
      steps: [
        `Connect iPhone/iPad to same network as Mac (or USB-tethered workflow).`,
        `On device Wi-Fi settings, configure Manual Proxy with Server=${host}, Port=${port}.`,
        `Open CA cert on device from Mac-hosted file (${certPath}) or secure transfer, then install profile.`,
        `Enable root certificate trust in Settings > General > About > Certificate Trust Settings.`,
        `Validate by opening an HTTP endpoint and confirming traffic appears in proxy logs.`,
      ],
    };
  }
}
