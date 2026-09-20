#!/usr/bin/env bash
set -euo pipefail

# GitHub's Ubuntu image already supplies the SDK and accepted licenses.
# Avoid replacing it with setup-android's command-line tools and legacy packages.
sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$sdk_dir" ] || [ ! -d "$sdk_dir" ]; then
  echo '::error::The hosted Android SDK directory is missing.'
  exit 1
fi

if [ ! -f "$sdk_dir/platforms/android-34/android.jar" ] ||
   [ ! -x "$sdk_dir/build-tools/34.0.0/apksigner" ] ||
   [ ! -x "$sdk_dir/platform-tools/adb" ]; then
  "$sdk_dir/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$sdk_dir" \
    'platform-tools' 'platforms;android-34' 'build-tools;34.0.0'
fi

test -f "$sdk_dir/platforms/android-34/android.jar"
test -x "$sdk_dir/build-tools/34.0.0/apksigner"
test -x "$sdk_dir/platform-tools/adb"
printf 'sdk.dir=%s\n' "$sdk_dir" > local.properties
printf 'ANDROID_HOME=%s\nANDROID_SDK_ROOT=%s\n' "$sdk_dir" "$sdk_dir" >> "$GITHUB_ENV"
printf '%s\n' "$sdk_dir/platform-tools" "$sdk_dir/cmdline-tools/latest/bin" >> "$GITHUB_PATH"
echo 'Android SDK 34 and build-tools 34.0.0 are ready.'
