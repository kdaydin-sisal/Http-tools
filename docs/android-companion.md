# Android companion app

The companion app (`android-companion/`) is an on-device `VpnService`-based tunnel
that replaces the "set the device's global HTTP proxy" workflow. It exists to solve
one specific problem: when a device's global proxy points at the Mac and the device
is unplugged/roams/reconnects to a different network, the proxy setting is left
dangling and breaks the device's networking until manually cleared. The companion
app is fully self-contained — the tunnel is only ever started or stopped from an
explicit on-device switch, so a Mac-side disconnect can never leave the device in a
broken state.

## What it does

- Presents a per-app picker so only the app(s) you're testing are routed through the
  tunnel — every other app on the device keeps using its normal network path.
- Routes selected apps' traffic through a local SOCKS5 endpoint on the Mac
  (`src/core/socks5-shim.ts`), which bridges to Mockttp's plain HTTP forward-proxy
  protocol. From Mockttp's point of view this traffic is indistinguishable from any
  other proxied request — it shows up identically in the Capture Timeline, Rules
  Editor, and Diagnostics views.
- Surfaces CA-certificate trust status on-device and offers a guided system
  cert-install flow (`KeyChain.createInstallIntent()`), so you don't need to dig
  through Android Settings to trust the Mac's local CA before HTTPS interception
  will work.
- The tunnel on/off switch reflects the VPN's actual native running state
  (`TProxyService.TProxyIsRunning()`), not just local optimistic UI state, so it
  can't desync from reality if the service was stopped some other way.

## Architecture

```
Android app (selected)
   -> VpnService (per-app, Android's UID-based app include-list)
   -> hev-socks5-tunnel (native, userspace TUN-to-SOCKS5 relay)
   -> SOCKS5 shim on the Mac (src/core/socks5-shim.ts)
   -> Mockttp forward-proxy port (src/core/proxy-service.ts)
   -> real upstream server
```

Only apps you explicitly select in the in-app picker are included in the VPN's
per-app UID list; everything else on the device bypasses the tunnel entirely and
keeps its normal default-route networking.

## Build & install

Requires Android Studio or the command-line Android SDK (API 35, min SDK 26).

```bash
cd android-companion
./gradlew assembleDebug
# APK output: app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

There is no release/signed build yet — sideload the debug APK directly (enable
"Install unknown apps" for whichever source you use, e.g. Files app or `adb install`).

## Pairing flow

1. On the Mac, open the dashboard's onboarding page (`http://localhost:8001/onboarding`)
   and start the proxy — it displays a pairing QR code containing the Mac's LAN IP,
   API port, SOCKS5 port, and a short-lived pairing token
   (see `GET /api/pairing/qr` in `src/control-plane/api-server.ts`).
2. On the Android device, open the companion app and grant camera permission when
   prompted — QR scanning (CameraX + ML Kit) is the primary pairing method.
3. If camera permission is denied or no camera is available, the app falls back to
   an mDNS/NSD device-discovery list — pick the Mac from the list instead of
   scanning.
4. Once paired, the pairing info (host/port/token) is stored on-device
   (`PairingStore`) so you don't need to re-scan on every launch, only when
   re-pairing to a different Mac.

## Selecting which app(s) to intercept

From the Status screen, tap "Choose apps to intercept" to open the app picker, which lists
installed apps with their package names (distinguishing, for example,
`com.example.app` from `com.example.app.debug`/`.test` variants that would
otherwise show identical display names). Selections persist across app restarts
(`SelectedAppsStore`) and are applied the next time the tunnel is started.

## Trusting the CA certificate

HTTPS interception requires the device to trust the Mac's local CA:

1. On the Status screen, if the cert isn't yet trusted you'll see "⚠️ CA
   certificate not yet trusted" with an "Install Certificate" button.
2. Tapping it launches Android's system certificate-install flow with the cert
   bytes fetched live from the Mac (`GET /certs/ca.cer` on the API port) — no
   manual file transfer needed.
3. Follow the system prompts to install it as a user-trusted CA. Android has no
   callback for returning from this flow, so use the "Recheck trust status"
   button on the Status screen afterward to refresh the on-screen status.
4. Apps with certificate pinning (e.g. release/production builds with pinned
   pins) will still reject the Mac's re-signed certificate even after this step —
   test against debug/staging builds without pinning where possible.

## Corporate MITM proxies (Netskope, Zscaler, etc.)

If your network has a transparent TLS-intercepting corporate proxy, Mockttp's own
*outbound* connections to upstream servers will fail unless that proxy's root CA is
also trusted by the Mac-side proxy process. Import it via the dashboard's
Onboarding page ("Trusted CAs" section) or `POST /api/trusted-cas` — this only
affects our own proxy process's in-memory trust store and is fully reversible; it
does not touch the macOS Keychain or any other app's configuration.

## Known limitations

- No signed/release APK yet (debug build only).
- TLS pinning bypass is out of scope (see `docs/architecture.md` non-goals).
- If your network's loopback traffic is transparently intercepted by endpoint
  security software (observed with Netskope), make sure any local test tooling
  connects via IPv6 loopback (`::1`) rather than `127.0.0.1` when talking to the
  Mac's proxy ports directly — the companion app's own shim already does this
  correctly, this only matters if you're scripting your own test clients.
