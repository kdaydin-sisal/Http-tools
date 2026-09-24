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

/**
 * Identifies which app on which device made a captured request. Only
 * populated for Android traffic captured through the companion app's VPN
 * tunnel, on TCP connections, on Android 10+ (API 29, required by
 * `ConnectionManager.getConnectionOwnerUid`) — iOS and Android's Advanced
 * (global system-proxy) mode have no per-app scoping mechanism at the OS
 * level, so their captures are left untagged rather than guessed at.
 */
export interface AppIdentity {
  /** Stable per-install identifier for the physical device/emulator, not the app. */
  deviceId: string;
  /** The Android package id (e.g. "tr.sisal.millipiyango") that owns the connection. */
  packageId: string;
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
  sourceApp?: AppIdentity;
}

export interface ResponseEvent {
  id: string;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: Array<[string, string]>;
  matchedRuleIds: string[];
  bodyText?: string;
  timestamp: number;
  sourceApp?: AppIdentity;
}

export interface TlsFailureEvent {
  id: string;
  failureCause: string;
  hostname?: string;
  remoteIpAddress?: string;
  remotePort?: number;
  timestamp: number;
  sourceApp?: AppIdentity;
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
