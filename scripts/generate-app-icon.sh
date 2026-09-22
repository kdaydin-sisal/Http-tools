#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ICONSET="$ROOT/electron/assets/app-icon.iconset"

python3 "$ROOT/scripts/generate-app-icon.py"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

for size in 16 32 128 256 512 1024; do
  sips -z "$size" "$size" "$ROOT/electron/assets/app-icon.png" \
    --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  if [ "$size" -ne 1024 ]; then
    double=$((size * 2))
    sips -z "$double" "$double" "$ROOT/electron/assets/app-icon.png" \
      --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  fi
done

iconutil -c icns "$ICONSET" -o "$ROOT/electron/assets/app-icon.icns"
rm -rf "$ICONSET"
