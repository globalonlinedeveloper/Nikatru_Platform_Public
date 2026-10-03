import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// What app lock can do on a platform — [pipeline C-7].
///
/// Pinned to **`local_auth` 3.x**, the range this package declares. The PIN
/// row is ours and true everywhere; the biometric row is a statement about the
/// plugin's federated implementations and is re-reviewed on any major bump.
@immutable
class AppLockCapabilities {
  const AppLockCapabilities({
    required this.pin,
    required this.biometric,
    required this.why,
  });

  /// A PIN lock. Pure Dart over the secure store, so every target has one.
  final bool pin;

  /// The device biometric (or Windows Hello) through local_auth.
  final bool biometric;

  /// The one-line reason, never empty.
  final String why;

  /// The capabilities for [platform]. [isWeb] wins over the host platform.
  static AppLockCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const AppLockCapabilities(
        pin: true,
        biometric: false,
        why:
            'local_auth has no web implementation (WebAuthn is a sign-in '
            'ceremony, not a local unlock); the PIN hash lives in the web '
            'secure store, which is the weakest of the seven.',
      );
    }
    switch (platform) {
      case TargetPlatform.android:
        return const AppLockCapabilities(
          pin: true,
          biometric: true,
          why:
              'local_auth_android uses BiometricPrompt; needs a '
              'FragmentActivity host and USE_BIOMETRIC.',
        );
      case TargetPlatform.iOS:
        return const AppLockCapabilities(
          pin: true,
          biometric: true,
          why:
              'local_auth_darwin uses LocalAuthentication; Face ID needs '
              'NSFaceIDUsageDescription in Info.plist.',
        );
      case TargetPlatform.macOS:
        return const AppLockCapabilities(
          pin: true,
          biometric: true,
          why:
              'local_auth_darwin uses LocalAuthentication (Touch ID); a Mac '
              'with no sensor answers unavailable and the PIN remains.',
        );
      case TargetPlatform.windows:
        return const AppLockCapabilities(
          pin: true,
          biometric: true,
          why:
              'local_auth_windows uses Windows Hello (UserConsentVerifier); a '
              'machine with Hello not set up answers unavailable.',
        );
      case TargetPlatform.linux:
        return const AppLockCapabilities(
          pin: true,
          biometric: false,
          why:
              'local_auth has no Linux implementation (no fprintd bridge); '
              'the PIN is the lock.',
        );
      case TargetPlatform.fuchsia:
        return const AppLockCapabilities(
          pin: true,
          biometric: false,
          why: 'No local_auth implementation; the PIN is the lock.',
        );
    }
  }
}
