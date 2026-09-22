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

## Desktop app checks
1. `npm run electron:start`.
2. Confirm the app appears in the Dock (with a Dock icon) and in Cmd+Tab, and
   that its main window opens automatically on launch. A tray icon should
   also appear with a right-click menu (Start/Stop, dashboard/rules/onboarding
   links, current ports, Quit).
3. Start the proxy from the tray and confirm the Mac's system HTTP/HTTPS
   proxy (System Settings > Network > Wi-Fi > Details > Proxies, or
   `networksetup -getwebproxy Wi-Fi`) now points at `127.0.0.1:<proxy-port>`.
4. Stop the proxy (or quit the app) and confirm the system proxy setting is
   fully restored/disabled again — **this is a common source of "my other
   apps lost internet" reports if the tool is killed abruptly instead of quit
   cleanly; always prefer Stop/Quit from the tray or Dock, and if a process is
   killed directly, manually verify with `networksetup -getwebproxy Wi-Fi` /
   `-getsecurewebproxy Wi-Fi` afterward.**

## Android flow checks

### Companion app (recommended: click Listen)
1. `adb devices -l` lists target device.
2. On the Mac, open `http://localhost:8001/onboarding`; the device should
   appear in "Available Devices".
3. Click **Listen**. Confirm the resulting message reports one of
   installed/updated/already-current, and that the companion app opens on the
   device automatically. (For a from-source build/manual install instead:
   `cd android-companion && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk`.)
4. Confirm the pairing QR on the onboarding page renders.
5. On-device: scan the QR (or use mDNS discovery fallback), select app(s) to
   intercept, trust the CA cert via the guided install flow if not already
   trusted, then flip the tunnel switch on.
6. Confirm:
   - Status screen shows the tunnel as actively running.
   - Selected app's traffic appears in the dashboard (`GET /captures` or
     `http://localhost:8001/`).
   - Turning the tunnel off (or force-stopping the app) leaves the device's
     normal networking completely unaffected — no dangling proxy setting.
   - Note: the device card's "Listening" badge does **not** reflect this —
     it only tracks the Advanced/legacy proxy path (below). Use the
     companion app's own Status screen as the source of truth here.

See [android-companion.md](android-companion.md) for detailed pairing/CA-trust
steps and known limitations (single-active-VPN constraint, TLS pinning, etc.).

### Advanced/legacy global-proxy mode
1. `adb devices -l` lists target device.
2. On the onboarding page, click **⚠ Advanced** on the device card — confirm a
   warning dialog appears explaining the system-wide-proxy risk, and that
   nothing happens on-device until you accept it. Cancelling must be a no-op
   (re-check with `adb shell dumpsys` that no proxy was set).
3. Accept the dialog. Confirm:
   - proxy configured on device
   - certificate pushed for manual install
   - traffic appears in dashboard.
   For scripted/CLI use instead of the UI: `npm run android:onboard -- <serial> <mac-ip> 8000`.
4. **Cleanup reminder**: this sets the device's *global* HTTP proxy setting.
   If you stop the Mac tool without reversing it, the device will lose network
   connectivity until the proxy is cleared manually
   (`adb shell settings put global http_proxy :0`). Prefer Listen/the
   companion app above to avoid this failure mode entirely.

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
