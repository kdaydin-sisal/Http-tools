import { randomBytes } from "node:crypto";
import Bonjour, { type Service } from "bonjour-service";
import { getMacIp } from "./network-info.js";

export interface PairingPayload {
  host: string;
  port: number;
  /** Port of the SOCKS5 shim in front of Mockttp — this is what the companion app's VPN tunnel connects to. */
  socksPort: number;
  token: string;
  expiresAt: number;
}

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes — short-lived, re-issued per QR/mDNS render
const SERVICE_TYPE = "httptools";

/**
 * Issues short-lived pairing tokens for the Android companion app and advertises
 * the control-plane's mDNS/Bonjour service (`_httptools._tcp`) carrying the same
 * token in a TXT record, so the companion app can pair either by scanning the
 * onboarding page's QR code or via on-device network auto-discovery — both are
 * equally secure since both convey a token from this same source.
 */
export class PairingService {
  private currentToken: string | null = null;
  private expiresAt = 0;
  private bonjour: Bonjour | null = null;
  private publishedService: Service | null = null;

  constructor(
    private readonly apiPort: number,
    private readonly socksPort: number,
  ) {}

  /** Issues (or reuses, if still valid) a pairing token and republishes mDNS with it. */
  issuePayload(): PairingPayload {
    if (!this.currentToken || Date.now() > this.expiresAt) {
      this.currentToken = randomBytes(16).toString("hex");
      this.expiresAt = Date.now() + TOKEN_TTL_MS;
      this.republishMdns();
    }
    return {
      host: getMacIp(),
      port: this.apiPort,
      socksPort: this.socksPort,
      token: this.currentToken,
      expiresAt: this.expiresAt,
    };
  }

  /** Validates a token presented by a companion app connecting to the pairing-gated endpoints. */
  isValidToken(token: string): boolean {
    return token === this.currentToken && Date.now() <= this.expiresAt;
  }

  stop(): void {
    this.publishedService?.stop();
    this.publishedService = null;
    this.bonjour?.destroy();
    this.bonjour = null;
  }

  private republishMdns(): void {
    this.publishedService?.stop();
    if (!this.bonjour) {
      this.bonjour = new Bonjour();
    }
    this.publishedService = this.bonjour.publish({
      name: "HTTP Tools",
      type: SERVICE_TYPE,
      port: this.apiPort,
      txt: { token: this.currentToken ?? "", socksPort: String(this.socksPort) },
    });
  }
}
