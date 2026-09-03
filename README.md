# HTTP Tools (Mac-first)

An independent, Mac-first HTTP(S) interception and modification toolkit for
testing iOS/Android apps, emulators, and simulators — a clean-room alternative
to HTTP Toolkit / Proxyman / Requestly (see [docs/architecture.md](docs/architecture.md)
for clean-room boundaries).

## Current status

- Menu-bar (tray) macOS app wrapping a local HTTP(S) intercept proxy
  ([Mockttp](https://github.com/httptoolkit/mockttp)) — no dock icon, starts/stops
  from the tray, auto-manages the macOS system proxy on start/stop/quit.
- Local CA generation/persistence, plus support for importing additional
  **trusted CAs** (e.g. a corporate MITM proxy's root, such as Netskope/Zscaler)
  so our proxy's own outbound TLS connections succeed on corporate networks.
- Request/response matching and mutation rules, editable live from an in-app
  Rules Editor.
- Structured request/response event stream with a Capture Timeline dashboard
  and Server-Sent Events (`/events`) for future UI integration.
- **Android companion app** (`android-companion/`): an on-device, per-app
  `VpnService` tunnel that replaces the legacy "set the device's global proxy"
  workflow — no dangling proxy settings if the Mac disconnects. Pairs with the
  Mac via QR code or mDNS discovery. See
  [docs/android-companion.md](docs/android-companion.md).
- Legacy Android onboarding CLI (ADB discovery, global proxy setup, reverse
  tunnel, cert install intent) — still available for devices/emulators where
  the companion app isn't installed.
- iOS onboarding CLI (simulator cert installation + step-by-step real-device
  setup).
- Minimal control-plane API with SSE event stream, pairing/QR endpoints, and
  trusted-CA management for desktop/companion-app integration.

## Run (menu-bar app)

```bash
npm install
npm run electron:start
```

This launches the tray app, which starts the proxy (default ports 8000/8001,
auto-selecting free ports if busy), points the Mac's system HTTP/HTTPS proxy at
itself, and restores your previous system proxy settings automatically on
stop/quit or crash recovery.

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

Two supported ways to route an Android device/emulator through the proxy:

1. **Companion app (recommended)** — per-app `VpnService` tunnel, pairs via QR
   or mDNS, survives Mac disconnects without leaving the device's networking
   broken. See [docs/android-companion.md](docs/android-companion.md) for
   build/pairing/CA-trust instructions and known limitations.
2. **Legacy CLI onboarding** — sets the device's *global* proxy setting
   directly:
   ```bash
   npm run android:onboard -- <device-serial> <your-mac-ip> 8000
   ```
   Pushes a DER-encoded `.cer` CA file to the device/emulator, force-restarts
   CertInstaller, and opens it via a readable `content://` URI. Because this
   sets a global proxy, if the Mac becomes unreachable (network change, tool
   quit, etc.) the device's networking will break until the proxy setting is
   cleared manually — prefer the companion app to avoid this.

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
companion app's SOCKS5 shim) if the defaults are busy — check the tray menu for
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
