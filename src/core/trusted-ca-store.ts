import { X509Certificate, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DEFAULT_CA_DIR = path.join(os.homedir(), ".httptools", "trusted-cas");

export interface TrustedCaRecord {
  id: string;
  /** Human-friendly name, derived from the cert's CN or an uploaded filename. */
  name: string;
  subject: string;
  issuer: string;
  /** ISO date string; undefined if unavailable/unparseable. */
  validTo?: string;
  addedAt: string;
}

/**
 * Manages additional CA certificates the user has explicitly chosen to trust for the
 * proxy's own *upstream* (outbound) connections — e.g. a corporate transparent TLS-inspecting
 * proxy/firewall (Netskope, Zscaler, etc.) that re-signs traffic with its own CA before it
 * ever reaches the real destination. Without trusting that CA here, Mockttp's own outbound
 * fetch to the "real" server fails/hangs, even though our CA is correctly trusted by the
 * client device for the *inbound* (client-facing) side of the interception.
 *
 * This is conceptually the same feature HTTP Toolkit exposes as trusting extra CAs for
 * passthrough connections, just persisted locally so it survives app restarts.
 */
export class TrustedCaStore {
  private records: TrustedCaRecord[] = [];
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await mkdir(DEFAULT_CA_DIR, { recursive: true });
    const files = await readdir(DEFAULT_CA_DIR).catch(() => [] as string[]);
    const records: TrustedCaRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const meta = JSON.parse(await readFile(path.join(DEFAULT_CA_DIR, file), "utf8"));
        records.push(meta);
      } catch {
        // Skip corrupt metadata rather than failing startup.
      }
    }
    records.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    this.records = records;
    this.loaded = true;
  }

  async list(): Promise<TrustedCaRecord[]> {
    await this.ensureLoaded();
    return [...this.records];
  }

  /** Returns the PEM bodies of all currently-trusted additional CAs, for Mockttp's `additionalTrustedCAs`. */
  async getAllPems(): Promise<string[]> {
    await this.ensureLoaded();
    const pems: string[] = [];
    for (const record of this.records) {
      const pem = await readFile(path.join(DEFAULT_CA_DIR, `${record.id}.pem`), "utf8").catch(() => undefined);
      if (pem) pems.push(pem);
    }
    return pems;
  }

  /**
   * Accepts either PEM or raw DER bytes (auto-detected) and stores it as a trusted CA.
   * `suggestedName` is used as a fallback display name if the cert has no usable CN.
   */
  async add(rawBytes: Buffer, suggestedName?: string): Promise<TrustedCaRecord> {
    await this.ensureLoaded();

    const isPem = rawBytes.toString("utf8", 0, Math.min(rawBytes.length, 27)).includes("-----BEGIN");
    const pem = isPem ? rawBytes.toString("utf8") : derToPem(rawBytes);

    let subject = "Unknown";
    let issuer = "Unknown";
    let validTo: string | undefined;
    try {
      const cert = new X509Certificate(pem);
      subject = cert.subject;
      issuer = cert.issuer;
      validTo = cert.validTo;
    } catch (error) {
      throw new Error(`Not a valid X.509 certificate: ${error instanceof Error ? error.message : String(error)}`);
    }

    const cn = /CN=([^\n,]+)/.exec(subject)?.[1]?.trim();
    const id = randomUUID();
    const record: TrustedCaRecord = {
      id,
      name: cn || suggestedName || "Custom CA",
      subject,
      issuer,
      validTo,
      addedAt: new Date().toISOString(),
    };

    await writeFile(path.join(DEFAULT_CA_DIR, `${id}.pem`), pem, "utf8");
    await writeFile(path.join(DEFAULT_CA_DIR, `${id}.json`), JSON.stringify(record, null, 2), "utf8");

    this.records.push(record);
    return record;
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const index = this.records.findIndex((record) => record.id === id);
    if (index === -1) return false;
    this.records.splice(index, 1);
    await Promise.allSettled([
      rm(path.join(DEFAULT_CA_DIR, `${id}.pem`), { force: true }),
      rm(path.join(DEFAULT_CA_DIR, `${id}.json`), { force: true }),
    ]);
    return true;
  }
}

const derToPem = (der: Buffer): string => {
  const base64 = der.toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
};
