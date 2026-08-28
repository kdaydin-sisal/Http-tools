import { readFile } from "node:fs/promises";
import { startAppRuntime } from "./core/app-runtime.js";
import { ensureDevToolsOnPath } from "./core/dev-tool-path.js";
import type { TrafficRule } from "./core/types.js";

ensureDevToolsOnPath();

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
};

const loadRules = async (rulesFilePath?: string): Promise<TrafficRule[]> => {
  if (!rulesFilePath) return [];
  const content = await readFile(rulesFilePath, "utf8");
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error("Rules file must contain a JSON array");
  }
  return parsed as TrafficRule[];
};

const run = async () => {
  const [, , maybeRulesPath] = process.argv;
  const preferredProxyPort = parsePort(process.env.HTTP_TOOLS_PROXY_PORT, 8000);
  const preferredApiPort = parsePort(process.env.HTTP_TOOLS_API_PORT, 8001);
  const manageSystemProxy = process.env.HTTP_TOOLS_MANAGE_SYSTEM_PROXY !== "0";
  const rules = await loadRules(maybeRulesPath);

  const runtime = await startAppRuntime({
    preferredProxyPort,
    preferredApiPort,
    rules,
    manageSystemProxy,
    onRequest: (event: any) => {
      console.log(`[request] ${event.method} ${event.url} rules=${event.matchedRuleIds?.join(",") || "-"}`);
    },
    onResponse: (event: any) => {
      console.log(`[response] ${event.statusCode} rules=${event.matchedRuleIds?.join(",") || "-"}`);
    },
    onError: (error) => {
      console.error("[proxy-error]", error);
    },
  });

  const proxyEnv = runtime.proxy.getProxyEnv();
  console.log(`Proxy listening on :${runtime.proxyPort}${runtime.proxyPort !== preferredProxyPort ? ` (preferred port ${preferredProxyPort} was busy)` : ""}`);
  console.log(`Control API listening on :${runtime.apiPort}${runtime.apiPort !== preferredApiPort ? ` (preferred port ${preferredApiPort} was busy)` : ""}`);
  console.log(`Set device proxy to host=<your-mac-ip> port=${runtime.proxyPort}`);
  console.log(`Trust this CA cert on test devices: ${runtime.certPath}`);
  console.log(`Suggested env: HTTP_PROXY=${proxyEnv.HTTP_PROXY} HTTPS_PROXY=${proxyEnv.HTTPS_PROXY}`);

  if (runtime.systemProxyManaged) {
    console.log(`macOS system proxy set on network service "${runtime.networkServiceName}" -> 127.0.0.1:${runtime.proxyPort} (will be restored on exit)`);
  } else if (manageSystemProxy) {
    console.log("Could not automatically set the macOS system proxy (no active network service detected) — set it manually if needed.");
  }

  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
