# HTTP Tools (Mac-first)

Initial implementation of an independent HTTP(S) interception core for mobile testing.

## Current status
- Local HTTP(S) proxy service
- Local CA generation/persistence
- Request/response matching and mutation rules
- Structured request/response event stream
- Android onboarding CLI (ADB discovery, proxy setup, reverse tunnel, cert install intent)
- iOS onboarding CLI (simulator cert installation + step-by-step real-device setup)
- Minimal control-plane API with SSE event stream for future desktop/web UI

## Run
```bash
npm install
npm run build
npm start -- examples/rules.sample.json
npm run validate:smoke
```

Android onboarding:
```bash
npm run android:onboard -- <device-serial> <your-mac-ip> 8000
```

Note: the onboarding command pushes a DER-encoded `.cer` CA file to the device/emulator, force-restarts CertInstaller, and opens it via a readable `content://` URI.

iOS onboarding:
```bash
npm run ios:onboard -- simulator <your-mac-ip> 8000 [simulator-udid]
npm run ios:onboard -- real-device <your-mac-ip> 8000
```

Optional env vars:
- `HTTP_TOOLS_PROXY_PORT` (default: `8000`)
- `HTTP_TOOLS_API_PORT` (default: `8001`)

## Notes
- v1 supports HTTP/HTTPS interception where devices trust the generated CA.
- TLS pinning bypass is intentionally out of scope for this phase.

## Control API (for UI integration)
- `GET /` (minimal local dashboard)
- `GET /health`
- `GET /rules`
- `PUT /rules` (JSON array of rule objects)
- `GET /captures` (recent request/response events)
- `GET /events` (Server-Sent Events stream with `request`/`response`/`tls-failure` events)
- `GET /diagnostics/unsupported-traffic` (recent TLS handshake failures + guidance)
