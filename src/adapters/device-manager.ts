import { AndroidAdapter } from "./android/android-adapter.js";
import { IosAdapter } from "./ios/ios-adapter.js";
import { getMacIp } from "../core/network-info.js";

export type DevicePlatform = "android" | "ios";
export type DeviceState = "active" | "offline" | "unauthorized" | "booted" | "shutdown" | "unknown";

export interface DiscoveredDevice {
  id: string; // serial for Android, udid for iOS
  platform: DevicePlatform;
  name: string;
  state: DeviceState;
  isListening: boolean;
  listeningStartedAt?: string;
}

export interface ActiveListeningSession {
  deviceId: string;
  platform: DevicePlatform;
  startedAt: string;
  proxyHost: string;
  proxyPort: number;
  certInstalled: boolean;
}

export interface DeviceListResult {
  devices: DiscoveredDevice[];
  warnings: { android?: string; ios?: string };
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class DeviceManager {
  private readonly androidAdapter = new AndroidAdapter();
  private readonly iosAdapter = new IosAdapter();
  private readonly activeSessions = new Map<string, ActiveListeningSession>();

  async listAllDevices(): Promise<DeviceListResult> {
    const devices: DiscoveredDevice[] = [];
    const warnings: { android?: string; ios?: string } = {};

    // Android devices
    try {
      await this.androidAdapter.ensureAdbAvailable();
      const androidDevices = await this.androidAdapter.listDevices();
      for (const d of androidDevices) {
        const state: DeviceState =
          d.state === "device" ? "active"
          : d.state === "offline" ? "offline"
          : d.state === "unauthorized" ? "unauthorized"
          : "unknown";
        const session = this.activeSessions.get(d.serial);
        devices.push({
          id: d.serial,
          platform: "android",
          name: d.model ?? d.serial,
          state,
          isListening: !!session,
          listeningStartedAt: session?.startedAt,
        });
      }
    } catch (error) {
      warnings.android = describeError(error);
    }

    // iOS simulators
    try {
      await this.iosAdapter.ensureXcodeToolsAvailable();
      const simulators = await this.iosAdapter.listAvailableSimulators();
      for (const sim of simulators) {
        const state: DeviceState =
          sim.state === "Booted" ? "booted"
          : sim.state === "Shutdown" ? "shutdown"
          : "unknown";
        const session = this.activeSessions.get(sim.udid);
        devices.push({
          id: sim.udid,
          platform: "ios",
          name: `${sim.name} (${sim.runtime.replace(/.*\./, "")})`,
          state,
          isListening: !!session,
          listeningStartedAt: session?.startedAt,
        });
      }
    } catch (error) {
      warnings.ios = describeError(error);
    }

    return { devices, warnings };
  }

  async startListening(deviceId: string, platform: DevicePlatform, proxyPort: number, _controlPort: number, certPem: string, certPath: string): Promise<{ ok: boolean; message: string; requiresManualCertInstall?: boolean }> {
    if (this.activeSessions.has(deviceId)) {
      return { ok: true, message: "Already listening on this device." };
    }

    const proxyHost = getMacIp();

    if (platform === "android") {
      try {
        await this.androidAdapter.ensureAdbAvailable();

        // For emulators: use reverse tunnel so device can reach host via 10.0.2.2
        const isEmulator = deviceId.startsWith("emulator-");
        if (isEmulator) {
          await this.androidAdapter.createReverseTunnel(deviceId, proxyPort, proxyPort);
        }

        const effectiveHost = isEmulator ? "10.0.2.2" : proxyHost;
        await this.androidAdapter.setGlobalHttpProxy(deviceId, { host: effectiveHost, port: proxyPort });

        // Push the cert into Downloads so the user can install it manually in Settings.
        const trustResult = await this.androidAdapter.prepareCertificateInstall(deviceId, certPem);

        this.activeSessions.set(deviceId, {
          deviceId,
          platform: "android",
          startedAt: new Date().toISOString(),
          proxyHost: effectiveHost,
          proxyPort,
          certInstalled: false,
        });

        return {
          ok: true,
          message: `Proxy configured. CA certificate pushed to ${trustResult.certPushedPath}. In Android Settings, install that file as a CA certificate. If this device already trusts the HTTP Tools CA, you can skip that step.`,
          requiresManualCertInstall: true,
        };
      } catch (error) {
        return { ok: false, message: `Android setup failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    if (platform === "ios") {
      try {
        await this.iosAdapter.ensureXcodeToolsAvailable();
        await this.iosAdapter.installCaCertificateOnSimulator(deviceId, certPath);

        this.activeSessions.set(deviceId, {
          deviceId,
          platform: "ios",
          startedAt: new Date().toISOString(),
          proxyHost,
          proxyPort,
          certInstalled: true,
        });

        return {
          ok: true,
          message: `CA certificate installed. In the simulator, go to Settings → Wi-Fi → active network → Configure Proxy → Manual, set Server=${proxyHost}, Port=${proxyPort}.`,
          requiresManualCertInstall: false,
        };
      } catch (error) {
        return { ok: false, message: `iOS setup failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    return { ok: false, message: `Unknown platform: ${platform}` };
  }

  async stopListening(deviceId: string): Promise<{ ok: boolean; message: string }> {
    const session = this.activeSessions.get(deviceId);
    if (!session) {
      return { ok: true, message: "Device was not being listened." };
    }

    if (session.platform === "android") {
      try {
        await this.androidAdapter.clearGlobalHttpProxy(deviceId);
        const isEmulator = deviceId.startsWith("emulator-");
        if (isEmulator) {
          await this.androidAdapter.removeReverseTunnel(deviceId, session.proxyPort).catch(() => undefined);
        }
      } catch {
        // Best-effort; remove from sessions regardless
      }
    }
    // iOS simulators: proxy is set manually in device Settings, instruct user

    this.activeSessions.delete(deviceId);
    return {
      ok: true,
      message: session.platform === "ios"
        ? "Session removed. To fully stop, remove the proxy in simulator Wi-Fi settings."
        : "Proxy settings cleared on device.",
    };
  }

  getActiveSession(deviceId: string): ActiveListeningSession | undefined {
    return this.activeSessions.get(deviceId);
  }

  listActiveSessions(): ActiveListeningSession[] {
    return [...this.activeSessions.values()];
  }
}
