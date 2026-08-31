#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# wsl-setup.sh — reproduce the WSL build environment for Linux + Android.
#
# WHY THIS EXISTS: three of the six platforms cannot be built on the Windows
# host. macOS and iOS never can (Apple toolchain is macOS-only). Android could
# not either, until we found out why — and the reason is worth stating plainly
# because it will otherwise be re-diagnosed as a Flutter problem for a fourth
# time:
#
#   `java.nio.channels.Selector.open()` FAILS FOR ALL JAVA ON THE WINDOWS HOST.
#   Proved with a 6-line program, no Gradle involved:
#     SocketException: Invalid argument: connect
#       at sun.nio.ch.UnixDomainSockets.connect0(Native Method)
#   The same JDK build in WSL returns "Selector.open(): OK".
#
# So Gradle dies in ~3.7s at startup on Windows and runs fine in WSL. This
# script builds that WSL environment. It needs NO `netsh winsock reset`, no
# reboot and no Windows admin rights.
#
# Idempotent — safe to re-run. Run from Windows with:
#     wsl -e bash /mnt/c/.../tooling/wsl-setup.sh
#
# Verify afterwards (from the repo root, inside WSL):
#     cd apps/subly && flutter build linux --release
#     cd apps/subly && flutter build apk --debug
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

FLUTTER_VERSION="3.47.2"   # keep in lockstep with .github/workflows/*.yml
JDK="/usr/lib/jvm/java-17-openjdk-amd64"
SDK="$HOME/Android/sdk"
APT_SDK="/usr/lib/android-sdk"

log() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

# ── 1. System packages ───────────────────────────────────────────────────────
# libcurl4-openssl-dev is here for the same reason, added 2026-07-31: sentry_flutter
# vendors sentry-native (C), which runs its own find_package(CURL) and fails the
# Linux build with "Could NOT find CURL" — a message naming sentry rather than the
# missing package. Kept in lockstep with build-platforms.yml's deps step.
#
# libsecret-1-dev + libjsoncpp-dev are NOT optional: flutter_secure_storage
# (our SecureStore, ADR 005) binds a NATIVE secure-storage library on every
# desktop platform. Without them CMake fails with `libsecret-1>=0.18.4 not
# found` from flutter_secure_storage_linux — an error that names a pkg-config
# module, not the plugin that needs it. Same root cause as the Windows host
# needing the VS ATL component (atlstr.h).
log "Installing system packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  openjdk-17-jdk-headless \
  clang cmake ninja-build pkg-config libgtk-3-dev liblzma-dev \
  libsecret-1-dev libjsoncpp-dev libcurl4-openssl-dev libstdc++-12-dev \
  xz-utils git curl unzip

# Android SDK from apt rather than a hand-rolled download: signed, versioned,
# reproducible — and it does not trip the repo's bash-guard, which blocks raw
# curl/wget to external hosts (it cannot distinguish a download from an
# exfiltration, and that guard is worth keeping intact).
log "Installing Android SDK packages"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  google-android-cmdline-tools-13.0-installer \
  google-android-platform-36-installer \
  google-android-build-tools-35.0.0-installer \
  google-android-platform-tools-installer

# ── 2. Flutter ───────────────────────────────────────────────────────────────
log "Installing Flutter $FLUTTER_VERSION"
if [ ! -d "$HOME/flutter" ]; then
  git clone --depth 1 -b "$FLUTTER_VERSION" https://github.com/flutter/flutter.git "$HOME/flutter"
fi
export PATH="$HOME/flutter/bin:$PATH"
git config --global --add safe.directory "$HOME/flutter" || true

# ── 3. A USER-WRITABLE Android SDK ───────────────────────────────────────────
# apt installs to /usr/lib/android-sdk, which is ROOT-OWNED. Gradle must be able
# to write to the SDK root to auto-install anything still missing (NDK, CMake,
# extra build-tools); pointed at the apt copy it dies with
# LicenceNotAcceptedException even though the licences are accepted.
log "Building a user-writable SDK at $SDK"
mkdir -p "$SDK"
for d in platforms build-tools platform-tools cmdline-tools; do
  if [ -d "$APT_SDK/$d" ] && [ ! -e "$SDK/$d" ]; then
    cp -r "$APT_SDK/$d" "$SDK/$d"
  fi
done
chmod -R u+w "$SDK"
yes | sdkmanager --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true

# ── 4. Persist the environment ───────────────────────────────────────────────
# CXXFLAGS: Ubuntu 26.04 ships clang 21, which promotes
# -Wdeprecated-literal-operator to an ERROR under flutter_secure_storage_linux's
# own -Werror, tripping on `operator "" _json` in its vendored nlohmann/json.hpp.
# CI (older clang) never sees this.
#
# JAVA_HOME: Gradle's toolchain detection otherwise picks a Java 25 *JRE* and
# fails with "does not provide the required capabilities: [JAVA_COMPILER]".
log "Persisting environment to ~/.bashrc"
add_line() { grep -qxF "$1" "$HOME/.bashrc" || echo "$1" >> "$HOME/.bashrc"; }
add_line "export JAVA_HOME=$JDK"
add_line "export ANDROID_HOME=$SDK"
add_line "export ANDROID_SDK_ROOT=$SDK"
add_line "export CXXFLAGS=-Wno-deprecated-literal-operator"
add_line "export PATH=\$PATH:\$HOME/flutter/bin:$SDK/platform-tools:\$JAVA_HOME/bin"

export JAVA_HOME="$JDK" ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
flutter config --android-sdk "$SDK" >/dev/null 2>&1 || true
flutter config --jdk-dir "$JDK"     >/dev/null 2>&1 || true

# ── 5. Sanity check ──────────────────────────────────────────────────────────
# The single most useful assertion in this file: if Selector.open() ever fails
# HERE too, the WSL route is gone and every Java build tool will break.
log "Verifying Selector.open() works (the Windows-host blocker)"
cat > /tmp/SelTest.java <<'JAVA'
import java.nio.channels.Selector;
public class SelTest {
  public static void main(String[] a) throws Exception {
    try (Selector s = Selector.open()) { System.out.println("Selector.open(): OK"); }
  }
}
JAVA
"$JDK/bin/java" /tmp/SelTest.java

log "Done. Open a NEW shell (or: source ~/.bashrc), then from the repo root:"
echo "    flutter pub get                       # workspace resolves at the ROOT"
echo "    cd apps/subly && flutter build linux --release"
echo "    cd apps/subly && flutter build apk --debug"
echo
echo "NOTE: android/gradle.properties caps the heap at -Xmx4G on purpose."
echo "A 16 GB host gives WSL ~7 GB, and an 8 GB heap CRASHED the VM"
echo "(Wsl/Service/E_UNEXPECTED) — which presents as a command returning no"
echo "output, i.e. it looks like a hang, not a crash. Do not raise it."
