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

## Installing on a device: click "Listen"

There is no Play Store listing or website for this app (it's a personal/internal
tool), so the desktop app delivers it the same way HTTP Toolkit does: over ADB.

Clicking **Listen** on an Android device in the "Available Devices" list
(`http://localhost:8001/onboarding`) now does all of this automatically:

1. Checks the device's currently-installed companion app version via
   `adb shell dumpsys package com.httptools.companion` (if any).
2. Resolves the latest companion APK — first from this repo's GitHub Releases
   (asset `http-tools-companion.apk`, see "Publishing a companion release"
   below), falling back to a locally-built dev APK
   (`android-companion/app/build/outputs/apk/{debug,release}/...`) if GitHub is
   unreachable or no release exists yet, and falling back further to a cached
   copy from a previous successful download (`~/.httptools/companion-apk/`).
3. Compares `versionCode`: installs if the app is missing, upgrades
   (`adb install -r`) if a newer `versionCode` is available, or skips
   straight to launching if the installed version is already current.
4. Launches the app's `MainActivity` via `adb shell am start`.

This is implemented in `src/adapters/android/companion-release.ts` (resolve/cache)
and `src/adapters/android/companion-bootstrap.ts` (install/update/launch
decision), called from `DeviceManager.startListening()`.

Note that clicking Listen does **not** itself start a capture session — it only
gets the companion app installed and running. Actual traffic capture begins once
you pair the app with the Mac (below) and start its on-device tunnel switch. The
device card's "Listening" badge only reflects the legacy Advanced-mode proxy (see
below); there's currently no live signal back from the companion app's VPN state
to the device list, so don't be surprised if the badge doesn't flip after Listen —
check the companion app's own Status screen instead.

### Manual build/install (development)

Requires Android Studio or the command-line Android SDK (API 35, min SDK 26).

```bash
cd android-companion
./gradlew assembleDebug
# APK output: app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Publishing a companion release

For the Listen button's primary (GitHub Releases) path to work, a release with an
asset literally named `http-tools-companion.apk` must exist on
[kdaydin-sisal/Http-tools](https://github.com/kdaydin-sisal/Http-tools). Bump
`versionCode`/`versionName` in `android-companion/app/build.gradle.kts`, then run:

```bash
scripts/release-companion-apk.sh
```

This builds `assembleDebug` (debug-signed — this app is only ever sideloaded, so
there's no benefit to managing a release signing key) and publishes it via the
GitHub CLI (`gh`, must be installed and authenticated) as a release tagged
`companion-v<versionName>`. Until the first release is published, Listen falls
back to the locally-built dev APK path described above.

## Pairing flow

1. On the Mac, open the dashboard's onboarding page (`http://localhost:8001/onboarding`)
   and start the proxy — it displays a pairing QR code containing the Mac's LAN IP,
   API port, SOCKS5 port, and a short-lived pairing token
   (see `GET /api/pairing/qr` in `src/control-plane/api-server.ts`).
2. On the Android device, open the companion app (Listen does this for you) and
   grant camera permission when prompted — QR scanning (CameraX + ML Kit) is the
   primary pairing method.
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

## Per-app capture attribution

Since Android only allows one active `VpnService` per device, all selected apps
share the same tunnel session — but the dashboard still shows which app made
each individual capture, down to the connection level, even when several apps
are selected and running traffic simultaneously.

This is resolved on the device itself, per TCP connection, not just once per
VPN session:

1. When the tunnel's native relay (a patched, vendored
   [hev-socks5-tunnel](https://github.com/heiher/hev-socks5-tunnel)) accepts a
   new TCP connection from a selected app, it calls back into Kotlin
   (`TProxyService.resolveAppIdentity`), which uses
   [`ConnectivityManager.getConnectionOwnerUid()`](https://developer.android.com/reference/android/net/ConnectivityManager#getConnectionOwnerUid(int,%20java.net.InetSocketAddress,%20java.net.InetSocketAddress))
   (Android 10+/API 29+ only) plus `PackageManager` to resolve the owning
   package for that specific connection's (local, remote) address pair.
2. That identity (a stable per-install device id plus the resolved package id)
   is smuggled to the Mac through the existing SOCKS5 handshake as RFC 1929
   username/password auth — a side-channel, not real authentication — so no
   new wire protocol or additional round-trip is needed.
3. The Mac's SOCKS5 shim reads it back off and tags the resulting
   request/response events with a `sourceApp` field, which the dashboard
   surfaces as an `App` column, a filter dropdown (with live per-app counts),
   and a "Source App" field in the capture detail view.

This only applies to Android's VPN-mode companion app tunnel on Android 10+;
it does not apply to iOS, to the legacy Advanced/global-proxy mode, or to
devices below API 29 (captures from those simply have no `sourceApp` and
appear unfiltered/unbadged, exactly as before this feature existed).

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

## Advanced mode: legacy system-wide proxy (rarely needed)

Before the companion app existed, the only way to intercept Android traffic was to
set the device's global HTTP proxy via ADB (`settings put global http_proxy`) and
manually install the CA certificate. This still exists as an explicit opt-in,
separate from the default Listen action, for situations where the companion app's
VPN can't be used — most commonly when another VPN app (see "Known limitations"
below) already holds the device's one available `VpnService` slot.

It's accessed via the **⚠ Advanced** button on an Android device card, which is
deliberately understated and always shows a fresh confirmation dialog before
doing anything (there's no "don't ask again" — this affects every app on the
device and is meant to stay a rare, deliberate choice, not a shortcut):

- Sets the device's global HTTP proxy to point at the Mac (or `10.0.2.2` +
  reverse tunnel for emulators).
