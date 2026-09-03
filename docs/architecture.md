# Architecture & clean-room boundaries

## Scope
This project is an independent implementation of a Mac-first HTTP(S) interception tool for iOS/Android devices, emulators, and simulators.

## Clean-room boundaries
- Do not copy AGPL implementation code from HTTP Toolkit UI/server/desktop.
- Use those projects only as high-level reference for architecture ideas.
- Reusable permissive libraries are allowed (for example MIT-licensed proxy libraries).

## Component boundaries
1. **Core proxy service** (`src/core/proxy-service.ts`)
   - Starts local HTTP(S) intercept proxy (Mockttp).
   - Applies request/response mutation rules (`src/core/rule-engine.ts`).
   - Emits structured traffic events (captures + SSE).
   - Manages local CA (`src/core/ca-store.ts`) and additional imported trusted
     CAs (`src/core/trusted-ca-store.ts`) for outbound TLS to corporate
     MITM-proxied networks.
2. **Device adapters**
   - Android adapter (`src/adapters/android/`): legacy CLI onboarding — ADB
     discovery, global proxy routing, cert setup.
   - iOS adapter (`src/adapters/ios/`): simulator/real-device onboarding
     flows.
   - **Android companion app** (`android-companion/`, separate Kotlin/Gradle
     project): a more robust alternative to the legacy Android adapter — a
     per-app `VpnService` tunnel on-device that bridges to a SOCKS5 shim on
     the Mac (`src/core/socks5-shim.ts`), which forwards into Mockttp's normal
     HTTP forward-proxy port. Pairs via QR/mDNS (`src/core/pairing-service.ts`).
     See [android-companion.md](android-companion.md) for full details.
3. **Desktop control plane**
   - HTTP/SSE API server (`src/control-plane/api-server.ts`): captures, rules,
     diagnostics, pairing, trusted-CA management.
   - Server-rendered dashboard, rules editor, and onboarding/pairing pages
     (`src/control-plane/*-html.ts`).
   - Electron menu-bar shell (`electron/main.ts`): tray-only (no dock icon)
     wrapper that starts/stops the above, auto-manages the macOS system
     HTTP/HTTPS proxy, and auto-selects free ports.

## Initial stack decisions
- Runtime: Node.js 20+
- Language: TypeScript
- Proxy engine: Mockttp (MIT)
- Packaging target: macOS menu-bar app via Electron (`electron-builder`);
  signing/notarization not yet complete — see
  [macos-packaging.md](macos-packaging.md).
- Android companion app: Kotlin, `VpnService` + hev-socks5-tunnel (native
  userspace TUN-to-SOCKS5 relay, MIT) for the on-device tunnel.

## Non-goals for current MVP
- TLS pinning bypass
- Non-HTTP protocol interception guarantees
- Root/jailbreak-only interception paths
