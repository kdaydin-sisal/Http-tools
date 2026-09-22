import { AndroidAdapter } from "./android/android-adapter.js";
import { bootstrapCompanionApp } from "./android/companion-bootstrap.js";
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
  /**
   * "advanced-global-proxy": the legacy Android ADB global-proxy path (opt-in,
   * affects the whole device). "ios-manual": the existing iOS simulator/
   * real-device flow. The companion-app bootstrap never creates a session
   * here — see `bootstrapAndroidCompanion` — because listening only actually
   * starts once the phone pairs over the network, independent of ADB.
   */
  mode: "advanced-global-proxy" | "ios-manual";
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

  /**
   * Primary "Listen" action. For iOS this is unchanged (CA install + manual
   * proxy instructions). For Android, this now bootstraps the companion app
   * (install/update if needed, then launch) instead of touching the device's
   * global proxy setting — the companion app handles pairing and per-app
   * traffic capture itself once the user scans the onboarding page's QR code.
   *
   * This does not track an `activeSessions` entry for Android: unlike the
   * legacy global-proxy path, there's nothing here to "stop" from the Mac
   * side — pairing/listening state lives in the companion app and the
   * pairing service, not in an ADB-held device setting.
   */
  async startListening(deviceId: string, platform: DevicePlatform, proxyPort: number, _controlPort: number, certPem: string, certPath: string): Promise<{ ok: boolean; message: string; requiresManualCertInstall?: boolean }> {
    const proxyHost = getMacIp();

    if (platform === "android") {
      try {
        await this.androidAdapter.ensureAdbAvailable();
        const result = await bootstrapCompanionApp(this.androidAdapter, deviceId);
        return { ok: result.ok, message: result.message };
      } catch (error) {
        return { ok: false, message: `Companion app setup failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    if (platform === "ios") {
      if (this.activeSessions.has(deviceId)) {
        return { ok: true, message: "Already listening on this device." };
      }
      try {
        await this.iosAdapter.ensureXcodeToolsAvailable();
        await this.iosAdapter.installCaCertificateOnSimulator(deviceId, certPath);

        this.activeSessions.set(deviceId, {
          deviceId,
          platform: "ios",
          mode: "ios-manual",
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

  /**
   * Advanced/legacy Android path: sets the device's system-wide HTTP proxy via
   * ADB (`settings put global http_proxy`), affecting every app on the
   * device, not just the one being debugged. Kept only as an explicit opt-in
   * for cases where the companion app's VPN can't be used (e.g. another VPN
   * is already active, or the device is locked down) — it must never be
   * reachable from the primary "Listen" button. Requires `confirmed: true`
   * so the caller (API layer) is forced to have shown the risk warning first.
   */
  async startAdvancedAndroidProxy(
    deviceId: string,
    proxyPort: number,
    certPem: string,
    confirmed: boolean,
  ): Promise<{ ok: boolean; message: string; requiresConfirmation?: boolean; requiresManualCertInstall?: boolean }> {
    if (!confirmed) {
      return {
        ok: false,
        requiresConfirmation: true,
        message:
          "This sets the device's system-wide HTTP proxy via ADB, affecting every app on the device (not just the one " +
          "you're debugging). If HTTP Tools quits or is killed without clearing it, the device can lose network access " +
          "until the proxy is cleared manually. Prefer the companion app (Listen button) unless you specifically need this.",
      };
    }

    if (this.activeSessions.has(deviceId)) {
      return { ok: true, message: "Already listening on this device." };
    }

    const proxyHost = getMacIp();
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
        mode: "advanced-global-proxy",
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

  async stopListening(deviceId: string): Promise<{ ok: boolean; message: string }> {
    const session = this.activeSessions.get(deviceId);
    if (!session) {
      return { ok: true, message: "Device was not being listened." };
    }

    if (session.mode === "advanced-global-proxy") {
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
      message: session.mode === "ios-manual"
        ? "Session removed. To fully stop, remove the proxy in simulator Wi-Fi settings."
        : "Proxy settings cleared on device.",
    };
  }

  /**
   * Reverts every active Android global-proxy session. Must be called on app shutdown
   * (normal quit, crash-recovery best-effort, SIGINT/SIGTERM) — otherwise a device that
   * was configured via the "Listen" button keeps pointing at this Mac's proxy forever,
   * breaking its networking the moment this tool stops or the device disconnects and
   * reconnects to a different network. This is the exact failure mode the VPN-based
   * companion app was built to avoid for its own sessions, but the legacy ADB-based
   * per-device-proxy path (still used for devices not paired via the companion app)
   * needs the same guarantee.
   */
  async stopAllSessions(): Promise<void> {
    const deviceIds = [...this.activeSessions.keys()];
    await Promise.all(deviceIds.map((deviceId) => this.stopListening(deviceId).catch(() => undefined)));
  }

  getActiveSession(deviceId: string): ActiveListeningSession | undefined {
    return this.activeSessions.get(deviceId);
  }

  listActiveSessions(): ActiveListeningSession[] {
    return [...this.activeSessions.values()];
  }

  /**
   * Polls `adb devices` and clears any active session whose device has disconnected
   * (unplugged, adb killed, etc.) — the on-device proxy setting itself can't be reached
   * once disconnected, but this at least drops our stale bookkeeping and surfaces a
   * clear warning instead of silently pretending the session is still active. If the
   * device reconnects to the same Mac later without the proxy having been cleared,
   * the user will see the stale setting and should run `stopListening` (or the
   * onboarding "Stop" action) to clear it, or clear it manually with:
   *   adb -s <serial> shell settings put global http_proxy :0
   */
  async pruneDisconnectedSessions(): Promise<string[]> {
    if (this.activeSessions.size === 0) return [];
    let connectedSerials: Set<string>;
    try {
      const devices = await this.androidAdapter.listDevices();
      connectedSerials = new Set(devices.filter((d) => d.state === "device").map((d) => d.serial));
    } catch {
      return [];
    }

    const stale: string[] = [];
    for (const [deviceId, session] of this.activeSessions) {
      if (session.platform === "android" && !connectedSerials.has(deviceId)) {
        stale.push(deviceId);
      }
    }
    stale.forEach((deviceId) => this.activeSessions.delete(deviceId));
    return stale;
  }
}
