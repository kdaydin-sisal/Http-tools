# Validation checklist (macOS)

## Deterministic smoke checks
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

## Android flow checks
1. `adb devices -l` lists target device.
2. Run onboarding:
   - `npm run android:onboard -- <serial> <mac-ip> 8000`
3. Confirm:
   - proxy configured on device
   - certificate install prompt shown
   - traffic appears in dashboard.

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

## Unsupported traffic diagnostics
- Query `GET /diagnostics/unsupported-traffic`.
- If `tlsFailures` are present, inspect:
  - certificate trust state
  - TLS pinning in app
  - non-HTTP protocol usage.
