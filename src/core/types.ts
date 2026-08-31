export type HeaderMap = Record<string, string>;

export interface RequestMatch {
  methods?: string[];
  hostname?: string;
  pathStartsWith?: string;
  urlIncludes?: string;
  headerEquals?: HeaderMap;
}

export interface RequestMutation {
  setHeaders?: HeaderMap;
  removeHeaders?: string[];
  replaceBodyText?: string;
}

export interface StaticResponse {
  statusCode: number;
  bodyText?: string;
  headers?: HeaderMap;
}

export interface ResponseMutation {
  setHeaders?: HeaderMap;
  removeHeaders?: string[];
  replaceBodyText?: string;
  setStatusCode?: number;
}

export interface TrafficRule {
  id: string;
  enabled: boolean;
  match: RequestMatch;
  request?: RequestMutation;
  response?: ResponseMutation;
  staticResponse?: StaticResponse;
}

export interface RequestEvent {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: Array<[string, string]>;
  matchedRuleIds: string[];
  bodyText?: string;
  timestamp: number;
}

export interface ResponseEvent {
  id: string;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: Array<[string, string]>;
  matchedRuleIds: string[];
  bodyText?: string;
  timestamp: number;
}

export interface TlsFailureEvent {
  failureCause: string;
  hostname?: string;
  remoteIpAddress?: string;
  remotePort?: number;
  timestamp: number;
}

export interface ProxyStartOptions {
  port: number;
  caKeyPem: string;
  caCertPem: string;
  /**
   * PEM-encoded CA certificates to additionally trust for the proxy's own outbound
   * (upstream) connections — needed when the network runs a transparent TLS-inspecting
   * proxy (e.g. Netskope, Zscaler) that re-signs traffic with its own CA.
   */
  additionalTrustedCAs?: string[];
}
