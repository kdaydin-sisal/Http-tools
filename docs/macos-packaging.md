# macOS packaging notes (next phase)

Current implementation runs as a Node.js app. To package as a signed macOS desktop app:

1. Wrap with Electron/Tauri shell.
2. Bundle Node runtime and built artifacts (`dist/`).
3. Add hardened runtime entitlements as required.
4. Sign app with Apple Developer ID.
5. Notarize and staple ticket.
6. Publish `.dmg` installer and checksum.

## Required follow-up
- Add release automation pipeline for signing/notarization.
- Add upgrade strategy and migration for persisted CA/rules.
- Add reproducible installer build instructions.
