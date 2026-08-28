export interface AndroidDevice {
  serial: string;
  state: "device" | "offline" | "unauthorized" | "unknown";
  model?: string;
  transport?: string;
}

export interface AndroidProxyConfig {
  host: string;
  port: number;
}

export interface AndroidTrustSetupResult {
  certPushedPath: string;
  installIntentStarted: boolean;
}

export interface AndroidDeviceHealth {
  hasAdbRoot: boolean;
  canSetGlobalProxy: boolean;
  notes: string[];
}
