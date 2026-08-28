import { readFile } from "node:fs/promises";
import { ensureLocalCa } from "./core/ca-store.js";
import { ProxyService } from "./core/proxy-service.js";
import { ApiServer } from "./control-plane/api-server.js";
import type { TrafficRule } from "./core/types.js";

const parsePort = (value: string | undefined) => {
  if (!value) return 8000;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
};

const parseApiPort = (value: string | undefined) => {
  if (!value) return 8001;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid API port: ${value}`);
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
  const port = parsePort(process.env.HTTP_TOOLS_PROXY_PORT);
  const apiPort = parseApiPort(process.env.HTTP_TOOLS_API_PORT);

  const [ca, rules] = await Promise.all([ensureLocalCa(), loadRules(maybeRulesPath)]);

  const proxy = new ProxyService();
  proxy.setRules(rules);
  proxy.onError((error) => {
    console.error("[proxy-error]", error);
  });
  proxy.onRequest((event) => {
    console.log(`[request] ${event.method} ${event.url} rules=${event.matchedRuleIds.join(",") || "-"}`);
  });
  proxy.onResponse((event) => {
    console.log(`[response] ${event.statusCode} rules=${event.matchedRuleIds.join(",") || "-"}`);
  });

  await proxy.start({
    port,
    caKeyPem: ca.key,
    caCertPem: ca.cert,
  });

  const apiServer = new ApiServer(proxy, { certPath: ca.certPath, certPem: ca.cert, apiPort });
  await apiServer.start(apiPort);

  const proxyEnv = proxy.getProxyEnv();
  console.log(`Proxy listening on :${proxy.getPort()}`);
  console.log(`Control API listening on :${apiPort}`);
  console.log(`Set device proxy to host=<your-mac-ip> port=${proxy.getPort()}`);
  console.log(`Trust this CA cert on test devices: ${ca.certPath}`);
  console.log(`Suggested env: HTTP_PROXY=${proxyEnv.HTTP_PROXY} HTTPS_PROXY=${proxyEnv.HTTPS_PROXY}`);

  process.on("SIGINT", async () => {
    await apiServer.stop();
    await proxy.stop();
    process.exit(0);
  });
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
