import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// Which store age-signal API a platform can read — [ADR 082] §5, [pipeline C-7].
///
/// The platform is a PARAMETER, as in `StorageCapabilities`, so every row is
/// reachable from a test rather than only the test host's.
///
/// 🔴 THE ROW THAT MATTERS IS "NONE", and it is most of the table. Only two
/// stores publish an age signal a sign-up can read: Google Play (Age Signals,
/// beta) and Apple on iOS 26+ (Declared Age Range). macOS, Windows, Linux, web
/// and anything else have NO API, so the gate there proceeds on the 18+
/// declaration — the same outcome as a store that answers "not shared". A caller
/// that assumed a signal everywhere would be believing a check that never runs.
///
/// ⚠️ iOS IS CONDITIONAL TWICE: the API exists only on iOS 26+, and it answers
/// only when the app carries the `com.apple.developer.declared-age-range`
/// entitlement. Without either, the adapter reports no signal (tested in
/// `test/age_signals_test.dart`).
@immutable
class AgeSignalCapabilities {
  const AgeSignalCapabilities({required this.storeApi, required this.note});

  /// The store age-signal API this platform can read, or [AgeSignalApi.none].
  final AgeSignalApi storeApi;

  /// Why this platform differs, in one line.
  final String note;

  /// Whether a store age signal can be read at all here.
  bool get hasStoreApi => storeApi != AgeSignalApi.none;

  /// The capabilities for [platform], with [isWeb] taking precedence.
  static AgeSignalCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const AgeSignalCapabilities(
        storeApi: AgeSignalApi.none,
        note: 'Web: no store sits between the page and the person, so there is '
            'no age signal to read. The gate proceeds on the 18+ declaration.',
      );
    }
    return switch (platform) {
      TargetPlatform.android => const AgeSignalCapabilities(
          storeApi: AgeSignalApi.playAgeSignals,
          note: 'Android: Google Play Age Signals (beta). Needs the Play Store '
              'on the device; a device without it answers no signal.',
        ),
      TargetPlatform.iOS => const AgeSignalCapabilities(
          storeApi: AgeSignalApi.appleDeclaredAgeRange,
          note: 'iOS: Declared Age Range, iOS 26+ only, and only with the '
              'declared-age-range entitlement; otherwise no signal.',
        ),
      TargetPlatform.macOS => const AgeSignalCapabilities(
          storeApi: AgeSignalApi.none,
          note: 'macOS: no adapter is built for the Mac App Store; no signal.',
        ),
      TargetPlatform.windows => const AgeSignalCapabilities(
          storeApi: AgeSignalApi.none,
          note:
              'Windows: the Microsoft Store publishes no age signal; no signal.',
        ),
      TargetPlatform.linux => const AgeSignalCapabilities(
          storeApi: AgeSignalApi.none,
          note: 'Linux: no store age signal exists; no signal.',
        ),
      TargetPlatform.fuchsia => const AgeSignalCapabilities(
          storeApi: AgeSignalApi.none,
          note: 'Fuchsia: not a shipping target; no signal.',
        ),
    };
  }
}

/// The store age-signal APIs this package has an adapter for.
enum AgeSignalApi { playAgeSignals, appleDeclaredAgeRange, none }
