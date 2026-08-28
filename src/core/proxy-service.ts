import { EventEmitter } from "node:events";
import { getLocal, type CompletedRequest, type Mockttp, type TlsHandshakeFailure } from "mockttp";
import type {
  ProxyStartOptions,
  RequestEvent,
  ResponseEvent,
  TlsFailureEvent,
  TrafficRule,
} from "./types.js";
import { buildRequestOverride, buildResponseOverride, getMatchingRules } from "./rule-engine.js";

type ProxyEvents = {
  request: [RequestEvent];
  response: [ResponseEvent];
  tlsFailure: [TlsFailureEvent];
  error: [Error];
};

interface MutableResponse {
  id: string;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: Array<[string, string]>;
  body: {
    getText(): Promise<string | undefined>;
  };
}

class TypedEmitter extends EventEmitter {
  on<K extends keyof ProxyEvents>(eventName: K, listener: (...args: ProxyEvents[K]) => void): this {
    return super.on(eventName, listener);
  }

  emit<K extends keyof ProxyEvents>(eventName: K, ...args: ProxyEvents[K]): boolean {
    return super.emit(eventName, ...args);
  }
}

export class ProxyService {
  private readonly events = new TypedEmitter();
  private readonly rules = new Map<string, TrafficRule>();
  private proxy: Mockttp | undefined;

  onRequest(listener: (event: RequestEvent) => void) {
    this.events.on("request", listener);
  }

  onResponse(listener: (event: ResponseEvent) => void) {
    this.events.on("response", listener);
  }

  onError(listener: (error: Error) => void) {
    this.events.on("error", listener);
  }

  onTlsFailure(listener: (event: TlsFailureEvent) => void) {
    this.events.on("tlsFailure", listener);
  }

  setRules(rules: TrafficRule[]) {
    this.rules.clear();
    for (const rule of rules) {
      this.rules.set(rule.id, rule);
    }
  }

  listRules() {
    return [...this.rules.values()];
  }

  async start(options: ProxyStartOptions) {
    if (this.proxy) {
      throw new Error("Proxy already started");
    }

    this.proxy = getLocal({
      https: {
        key: options.caKeyPem,
        cert: options.caCertPem,
      },
      http2: "fallback",
    });

    await this.proxy.start(options.port);
    await this.proxy.on("tls-client-error", async (failure: TlsHandshakeFailure) => {
      this.events.emit("tlsFailure", {
        failureCause: failure.failureCause,
        hostname: failure.hostname,
        remoteIpAddress: failure.remoteIpAddress,
        remotePort: failure.remotePort,
        timestamp: Date.now(),
      });
    });
    await this.proxy.forAnyRequest().thenPassThrough({
      beforeRequest: async (request) => this.handleRequest(request),
      beforeResponse: async (response, request) => this.handleResponse(response, request),
    });
  }

  async stop() {
    if (!this.proxy) return;
    await this.proxy.stop();
    this.proxy = undefined;
  }

  getPort() {
    if (!this.proxy) throw new Error("Proxy not started");
    return this.proxy.port;
  }

  getProxyEnv() {
    if (!this.proxy) throw new Error("Proxy not started");
    return this.proxy.proxyEnv;
  }

  private async handleRequest(request: CompletedRequest) {
    const matchingRules = getMatchingRules([...this.rules.values()], request);

    const bodyText = await request.body.getText().catch(() => undefined);
    this.events.emit("request", {
      id: request.id,
      method: request.method,
      url: request.url,
      headers: request.headers,
      rawHeaders: request.rawHeaders,
      bodyText,
      matchedRuleIds: matchingRules.map((rule) => rule.id),
      timestamp: Date.now(),
    });

    const staticResponseRule = matchingRules.find((rule) => rule.staticResponse);
    if (staticResponseRule?.staticResponse) {
      return {
        statusCode: staticResponseRule.staticResponse.statusCode,
        headers: staticResponseRule.staticResponse.headers,
        body: staticResponseRule.staticResponse.bodyText,
      };
    }

    const requestMutationRule = matchingRules.find((rule) => rule.request);
    if (!requestMutationRule?.request) {
      return undefined;
    }

    return buildRequestOverride(request, requestMutationRule.request);
  }

  private async handleResponse(response: MutableResponse, request: CompletedRequest) {
    const matchingRules = getMatchingRules([...this.rules.values()], request);
    const responseMutationRule = matchingRules.find((rule) => rule.response);
    const override = buildResponseOverride(
      {
        statusCode: response.statusCode,
        headers: response.headers,
      },
      responseMutationRule?.response,
    );

    const bodyText = await response.body.getText().catch(() => undefined);
    this.events.emit("response", {
      id: response.id,
      statusCode: override?.statusCode ?? response.statusCode,
      headers: override?.headers ?? response.headers,
      rawHeaders: response.rawHeaders,
      bodyText: override?.body ?? bodyText,
      matchedRuleIds: matchingRules.map((rule) => rule.id),
      timestamp: Date.now(),
    });

    return override;
  }
}
