# macOS packaging notes

The Electron menu-bar shell (`electron/`) is implemented and working:
`npm run electron:start` runs it in dev mode, `npm run electron:package`
builds via `electron-builder` (config in `package.json`'s `build` key,
`appId: com.httptools.mac`). It already:

- Runs as a tray-only app (no dock icon).
- Bundles the built `dist/` + `dist-electron/` artifacts and `node_modules`.
- Auto-selects free ports for the proxy/API/SOCKS5 shim if defaults are busy.
- Manages the macOS system HTTP/HTTPS proxy (`src/core/macos-system-proxy.ts`):
  points it at the running proxy on start, restores the prior settings on
  stop/quit/crash recovery.

## Remaining work to ship a signed/notarized build

1. Add hardened runtime entitlements as required by the app's networking/VPN
   usage.
2. Sign app with an Apple Developer ID (blocked on Developer Program
   enrollment/credentials — tracked as the `harden-package-validate-macos`
   todo).
3. Notarize and staple ticket.
4. Publish `.dmg` installer and checksum.

## Required follow-up
- Add release automation pipeline for signing/notarization.
- Add upgrade strategy and migration for persisted CA/rules/trusted-CAs.
- Add reproducible installer build instructions.
- Decide on a signed/release build story for the Android companion app APK
  (currently debug-only, sideloaded — see
  [android-companion.md](android-companion.md#known-limitations)).

