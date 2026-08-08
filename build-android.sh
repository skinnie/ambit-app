#!/usr/bin/env bash
# Builds the Android app and prints the resulting APK's path. Debug by default (fast,
# unsigned, installable straight over adb - "adb install -r <path>"); pass "release" for a
# release build (needs a real signing config to actually install on a device).
# Real command, already verified working in this project (see commit 7204a3c's own message:
# "a real ./gradlew :app:assembleDebug against the actual NDK ... BUILD SUCCESSFUL").
#
#   ./build-android.sh
#   ./build-android.sh release
set -euo pipefail
cd "$(dirname "$0")/android/android"

VARIANT="${1:-debug}"
case "$VARIANT" in
  debug)   TASK=":app:assembleDebug" ;;
  release) TASK=":app:assembleRelease" ;;
  *) echo "unknown variant: $VARIANT (use 'debug' or 'release')" >&2; exit 1 ;;
esac

./gradlew "$TASK"

APK=$(find "app/build/outputs/apk/$VARIANT" -name "*.apk" | head -1)
echo ""
echo "APK: $(cd "$(dirname "$APK")" && pwd)/$(basename "$APK")"
