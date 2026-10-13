#!/usr/bin/env bash
# Builds libt3tailnet.so, the built-in Tailscale engine of the Android app,
# from apps/mobile/modules/t3-tailnet/go into that module's jniLibs. Needs Go
# and the Android NDK (ANDROID_NDK_HOME or ANDROID_NDK_LATEST_HOME). The fork
# ships arm64-v8a only.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
module="$root/apps/mobile/modules/t3-tailnet"
ndk="${ANDROID_NDK_HOME:-${ANDROID_NDK_LATEST_HOME:-${ANDROID_NDK_ROOT:-}}}"
[[ -d "$ndk" ]] || { echo "Set ANDROID_NDK_HOME to an Android NDK." >&2; exit 1; }
# The app's minSdkVersion; a newer API level would load only on newer phones.
api=24
host="$(uname -s | tr '[:upper:]' '[:lower:]')-x86_64"
cc="$ndk/toolchains/llvm/prebuilt/$host/bin/aarch64-linux-android$api-clang"
[[ -x "$cc" ]] || { echo "No NDK compiler at $cc" >&2; exit 1; }

out="$module/android/src/main/jniLibs/arm64-v8a"
mkdir -p "$out"
cd "$module/go"
# 16 KB page alignment is required on Android 15+ devices that use it.
CGO_ENABLED=1 GOOS=android GOARCH=arm64 CC="$cc" \
  go build -buildmode=c-shared -trimpath \
  -ldflags="-s -w -extldflags=-Wl,-z,max-page-size=16384" \
  -o "$out/libt3tailnet.so" .
rm -f "$out/libt3tailnet.h"
ls -l "$out/libt3tailnet.so"
