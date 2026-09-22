# HTTP Tools (Mac-first)

An independent, Mac-first HTTP(S) interception and modification toolkit for
testing iOS/Android apps, emulators, and simulators — a clean-room alternative
to HTTP Toolkit / Proxyman / Requestly (see [docs/architecture.md](docs/architecture.md)
for clean-room boundaries).

## Current status

- Regular foreground macOS app (visible Dock icon, appears in Cmd+Tab)
  wrapping a local HTTP(S) intercept proxy
  ([Mockttp](https://github.com/httptoolkit/mockttp)) — opens its main window
  automatically on launch, auto-manages the macOS system proxy on
  start/stop/quit, and also offers a menu-bar (tray) icon as a convenience for
  quick Start/Stop/Quit without switching windows.
- Local CA generation/persistence, plus support for importing additional
  **trusted CAs** (e.g. a corporate MITM proxy's root, such as Netskope/Zscaler)
  so our proxy's own outbound TLS connections succeed on corporate networks.
- Request/response matching and mutation rules, editable live from an in-app
  Rules Editor.
- Structured request/response event stream with a Capture Timeline dashboard
  and Server-Sent Events (`/events`) for future UI integration.
- **Per-app capture attribution (Android)**: when using the companion app's
  VPN with multiple apps selected at once, every capture is tagged with the
  exact app that made it (an `App` column, a filter dropdown with live counts,
  and a "Source App" field in capture detail) — resolved per-TCP-connection on
  the device itself (via `ConnectivityManager.getConnectionOwnerUid()`, Android
  10+), not just per VPN session. See
  [docs/android-companion.md](docs/android-companion.md#per-app-capture-attribution).
- **Android companion app** (`android-companion/`): an on-device, per-app
  `VpnService` tunnel that replaces the legacy "set the device's global proxy"
  workflow — no dangling proxy settings if the Mac disconnects. Clicking
  **Listen** on a device in the onboarding page's device list installs/updates
  it automatically (fetched from this repo's GitHub Releases, ADB push, no
  Play Store needed — same idea as HTTP Toolkit's own Android delivery) and
  launches it; pairing then happens via QR code or mDNS discovery. See
  [docs/android-companion.md](docs/android-companion.md).
- Legacy "Advanced" global-proxy mode for Android — an explicit, always
  reconfirmed opt-in on the device list for cases where the companion app's
  VPN can't be used (e.g. another VPN app already active); a standalone CLI
  version of the same flow is also available for scripting. See
  [docs/android-companion.md](docs/android-companion.md#advanced-mode-legacy-system-wide-proxy-rarely-needed).
- iOS onboarding CLI (simulator cert installation + step-by-step real-device
  setup).
- Minimal control-plane API with SSE event stream, pairing/QR endpoints, and
  trusted-CA management for desktop/companion-app integration.

## Run (desktop app)

```bash
npm install
npm run electron:start
```

This launches the app with a visible Dock icon and main window, starts the
proxy (default ports 8000/8001, auto-selecting free ports if busy), points the
Mac's system HTTP/HTTPS proxy at itself, and restores your previous system
proxy settings automatically on stop/quit or crash recovery. Closing the main
window keeps the app running in the background (standard macOS app
behaviour) — use Quit from the Dock/tray menu or Cmd+Q to fully exit.

To package a distributable build:

```bash
npm run electron:package
```

See [docs/macos-packaging.md](docs/macos-packaging.md) for signing/notarization
status.

## Run (headless CLI, for development/scripting)

```bash
npm install
npm run build
npm start -- examples/rules.sample.json
npm run validate:smoke
```

Note: the CLI does **not** manage the macOS system proxy for you — use the
Electron app for that, or configure the proxy manually if you need the CLI
path.

## Android

The onboarding page's device list (`http://localhost:8001/onboarding`) is the
primary way to connect an Android device or emulator:

1. **Listen** — installs/updates and launches the companion app automatically
   (no Play Store, no manual APK transfer), then pair it with the Mac via QR
   code or mDNS. Per-app `VpnService` tunnel; surviving a Mac disconnect never
   leaves the device's networking broken. See
   [docs/android-companion.md](docs/android-companion.md).
2. **⚠ Advanced** — sets the device's *global* proxy setting directly via ADB,
   for cases where the companion app's VPN can't be used (most commonly:
   another VPN app already holds the device's one available `VpnService`
   slot). Always shows a fresh warning before doing anything — every app on
   the device is routed through the proxy, not just the one you're testing,
   and an unclean Mac shutdown can leave the device unable to reach the
   network until the proxy is cleared manually. Details:
   [docs/android-companion.md](docs/android-companion.md#advanced-mode-legacy-system-wide-proxy-rarely-needed).

The same Advanced-mode logic is also available as a standalone CLI, useful for
scripting or CI:

```bash
npm run android:onboard -- <device-serial> <your-mac-ip> 8000
```

Pushes a DER-encoded `.cer` CA file to the device/emulator, force-restarts
CertInstaller, and opens it via a readable `content://` URI.

## iOS

```bash
npm run ios:onboard -- simulator <your-mac-ip> 8000 [simulator-udid]
npm run ios:onboard -- real-device <your-mac-ip> 8000
```

There is no iOS companion-app equivalent yet — see
[docs/validation.md](docs/validation.md) for the manual proxy + cert trust
steps required on real devices.

## Optional env vars (headless CLI)

- `HTTP_TOOLS_PROXY_PORT` (default: `8000`)
- `HTTP_TOOLS_API_PORT` (default: `8001`)

The Electron app auto-selects free ports (including a third port for the
companion app's SOCKS5 shim) if the defaults are busy — check the tray menu or
main window for
the ports actually in use.

## Notes

- v1 supports HTTP/HTTPS interception where devices trust the generated CA.
- TLS pinning bypass is intentionally out of scope for this phase (see
  [docs/architecture.md](docs/architecture.md)).

## Control API (for UI/companion-app integration)

- `GET /` — capture timeline dashboard
- `GET /rules-editor` — in-app rules editor
- `GET /onboarding` — pairing QR + trusted-CA management page
- `GET /health`
- `GET /rules` / `PUT /rules` (JSON array of rule objects)
- `GET /captures` (recent request/response events) / `POST /captures/clear`
- `GET /events` — Server-Sent Events stream (`request`/`response`/`tls-failure`)
- `GET /diagnostics/unsupported-traffic` (recent TLS handshake failures + guidance)
- `GET /certs/ca.cer` — fetch the local CA cert bytes (used by the companion app's
  install flow)
- `GET /api/devices` / `GET /api/devices/sessions` — connected device/session info
- `GET /api/pairing/qr` — pairing QR payload (Mac IP, ports, short-lived token)
  for the companion app
- `GET /api/trusted-cas` / `POST /api/trusted-cas` — manage additional trusted
  CAs (e.g. corporate MITM proxy roots) for the proxy's own outbound connections

See more in [docs/architecture.md](docs/architecture.md),
[docs/android-companion.md](docs/android-companion.md), and
[docs/validation.md](docs/validation.md).
