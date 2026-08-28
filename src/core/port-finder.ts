import { createServer } from "node:net";

/**
 * Checks whether a TCP port is free on all interfaces by attempting to bind to it.
 */
const isPortFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const tester = createServer();
    tester.unref();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen({ port, host: "0.0.0.0" });
  });

/**
 * Finds the first available TCP port starting at `preferred`, scanning upward.
 * Used to auto-select the proxy/API ports when the defaults (8000/8001) are busy.
 */
export const findFreePort = async (preferred: number, maxAttempts = 50): Promise<number> => {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = preferred + offset;
    if (candidate > 65535) break;
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(`Could not find a free port starting at ${preferred} after ${maxAttempts} attempts`);
};

/**
 * Finds a free pair of adjacent-ish ports for the proxy and control API, avoiding collisions
 * between the two picks.
 */
export const findFreePortPair = async (
  preferredProxyPort: number,
  preferredApiPort: number,
): Promise<{ proxyPort: number; apiPort: number }> => {
  const proxyPort = await findFreePort(preferredProxyPort);
  let apiCandidate = preferredApiPort;
  if (apiCandidate === proxyPort) apiCandidate += 1;
  const apiPort = await findFreePort(apiCandidate);
  return { proxyPort, apiPort: apiPort === proxyPort ? await findFreePort(apiPort + 1) : apiPort };
};
