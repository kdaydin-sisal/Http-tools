import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateCACertificate } from "mockttp";

const DEFAULT_CA_DIR = path.join(os.homedir(), ".httptools");
const KEY_FILE = "ca-key.pem";
const CERT_FILE = "ca-cert.pem";

export interface StoredCaCertificate {
  key: string;
  cert: string;
  certPath: string;
}

export const ensureLocalCa = async (): Promise<StoredCaCertificate> => {
  await mkdir(DEFAULT_CA_DIR, { recursive: true });

  const keyPath = path.join(DEFAULT_CA_DIR, KEY_FILE);
  const certPath = path.join(DEFAULT_CA_DIR, CERT_FILE);

  const existing = await Promise.allSettled([access(keyPath), access(certPath)]);
  const bothExist = existing.every((result) => result.status === "fulfilled");

  if (!bothExist) {
    const generated = await generateCACertificate({
      commonName: "HTTP Tools Local CA",
      organizationName: "HTTP Tools",
    });
    await writeFile(keyPath, generated.key, "utf8");
    await writeFile(certPath, generated.cert, "utf8");
  }

  return {
    key: await readFile(keyPath, "utf8"),
    cert: await readFile(certPath, "utf8"),
    certPath,
  };
};
