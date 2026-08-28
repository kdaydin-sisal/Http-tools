import { ensureLocalCa } from "../core/ca-store.js";
import { AndroidAdapter } from "../adapters/android/android-adapter.js";

const parseArgs = () => {
  const [, , serialArg, hostArg, portArg] = process.argv;
  if (!serialArg || !hostArg || !portArg) {
    throw new Error("Usage: npm run android:onboard -- <serial> <proxy-host> <proxy-port>");
  }

  const port = Number.parseInt(portArg, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid proxy port: ${portArg}`);
  }

  return {
    serial: serialArg,
    host: hostArg,
    port,
  };
};

const run = async () => {
  const { serial, host, port } = parseArgs();
  const adapter = new AndroidAdapter();
  await adapter.ensureAdbAvailable();

  const connectedDevices = await adapter.listDevices();
  const target = connectedDevices.find((device) => device.serial === serial);
  if (!target) {
    throw new Error(`Device not found: ${serial}`);
  }
  if (target.state !== "device") {
    throw new Error(`Device ${serial} is not ready (state=${target.state})`);
  }

  const health = await adapter.getDeviceHealth(serial);
  console.log(`Device: ${serial} (${target.model ?? "unknown model"})`);
  console.log(`Health: canSetGlobalProxy=${health.canSetGlobalProxy}, hasAdbRoot=${health.hasAdbRoot}`);
  if (health.notes.length > 0) {
    for (const note of health.notes) console.log(`- ${note}`);
  }

  await adapter.setGlobalHttpProxy(serial, { host, port });
  await adapter.createReverseTunnel(serial, port, port);
  console.log(`Proxy configured to ${host}:${port}`);

  const ca = await ensureLocalCa();
  const trustResult = await adapter.prepareCertificateInstall(serial, ca.cert);
  console.log(`Certificate pushed to ${trustResult.certPushedPath}`);
  console.log("Install the certificate manually in Android Settings. If the HTTP Tools CA is already trusted on this device, you can skip that step.");
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
