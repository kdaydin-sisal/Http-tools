import { X509Certificate } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ProxyService } from "../core/proxy-service.js";
import type { RequestEvent, ResponseEvent, TlsFailureEvent, TrafficRule } from "../core/types.js";
import { DeviceManager, type DevicePlatform } from "../adapters/device-manager.js";
import { renderDashboardHtml } from "./dashboard-html.js";
import { renderOnboardingHtml } from "./onboarding-html.js";
import { renderRulesEditorHtml } from "./rules-editor-html.js";

type StreamEvent =
  | { type: "request"; payload: RequestEvent }
  | { type: "response"; payload: ResponseEvent }
  | { type: "tls-failure"; payload: TlsFailureEvent };

const readJsonBody = async <T>(request: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as T;
};

const writeJson = (response: ServerResponse, statusCode: number, body: unknown) => {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
};

export class ApiServer {
  private sseClients = new Set<ServerResponse>();
  private readonly requestEvents: RequestEvent[] = [];
  private readonly responseEvents: ResponseEvent[] = [];
  private readonly tlsFailureEvents: TlsFailureEvent[] = [];
  private server = createServer((request, response) => {
    void this.handleRequest(request, response);
  });
  private readonly maxStoredEvents = 1000;
  private readonly deviceManager = new DeviceManager();

  constructor(
    private readonly proxyService: ProxyService,
    private readonly uiContext: { certPath: string; certPem: string; apiPort: number },
  ) {
    proxyService.onRequest((event) => {
      this.requestEvents.push(event);
      if (this.requestEvents.length > this.maxStoredEvents) this.requestEvents.shift();
      this.broadcast({ type: "request", payload: event });
    });
    proxyService.onResponse((event) => {
      this.responseEvents.push(event);
      if (this.responseEvents.length > this.maxStoredEvents) this.responseEvents.shift();
      this.broadcast({ type: "response", payload: event });
    });
    proxyService.onTlsFailure((event) => {
      this.tlsFailureEvents.push(event);
      if (this.tlsFailureEvents.length > this.maxStoredEvents) this.tlsFailureEvents.shift();
      this.broadcast({ type: "tls-failure", payload: event });
    });
  }

  async start(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse) {
    try {
      const pathname = (request.url ?? "").split("?")[0];

      if (request.method === "GET" && pathname === "/health") {
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && pathname === "/") {
        const html = renderDashboardHtml({
          proxyPort: this.proxyService.getPort(),
          certPath: this.uiContext.certPath,
        });
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }

      if (request.method === "GET" && pathname === "/rules-editor") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderRulesEditorHtml());
        return;
      }

      if (request.method === "GET" && pathname === "/onboarding") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderOnboardingHtml({
          proxyPort: this.proxyService.getPort(),
          certPath: this.uiContext.certPath,
        }));
        return;
      }

      if (request.method === "GET" && pathname === "/certs/ca.cer") {
        const certDer = new X509Certificate(this.uiContext.certPem).raw;
        response.writeHead(200, {
          "content-type": "application/x-x509-ca-cert",
          "content-length": certDer.byteLength,
          "content-disposition": "inline; filename=\"http-tools-ca.cer\"",
        });
        response.end(certDer);
        return;
      }

      if (request.method === "GET" && pathname === "/rules") {
        writeJson(response, 200, this.proxyService.listRules());
        return;
      }

      if (request.method === "GET" && pathname === "/captures") {
        writeJson(response, 200, {
          requests: this.requestEvents,
          responses: this.responseEvents,
        });
        return;
      }

      if (request.method === "POST" && request.url === "/captures/clear") {
        const body = await readJsonBody<{ keepIds?: string[] }>(request).catch(() => ({ keepIds: [] as string[] }));
        const keepIds = new Set(body.keepIds ?? []);
        this.requestEvents.splice(0, this.requestEvents.length, ...this.requestEvents.filter((event) => keepIds.has(event.id)));
        this.responseEvents.splice(0, this.responseEvents.length, ...this.responseEvents.filter((event) => keepIds.has(event.id)));
        writeJson(response, 200, { ok: true, remaining: this.requestEvents.length });
        return;
      }

      if (request.method === "GET" && pathname === "/diagnostics/unsupported-traffic") {
        writeJson(response, 200, {
          tlsFailures: this.tlsFailureEvents.slice(-200),
          notes: [
            "TLS handshake failures can indicate certificate trust issues or certificate pinning.",
            "Pinned apps or non-HTTP protocols may not be interceptable in this v1 architecture.",
          ],
        });
        return;
      }

      if (request.method === "PUT" && request.url === "/rules") {
        const body = await readJsonBody<TrafficRule[]>(request);
        if (!Array.isArray(body)) {
          writeJson(response, 400, { error: "Body must be an array of rules" });
          return;
        }
        this.proxyService.setRules(body);
        writeJson(response, 200, { ok: true, count: body.length });
        return;
      }

      if (request.method === "GET" && pathname === "/events") {
        this.openSse(response);
        return;
      }

      if (request.method === "GET" && pathname === "/api/devices") {
        const devices = await this.deviceManager.listAllDevices();
        writeJson(response, 200, devices);
        return;
      }

      if (request.method === "GET" && pathname === "/api/devices/sessions") {
        writeJson(response, 200, this.deviceManager.listActiveSessions());
        return;
      }

      const startMatch = request.url?.match(/^\/api\/devices\/([^/]+)\/start$/);
      if (request.method === "POST" && startMatch) {
        const deviceId = decodeURIComponent(startMatch[1]);
        const body = await readJsonBody<{ platform: DevicePlatform }>(request);
        const result = await this.deviceManager.startListening(
          deviceId,
          body.platform,
          this.proxyService.getPort(),
          this.uiContext.apiPort,
          this.uiContext.certPem,
          this.uiContext.certPath,
        );
        writeJson(response, result.ok ? 200 : 500, result);
        return;
      }

      const stopMatch = request.url?.match(/^\/api\/devices\/([^/]+)\/stop$/);
      if (request.method === "POST" && stopMatch) {
        const deviceId = decodeURIComponent(stopMatch[1]);
        const result = await this.deviceManager.stopListening(deviceId);
        writeJson(response, result.ok ? 200 : 500, result);
        return;
      }

      writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private openSse(response: ServerResponse) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");

    this.sseClients.add(response);
    response.on("close", () => {
      this.sseClients.delete(response);
    });
  }

  private broadcast(event: StreamEvent) {
    const payload = JSON.stringify(event);
    for (const client of this.sseClients) {
      client.write(`event: ${event.type}\n`);
      client.write(`data: ${payload}\n\n`);
    }
  }
}
