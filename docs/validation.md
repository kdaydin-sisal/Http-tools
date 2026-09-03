# Validation checklist (macOS)

## Deterministic smoke checks (headless CLI)
1. Start proxy and API:
   - `npm run build`
   - `npm run validate:smoke`
   - `npm start -- examples/rules.sample.json`
2. Verify control plane:
   - `curl http://127.0.0.1:8001/health`
   - `curl http://127.0.0.1:8001/rules`
3. Verify proxy capture:
   - `curl -x http://127.0.0.1:8000 http://example.com`
   - Confirm request/response events in dashboard at `http://127.0.0.1:8001/`.

## Menu-bar (Electron) app checks
1. `npm run electron:start`.
2. Confirm a tray icon appears with no dock icon, and the tray menu shows
   Start/Stop, dashboard/rules/onboarding links, and current ports.
3. Start the proxy from the tray and confirm the Mac's system HTTP/HTTPS
   proxy (System Settings > Network > Wi-Fi > Details > Proxies, or
   `networksetup -getwebproxy Wi-Fi`) now points at `127.0.0.1:<proxy-port>`.
4. Stop the proxy (or quit the app) and confirm the system proxy setting is
   fully restored/disabled again — **this is a common source of "my other
   apps lost internet" reports if the tool is killed abruptly instead of quit
   cleanly; always prefer Stop/Quit from the tray, and if a process is killed
   directly, manually verify with `networksetup -getwebproxy Wi-Fi` /
   `-getsecurewebproxy Wi-Fi` afterward.**

## Android flow checks

### Companion app (recommended)
1. `adb devices -l` lists target device.
2. Build & install: `cd android-companion && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk`.
3. On the Mac, open `http://localhost:8001/onboarding`, confirm the pairing QR
   renders.
4. On-device: scan the QR (or use mDNS discovery fallback), select app(s) to
   intercept, trust the CA cert via the guided install flow if not already
   trusted, then flip the tunnel switch on.
5. Confirm:
   - Status screen shows the tunnel as actively running.
   - Selected app's traffic appears in the dashboard (`GET /captures` or
     `http://localhost:8001/`).
   - Turning the tunnel off (or force-stopping the app) leaves the device's
     normal networking completely unaffected — no dangling proxy setting.

See [android-companion.md](android-companion.md) for detailed pairing/CA-trust
steps and known limitations (single-active-VPN constraint, TLS pinning, etc.).

### Legacy global-proxy onboarding
1. `adb devices -l` lists target device.
2. Run onboarding:
   - `npm run android:onboard -- <serial> <mac-ip> 8000`
3. Confirm:
   - proxy configured on device
   - certificate install prompt shown
   - traffic appears in dashboard.
4. **Cleanup reminder**: this sets the device's *global* HTTP proxy setting.
   If you stop the Mac tool without reversing it, the device will lose network
   connectivity until the proxy is cleared manually
   (`adb shell settings put global http_proxy :0`). Prefer the companion app
   above to avoid this failure mode entirely.

## iOS flow checks
### Simulator
1. `npm run ios:onboard -- simulator <mac-ip> 8000 [sim-udid]`
2. Confirm:
   - cert added to simulator keychain
   - manual proxy set in simulator Wi-Fi settings
   - traffic appears in dashboard.

### Real device
1. `npm run ios:onboard -- real-device <mac-ip> 8000`
2. Follow printed steps for proxy + cert trust.
3. Confirm traffic appears in dashboard.

## Trusted CA (corporate MITM proxy) checks
1. Import a corporate root CA (e.g. Netskope/Zscaler) via the onboarding
   page's "Trusted CAs" section or `POST /api/trusted-cas`.
2. Confirm `GET /api/trusted-cas` lists it.
3. With the device/emulator still routed through our proxy on a network where
   that corporate proxy is active, confirm outbound HTTPS requests through
   our proxy succeed instead of failing with a TLS trust error.

## Unsupported traffic diagnostics
- Query `GET /diagnostics/unsupported-traffic`.
- If `tlsFailures` are present, inspect:
  - certificate trust state
  - TLS pinning in app
  - non-HTTP protocol usage.
