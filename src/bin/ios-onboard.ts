import { ensureLocalCa } from "../core/ca-store.js";
import { IosAdapter } from "../adapters/ios/ios-adapter.js";

type Mode = "simulator" | "real-device";

const parseArgs = () => {
  const [, , modeArg, hostArg, portArg, maybeUdid] = process.argv;
  if (!modeArg || !hostArg || !portArg) {
    throw new Error("Usage: npm run ios:onboard -- <simulator|real-device> <proxy-host> <proxy-port> [simulator-udid]");
  }
  if (modeArg !== "simulator" && modeArg !== "real-device") {
    throw new Error(`Invalid mode: ${modeArg}`);
  }

  const port = Number.parseInt(portArg, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid proxy port: ${portArg}`);
  }

  return {
    mode: modeArg as Mode,
    host: hostArg,
    port,
    udid: maybeUdid,
  };
};

const printPlan = (steps: string[]) => {
  steps.forEach((step, index) => {
    console.log(`${index + 1}. ${step}`);
  });
};

const run = async () => {
  const args = parseArgs();
  const adapter = new IosAdapter();
  const ca = await ensureLocalCa();

  if (args.mode === "real-device") {
    const plan = adapter.buildRealDeviceOnboardingPlan(args.host, args.port, ca.certPath);
    printPlan(plan.steps);
    return;
  }

  await adapter.ensureXcodeToolsAvailable();

  const simulators = await adapter.listAvailableSimulators();
  const chosenSimulator = args.udid
    ? simulators.find((sim) => sim.udid === args.udid)
    : simulators.find((sim) => sim.state === "Booted");

  if (!chosenSimulator) {
    console.log("Available simulators:");
    simulators.forEach((sim) => {
      console.log(`- ${sim.name} (${sim.udid}) [${sim.state}]`);
    });
    throw new Error("No simulator selected. Pass simulator UDID or boot one first.");
  }

  if (chosenSimulator.state !== "Booted") {
    await adapter.bootSimulator(chosenSimulator.udid);
  }
  await adapter.installCaCertificateOnSimulator(chosenSimulator.udid, ca.certPath);

  const plan = adapter.buildSimulatorOnboardingPlan(args.host, args.port, ca.certPath);
  console.log(`Simulator: ${chosenSimulator.name} (${chosenSimulator.udid})`);
  printPlan(plan.steps);

  const probeOk = await adapter.probeSimulatorProxy(chosenSimulator.udid, args.host, args.port);
  console.log(`Proxy probe via simulator curl: ${probeOk ? "ok" : "failed (manual verification required)"}`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
