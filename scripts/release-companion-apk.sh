#!/usr/bin/env bash
# Builds the Android companion app and publishes it as a GitHub Release asset
# named `http-tools-companion.apk`, which is exactly what the desktop app's
# `resolveCompanionApk()` (src/adapters/android/companion-release.ts) looks
# for when a user clicks "Listen" on an Android device.
#
# The APK is built with `assembleDebug` (debug-signed), not a release/signed
# build: this app is side-loaded via ADB, never distributed through the Play
# Store, so there is no benefit to managing a release signing key/secrets —
# the debug keystore installs and runs identically. Re-signing later (moving
# to a real release key) would require users to uninstall the old app first,
# since Android rejects updates with a different signing key.
#
# Usage:
#   scripts/release-companion-apk.sh [tag]
#
# If `tag` is omitted, it defaults to `companion-v<versionName>` from
# android-companion/app/build.gradle.kts. Requires the GitHub CLI (`gh`),
# authenticated with a token that can create releases on this repo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPANION_DIR="$REPO_ROOT/android-companion"
ASSET_NAME="http-tools-companion.apk"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: GitHub CLI ('gh') is required. Install it (e.g. 'brew install gh') and run 'gh auth login' first." >&2
  exit 1
fi

VERSION_NAME=$(grep -oE 'versionName = "[^"]+"' "$COMPANION_DIR/app/build.gradle.kts" | sed -E 's/versionName = "(.+)"/\1/')
VERSION_CODE=$(grep -oE 'versionCode = [0-9]+' "$COMPANION_DIR/app/build.gradle.kts" | sed -E 's/versionCode = ([0-9]+)/\1/')
TAG="${1:-companion-v${VERSION_NAME}}"

if [ -z "$VERSION_NAME" ] || [ -z "$VERSION_CODE" ]; then
  echo "error: could not read versionName/versionCode from $COMPANION_DIR/app/build.gradle.kts" >&2
  exit 1
fi

echo "Building companion app ${VERSION_NAME} (versionCode ${VERSION_CODE})…"
(cd "$COMPANION_DIR" && ./gradlew assembleDebug --console=plain)

APK_SRC="$COMPANION_DIR/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK_SRC" ]; then
  echo "error: expected APK not found at $APK_SRC" >&2
  exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
cp "$APK_SRC" "$WORKDIR/$ASSET_NAME"

echo "Publishing GitHub release '$TAG' with asset '$ASSET_NAME'…"
if gh release view "$TAG" >/dev/null 2>&1; then
  # Release already exists (e.g. re-running after a build fix) — replace the asset.
  gh release upload "$TAG" "$WORKDIR/$ASSET_NAME" --clobber
else
  gh release create "$TAG" "$WORKDIR/$ASSET_NAME" \
    --title "Companion app v${VERSION_NAME}" \
    --notes "Android companion app build ${VERSION_NAME} (versionCode ${VERSION_CODE}). Installed automatically by the desktop app's Listen button; see docs/android-companion.md."
fi

echo "Done. The desktop app will pick this up as the latest release automatically."
