import { ensureLocalCa } from "./ca-store.js";
import { ProxyService } from "./proxy-service.js";
import { ApiServer } from "../control-plane/api-server.js";
import { findFreePortPair } from "./port-finder.js";
import {
  clearSystemProxy,
  getActiveNetworkServiceName,
  readProxyState,
  restoreProxyState,
  setSystemProxy,
  type ProxyServiceState,
} from "./macos-system-proxy.js";
import type { TrafficRule } from "./types.js";

export interface AppRuntimeOptions {
  preferredProxyPort?: number;
  preferredApiPort?: number;
  rules?: TrafficRule[];
  /** When true (default on macOS), automatically point the system HTTP/HTTPS proxy at this tool. */
  manageSystemProxy?: boolean;
  onRequest?: (event: unknown) => void;
  onResponse?: (event: unknown) => void;
  onError?: (error: Error) => void;
}

export interface AppRuntimeHandle {
  proxy: ProxyService;
  apiServer: ApiServer;
  proxyPort: number;
  apiPort: number;
  certPath: string;
  systemProxyManaged: boolean;
  networkServiceName: string | null;
  stop: () => Promise<void>;
}

/**
 * Starts the proxy + control API + (optionally) macOS system proxy configuration.
 * Shared between the plain CLI entrypoint (src/index.ts) and the Electron tray app so
 * startup/shutdown behaviour stays consistent between both.
 */
export const startAppRuntime = async (options: AppRuntimeOptions = {}): Promise<AppRuntimeHandle> => {
  const {
    preferredProxyPort = 8000,
    preferredApiPort = 8001,
    rules = [],
    manageSystemProxy = process.platform === "darwin",
    onRequest,
    onResponse,
    onError,
  } = options;

  const [ca, { proxyPort, apiPort }] = await Promise.all([
    ensureLocalCa(),
    findFreePortPair(preferredProxyPort, preferredApiPort),
  ]);

  const proxy = new ProxyService();
  proxy.setRules(rules);
  proxy.onError((error) => onError?.(error));
  proxy.onRequest((event) => onRequest?.(event));
  proxy.onResponse((event) => onResponse?.(event));

  await proxy.start({
    port: proxyPort,
    caKeyPem: ca.key,
    caCertPem: ca.cert,
  });

  const apiServer = new ApiServer(proxy, { certPath: ca.certPath, certPem: ca.cert, apiPort });
  await apiServer.start(apiPort);

  let networkServiceName: string | null = null;
  let priorProxyState: ProxyServiceState | null = null;
  let systemProxyManaged = false;

  if (manageSystemProxy) {
    try {
      networkServiceName = await getActiveNetworkServiceName();
      if (networkServiceName) {
        priorProxyState = await readProxyState(networkServiceName);
        await setSystemProxy(networkServiceName, "127.0.0.1", proxy.getPort());
        systemProxyManaged = true;
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;

    if (systemProxyManaged && networkServiceName) {
      try {
        if (priorProxyState) {
          await restoreProxyState(priorProxyState);
        } else {
          await clearSystemProxy(networkServiceName);
        }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }

    await apiServer.stop();
    await proxy.stop();
  };

  return {
    proxy,
    apiServer,
    proxyPort,
    apiPort,
    certPath: ca.certPath,
    systemProxyManaged,
    networkServiceName,
    stop,
  };
};
