import { runCommand } from "../utils/process.js";

export interface ProxyServiceState {
  service: string;
  http: { enabled: boolean; server: string; port: number };
  https: { enabled: boolean; server: string; port: number };
}

const parseGetProxyOutput = (output: string) => {
  const lines = output.split("\n").map((line) => line.trim());
  const get = (label: string) => lines.find((line) => line.startsWith(label))?.slice(label.length).trim() ?? "";
  return {
    enabled: get("Enabled:") === "Yes",
    server: get("Server:"),
    port: Number.parseInt(get("Port:") || "0", 10) || 0,
  };
};

/**
 * Finds the macOS network service name (e.g. "Wi-Fi") backing the interface used for the
 * default route, so we configure the proxy on the interface actually carrying traffic.
 */
export const getActiveNetworkServiceName = async (): Promise<string | null> => {
  let activeDevice: string | null = null;
  try {
    const routeResult = await runCommand("route", ["get", "default"]);
    const match = routeResult.stdout.match(/interface:\s*(\S+)/);
    activeDevice = match?.[1] ?? null;
  } catch {
    return null;
  }
  if (!activeDevice) return null;

  const orderResult = await runCommand("networksetup", ["-listnetworkserviceorder"]);
  const blocks = orderResult.stdout.split(/\n(?=\(\d+\))/);
  for (const block of blocks) {
    const nameMatch = block.match(/^\(\d+\)\s*(.+)$/m);
    const deviceMatch = block.match(/Device:\s*([^\s)]+)/);
    if (nameMatch && deviceMatch && deviceMatch[1] === activeDevice) {
      return nameMatch[1].trim();
    }
  }
  return null;
};

/**
 * Reads the current HTTP/HTTPS proxy configuration for a network service, so it can be
 * restored exactly when the tool stops or exits.
 */
export const readProxyState = async (service: string): Promise<ProxyServiceState> => {
  const [httpResult, httpsResult] = await Promise.all([
    runCommand("networksetup", ["-getwebproxy", service]),
    runCommand("networksetup", ["-getsecurewebproxy", service]),
  ]);
  return {
    service,
    http: parseGetProxyOutput(httpResult.stdout),
    https: parseGetProxyOutput(httpsResult.stdout),
  };
};

/**
 * Points the given network service's HTTP and HTTPS proxy settings at 127.0.0.1:<port>.
 */
export const setSystemProxy = async (service: string, host: string, port: number): Promise<void> => {
  await runCommand("networksetup", ["-setwebproxy", service, host, String(port)]);
  await runCommand("networksetup", ["-setsecurewebproxy", service, host, String(port)]);
  await runCommand("networksetup", ["-setwebproxystate", service, "on"]);
  await runCommand("networksetup", ["-setsecurewebproxystate", service, "on"]);
};

/**
 * Restores a previously captured proxy state for a network service (used on shutdown).
 */
export const restoreProxyState = async (state: ProxyServiceState): Promise<void> => {
  if (state.http.enabled && state.http.server) {
    await runCommand("networksetup", ["-setwebproxy", state.service, state.http.server, String(state.http.port)]);
    await runCommand("networksetup", ["-setwebproxystate", state.service, "on"]);
  } else {
    await runCommand("networksetup", ["-setwebproxystate", state.service, "off"]);
  }

  if (state.https.enabled && state.https.server) {
    await runCommand("networksetup", ["-setsecurewebproxy", state.service, state.https.server, String(state.https.port)]);
    await runCommand("networksetup", ["-setsecurewebproxystate", state.service, "on"]);
  } else {
    await runCommand("networksetup", ["-setsecurewebproxystate", state.service, "off"]);
  }
};

/**
 * Turns off the HTTP/HTTPS proxy for a network service entirely (fallback when no prior
 * state was captured, e.g. after a crash).
 */
export const clearSystemProxy = async (service: string): Promise<void> => {
  await runCommand("networksetup", ["-setwebproxystate", service, "off"]);
  await runCommand("networksetup", ["-setsecurewebproxystate", service, "off"]);
};
