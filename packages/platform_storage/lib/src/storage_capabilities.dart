import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// What a platform can actually guarantee about storage — [pipeline C-7].
///
/// Matches the shape `NotificationCapabilities` established: the platform is a
/// PARAMETER, so all six rows are reachable from a test rather than only the one
/// the test host happens to be.
///
/// 🔴 THE ROW THAT MATTERS IS LINUX, and it is the reason this class exists.
/// `flutter_secure_storage` on Linux is backed by **libsecret**, which is a
/// client library for a *running* Secret Service daemon (gnome-keyring or
/// KWallet). Both halves have to be true:
///   · the library must be installed — a headless container or a minimal desktop
///     often has neither;
///   · the daemon must be RUNNING AND UNLOCKED. On a login-less session (SSH, a
///     kiosk, CI) it frequently is not.
/// So the failure is not "Linux is unsupported" — it is that Linux support is
/// CONDITIONAL ON THE ENVIRONMENT in a way no other platform is. A caller that
/// assumes a keychain gets a runtime failure at the worst moment: the first
/// sign-in.
///
/// ⚠️ WEB IS THE OTHER HONEST ROW. A browser exposes no OS keychain to a page.
/// `flutter_secure_storage` on web wraps `window.crypto.subtle` over
/// `localStorage`, which raises the cost of a casual read but cannot survive
/// script execution on the origin. Declaring [secureStoreIsOsBacked] false there
/// is the difference between a caller knowing that and assuming otherwise.
@immutable
class StorageCapabilities {
  const StorageCapabilities({
    required this.keyValueStore,
    required this.secureStore,
    required this.secureStoreIsOsBacked,
    required this.note,
  });

  /// Non-secret key/value storage (`shared_preferences`). Works everywhere.
  final bool keyValueStore;

  /// Whether a secure store exists at all on this platform.
  final bool secureStore;

  /// Whether that secure store is backed by an OS secret service, as opposed to
  /// obfuscated ordinary storage. FALSE is not "broken" — it is "do not treat
  /// this as a keychain".
  final bool secureStoreIsOsBacked;

  /// Why this platform differs, in one line. Empty when it does not.
  final String note;

  /// The capabilities for [platform], with [isWeb] taking precedence.
  static StorageCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const StorageCapabilities(
        keyValueStore: true,
        secureStore: true,
        secureStoreIsOsBacked: false,
        note: 'Web: no OS keychain is reachable from a page. Secure storage is '
            'WebCrypto over localStorage — better than plaintext, but it cannot '
            'survive script execution on the origin. Prefer short-lived tokens.',
      );
    }
    return switch (platform) {
      TargetPlatform.android => const StorageCapabilities(
          keyValueStore: true,
          secureStore: true,
          secureStoreIsOsBacked: true,
          note: 'Android: KeyStore-backed EncryptedSharedPreferences.',
        ),
      TargetPlatform.iOS || TargetPlatform.macOS => const StorageCapabilities(
          keyValueStore: true,
          secureStore: true,
          secureStoreIsOsBacked: true,
          note: 'Apple: Keychain.',
        ),
      TargetPlatform.windows => const StorageCapabilities(
          keyValueStore: true,
          secureStore: true,
          secureStoreIsOsBacked: true,
          note: 'Windows: DPAPI, tied to the user account.',
        ),
      TargetPlatform.linux => const StorageCapabilities(
          keyValueStore: true,
          // Present, but conditional on the environment — see the class doc.
          secureStore: true,
          secureStoreIsOsBacked: true,
          note:
              'Linux: libsecret, which needs BOTH the library installed AND a '
              'running, unlocked Secret Service daemon (gnome-keyring/KWallet). '
              'Headless, kiosk and CI sessions often have neither, so a write can '
              'fail at runtime where every other desktop platform would succeed. '
              'Callers must treat a secure-store failure as expected here.',
        ),
      TargetPlatform.fuchsia => const StorageCapabilities(
          keyValueStore: true,
          secureStore: false,
          secureStoreIsOsBacked: false,
          note: 'Fuchsia is not a target platform for this portfolio.',
        ),
    };
  }

  @override
  String toString() => 'StorageCapabilities(keyValueStore: $keyValueStore, '
      'secureStore: $secureStore, osBacked: $secureStoreIsOsBacked)';
}
