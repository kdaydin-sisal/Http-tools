# Architecture & clean-room boundaries

## Scope
This project is an independent implementation of a Mac-first HTTP(S) interception tool for iOS/Android devices, emulators, and simulators.

## Clean-room boundaries
- Do not copy AGPL implementation code from HTTP Toolkit UI/server/desktop.
- Use those projects only as high-level reference for architecture ideas.
- Reusable permissive libraries are allowed (for example MIT-licensed proxy libraries).

## Component boundaries
1. **Core proxy service**
   - Starts local HTTP(S) intercept proxy.
   - Applies request/response mutation rules.
   - Emits structured traffic events.
2. **Device adapters** (next phase)
   - Android adapter: ADB discovery, proxy routing, cert setup checks.
   - iOS adapter: simulator/real device onboarding flows.
3. **Desktop control plane** (next phase)
   - Session control, traffic timeline, filtering, and rule editing.

## Initial stack decisions
- Runtime: Node.js 20+
- Language: TypeScript
- Proxy engine: Mockttp (MIT)
- Packaging target: macOS desktop app wrapper (later phase)

## Non-goals for current MVP
- TLS pinning bypass
- Non-HTTP protocol interception guarantees
- Root/jailbreak-only interception paths