- Pushes the CA certificate to the device's Downloads folder for manual
  install in Settings.
- **Every app on the device** is routed through the proxy, not just the one
  you're testing — unlike the companion app's per-app VPN picker.
- If HTTP Tools quits or crashes without clearing the proxy (e.g. the Mac
  sleeps, the process is killed), the device can be left unable to reach the
  network until the proxy is cleared manually (`adb shell settings put global
  http_proxy :0`, or Settings → Wi-Fi → network → Edit → Proxy → None).

This is implemented in `DeviceManager.startAdvancedAndroidProxy()`
(`src/adapters/device-manager.ts`) and the confirmation round-trip lives in the
`/api/devices/:id/start-advanced` route (`src/control-plane/api-server.ts`): a
first request without `confirmed: true` returns the warning text without doing
anything, and the UI shows it in a native `confirm()` dialog before resubmitting
with `confirmed: true`.

iOS is unaffected by any of this — see "Why isn't there an equivalent for iOS?"
below.

## Why isn't there an equivalent for iOS?

Short answer: Apple gives third-party (unsigned, non-MDM) apps no programmatic way
to do it. There is no ADB-equivalent CLI proxy-setting command, and no public API a
plain desktop tool can call to configure a real device's or simulator's system
proxy — that capability is restricted to (a) Apple Configuration Profiles, which
require either manual installation through Settings or a signed MDM/supervision
relationship, or (b) a signed Network Extension (VPN) app installed via a paid
Apple Developer Program membership and entitlement, which this project doesn't
have. That's why `src/adapters/ios/ios-adapter.ts` only automates the CA
certificate install (`simctl keychain add-root-cert` for simulators) and leaves
proxy configuration as a manual step in Settings → Wi-Fi → Configure Proxy —
there's simply no lower-friction path available on iOS today.

## Known limitations

- No signed/release APK — the companion app is always debug-signed (see
  "Publishing a companion release" above for why that's intentional here).
- TLS pinning bypass is out of scope (see `docs/architecture.md` non-goals).
- If your network's loopback traffic is transparently intercepted by endpoint
  security software (observed with Netskope), make sure any local test tooling
  connects via IPv6 loopback (`::1`) rather than `127.0.0.1` when talking to the
  Mac's proxy ports directly — the companion app's own shim already does this
  correctly, this only matters if you're scripting your own test clients.
- **Android only allows one active `VpnService` tunnel at a time on a given
  device.** If the device already has another always-on/active VPN app running
  (a corporate MDM VPN client, Netskope Client, Zscaler, etc.), our
  `Builder.establish()` call can be silently blocked by the OS, and the tunnel
  will not actually route any traffic even though the on-device switch shows
  "on" and the foreground service stays alive. This is a platform-level
  constraint, not a bug in this app — the same behavior was confirmed with HTTP
  Toolkit's own Android tooling on an affected device. Workarounds: temporarily
  disable/pause the other VPN app while using the companion app's tunnel, or
  test on a device/profile that doesn't have another VPN client installed. The
  app now logs `establish() returned null tunFd` in this situation (visible via
  `adb logcat`) to make the failure mode obvious instead of silently dropping
  captures.
- **(Fixed, kept here for context) VPN establishes but zero traffic ever
  reaches Mockttp.** Previously seen on a clean device (no competing VPN):
  the tunnel established successfully and DNS-over-UDP worked, but every
  connection stalled forever and no captures ever appeared. Root-caused to
  three compounding bugs, all now fixed:
  1. `VpnService.Builder` never called `setMtu()` (mismatched the native
     tunnel's configured MTU).
  2. No IPv6 default route was added to the VPN builder, so any IPv6 traffic
     from the tunneled app was silently dropped.
  3. The SOCKS5 shim's UDP ASSOCIATE reply hardcoded its bind address to
     `127.0.0.1`, telling the remote device to send DNS datagrams to itself
     instead of back to the Mac — this alone was enough to permanently break
     DNS resolution for every tunneled connection.
