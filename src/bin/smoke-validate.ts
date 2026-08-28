import { ensureLocalCa } from "../core/ca-store.js";
import { ProxyService } from "../core/proxy-service.js";
import { runCommand } from "../utils/process.js";
import type { TrafficRule } from "../core/types.js";
import { createServer } from "node:http";

const SMOKE_RULES: TrafficRule[] = [
  {
    id: "smoke-response-rewrite",
    enabled: true,
    match: { hostname: "127.0.0.1", pathStartsWith: "/smoke" },
    response: {
      replaceBodyText: "smoke-ok",
      setHeaders: { "content-type": "text/plain" },
    },
  },
];

const run = async () => {
  const ca = await ensureLocalCa();
  const proxy = new ProxyService();
  proxy.setRules(SMOKE_RULES);

  let requestSeen = false;
  let responseSeen = false;
  proxy.onRequest(() => {
    requestSeen = true;
  });
  proxy.onResponse(() => {
    responseSeen = true;
  });

  await proxy.start({
    port: 18000,
    caKeyPem: ca.key,
    caCertPem: ca.cert,
  });

  let upstream: ReturnType<typeof createServer> | undefined;
  try {
    upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("upstream-original");
    });
    await new Promise<void>((resolve, reject) => {
      upstream?.once("error", reject);
      upstream?.listen(19000, () => {
        upstream?.off("error", reject);
        resolve();
      });
    });

    const curl = await runCommand("curl", [
      "-sS",
      "-x",
      "http://127.0.0.1:18000",
      "http://127.0.0.1:19000/smoke",
    ]);

    if (curl.stdout.trim() !== "smoke-ok") {
      throw new Error(`Unexpected curl output: ${curl.stdout}`);
    }
    if (!requestSeen || !responseSeen) {
      throw new Error("Did not observe request+response events during smoke run");
    }
    console.log("Smoke validation passed.");
  } finally {
    if (upstream?.listening) {
      await new Promise<void>((resolve, reject) => {
        upstream?.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    await proxy.stop();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
