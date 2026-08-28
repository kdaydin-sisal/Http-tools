import { app, Menu, Tray, shell, nativeImage, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startAppRuntime, type AppRuntimeHandle } from "../src/core/app-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Electron menu-bar (tray) shell around the HTTP Tools proxy.
 *
 * Responsibilities beyond the plain CLI (src/index.ts):
 *  - Runs as a background/menu-bar app (no dock icon, LSUIElement-style behaviour).
 *  - Auto-selects free ports if 8000/8001 are busy.
 *  - Automatically points the macOS system HTTP/HTTPS proxy at this tool on start,
 *    and restores the previous system proxy settings on stop/quit/crash-recovery.
 *  - Provides a right-click tray menu: Start/Stop, open dashboard/rules/onboarding,
 *    show current ports, Quit.
 *  - Guarantees cleanup (system proxy reset + child process termination) on quit,
 *    including unexpected termination signals.
 */

app.dock?.hide();

let tray: Tray | null = null;
let runtime: AppRuntimeHandle | null = null;
let starting = false;

const buildTrayIcon = () => {
  const iconPath = path.join(__dirname, "assets", "tray-icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  return icon;
};

const trayTitle = () => {
  if (starting) return " ⋯";
  return runtime ? " ●" : " ○";
};

const openUrl = (path: string) => {
  if (!runtime) return;
  shell.openExternal(`http://127.0.0.1:${runtime.apiPort}${path}`);
};

const startProxy = async () => {
  if (runtime || starting) return;
  starting = true;
  updateTray();
  try {
    runtime = await startAppRuntime({
      onError: (error) => {
        console.error("[proxy-error]", error);
      },
    });
  } catch (error) {
    dialog.showErrorBox("HTTP Tools", `Failed to start proxy: ${(error as Error).message}`);
  } finally {
    starting = false;
    updateTray();
  }
};

const stopProxy = async () => {
  if (!runtime) return;
  const handle = runtime;
  runtime = null;
  updateTray();
  await handle.stop();
};

const updateTray = () => {
  if (!tray) return;
  tray.setTitle(trayTitle());

  const statusLabel = runtime
    ? `Listening — proxy :${runtime.proxyPort}, dashboard :${runtime.apiPort}`
    : starting
      ? "Starting…"
      : "Stopped";

  const systemProxyLabel = runtime
    ? runtime.systemProxyManaged
      ? `System proxy set on "${runtime.networkServiceName}"`
      : "System proxy not managed (no active network service found)"
    : null;

  const menu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    ...(systemProxyLabel ? [{ label: systemProxyLabel, enabled: false }] : []),
    { type: "separator" },
    {
      label: "Start Listening",
      enabled: !runtime && !starting,
      click: () => void startProxy(),
    },
    {
      label: "Stop Listening",
      enabled: !!runtime,
      click: () => void stopProxy(),
    },
    { type: "separator" },
    {
      label: "Open Dashboard",
      enabled: !!runtime,
      click: () => openUrl("/"),
    },
    {
      label: "Open Rules Editor",
      enabled: !!runtime,
      click: () => openUrl("/rules-editor"),
    },
    {
      label: "Open Onboarding",
      enabled: !!runtime,
      click: () => openUrl("/onboarding"),
    },
    { type: "separator" },
    {
      label: "Quit HTTP Tools",
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(runtime ? `HTTP Tools — proxy :${runtime.proxyPort}` : "HTTP Tools — stopped");
};

app.whenReady().then(async () => {
  tray = new Tray(buildTrayIcon());
  updateTray();
  await startProxy();
});

let quitting = false;
const cleanupAndQuit = async () => {
  if (quitting) return;
  quitting = true;
  try {
    await stopProxy();
  } finally {
    app.exit(0);
  }
};

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  void cleanupAndQuit();
});

app.on("window-all-closed", () => {
  // Menu-bar app: no windows to keep open for; do nothing (stay resident).
});

process.on("SIGINT", () => void cleanupAndQuit());
process.on("SIGTERM", () => void cleanupAndQuit());
