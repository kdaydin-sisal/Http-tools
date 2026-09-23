# macOS packaging notes

The Electron desktop shell (`electron/`) is implemented and working:
`npm run electron:start` runs it in dev mode, `npm run electron:package`
builds via `electron-builder` (config in `package.json`'s `build` key,
`appId: com.httptools.mac`). It already:

- Runs as a regular foreground app: visible Dock icon, appears in Cmd+Tab,
  opens its main window automatically on launch. A menu-bar (tray) icon is
  also available as a convenience for quick Start/Stop/Quit.
- Bundles the built `dist/` + `dist-electron/` artifacts and `node_modules`.
- Auto-selects free ports for the proxy/API/SOCKS5 shim if defaults are busy.
- Manages the macOS system HTTP/HTTPS proxy (`src/core/macos-system-proxy.ts`):
  points it at the running proxy on start, restores the prior settings on
  stop/quit/crash recovery.

## App icon

`electron/assets/app-icon.png`, `app-icon.icns`, and `tray-icon.png` are
committed, pre-generated files — they are derived from `HttpToolLogo.png`
(the project's source logo) by `npm run icons:generate`
(`scripts/generate-app-icon.sh` + `scripts/generate-app-icon.py`), which
crops/insets/rounds it to match macOS's Dock icon conventions and renders
every required `.icns` size.

`icons:generate` is **not** run automatically by `electron:start` or
`electron:package` — it only needs to be run manually after changing
`HttpToolLogo.png` or the generator scripts, then the regenerated files
committed. Running it on every package/start was removed because the
regeneration isn't byte-for-byte reproducible (PNG/`.icns` encoding varies
slightly run-to-run even with identical input), which produced a spurious
git diff on those 3 files after every single packaging run.

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

