import type { CompletedRequest } from "mockttp";
import type {
  HeaderMap,
  RequestMatch,
  RequestMutation,
  ResponseMutation,
  TrafficRule,
} from "./types.js";

const normalizeHeaderName = (value: string) => value.toLowerCase().trim();

const mergeHeaders = (
  base: Record<string, string | string[] | undefined>,
  setHeaders?: HeaderMap,
  removeHeaders?: string[],
) => {
  const merged: Record<string, string | string[] | undefined> = { ...base };

  if (setHeaders) {
    for (const [key, value] of Object.entries(setHeaders)) {
      merged[normalizeHeaderName(key)] = value;
    }
  }

  if (removeHeaders) {
    for (const header of removeHeaders) {
      delete merged[normalizeHeaderName(header)];
    }
  }

  return merged;
};

const matchHeaders = (
  requestHeaders: Record<string, string | string[] | undefined>,
  expectedHeaders?: HeaderMap,
) => {
  if (!expectedHeaders) return true;

  for (const [header, expected] of Object.entries(expectedHeaders)) {
    const actual = requestHeaders[normalizeHeaderName(header)];
    if (Array.isArray(actual)) {
      if (!actual.includes(expected)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }

  return true;
};

export const matchesRequest = (match: RequestMatch, request: CompletedRequest) => {
  const requestUrl = new URL(request.url);

  if (match.methods?.length) {
    const allowed = new Set(match.methods.map((m) => m.toUpperCase()));
    if (!allowed.has(request.method.toUpperCase())) return false;
  }

  if (match.hostname && requestUrl.hostname !== match.hostname) return false;
  if (match.pathStartsWith && !requestUrl.pathname.startsWith(match.pathStartsWith)) return false;
  if (match.urlIncludes && !request.url.includes(match.urlIncludes)) return false;
  if (!matchHeaders(request.headers, match.headerEquals)) return false;

  return true;
};

export const getMatchingRules = (rules: TrafficRule[], request: CompletedRequest) =>
  rules.filter((rule) => rule.enabled && matchesRequest(rule.match, request));

export const buildRequestOverride = (
  request: CompletedRequest,
  mutation?: RequestMutation,
) => {
  if (!mutation) return undefined;

  const headers = mergeHeaders(request.headers, mutation.setHeaders, mutation.removeHeaders);
  return {
    headers,
    body: mutation.replaceBodyText,
  };
};

export const buildResponseOverride = (
  response: {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
  },
  mutation?: ResponseMutation,
) => {
  if (!mutation) return undefined;

  const headers = mergeHeaders(response.headers, mutation.setHeaders, mutation.removeHeaders);
  return {
    headers,
    statusCode: mutation.setStatusCode ?? response.statusCode,
    body: mutation.replaceBodyText,
  };
};
