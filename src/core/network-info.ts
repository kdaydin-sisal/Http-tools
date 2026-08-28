import os from "node:os";

/**
 * Returns the Mac's LAN IPv4 address (first non-internal interface), used both
 * for device-manager proxy configuration and for companion-app pairing payloads
 * (QR code / mDNS advertisement) so the phone knows where to connect.
 */
export const getMacIp = (): string => {
  const interfaces = os.networkInterfaces();
  for (const ifaces of Object.values(interfaces)) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
};
