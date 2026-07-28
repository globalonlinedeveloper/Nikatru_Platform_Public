import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// What crash and error reporting can actually catch on a platform —
/// [pipeline C-7].
///
/// 🔴 THE DISTINCTION THAT MATTERS IS DART-ERROR vs NATIVE-CRASH, and collapsing
/// them is how a portfolio believes it has crash reporting and does not.
///
/// A Dart exception is caught inside the VM and reported by ordinary code, so it
/// works anywhere the SDK runs. A NATIVE crash — a segfault in a plugin's C++,
/// an OOM kill, an ANR — takes the process down before any Dart code can run.
/// Catching those needs a native crash handler installed by the SDK, and
/// `sentry_flutter` only ships one for Android, iOS and macOS.
///
/// So on Windows, Linux and web, the exact failures a user calls "the app just
/// closed" are the ones that produce NO report. An app that builds on Windows,
/// crashes natively and reports nothing is passing CI and failing the user —
/// which is the gap this requirement exists to make visible rather than fix.
@immutable
class TelemetryCapabilities {
  const TelemetryCapabilities({
    required this.dartErrors,
    required this.nativeCrashes,
    required this.note,
  });

  /// Dart exceptions and `FlutterError`s. Available wherever Dart runs.
  final bool dartErrors;

  /// Native crashes — segfaults, OOM kills, ANRs. Needs a native handler.
  final bool nativeCrashes;

  /// Why this platform differs, in one line. Empty when it does not.
  final String note;

  /// The capabilities for [platform], with [isWeb] taking precedence.
  static TelemetryCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const TelemetryCapabilities(
        dartErrors: true,
        nativeCrashes: false,
        note: 'Web: JS errors and Dart exceptions are reported. There is no '
            'native crash concept — a tab kill is invisible to the page.',
      );
    }
    return switch (platform) {
      TargetPlatform.android ||
      TargetPlatform.iOS ||
      TargetPlatform.macOS =>
        const TelemetryCapabilities(
          dartErrors: true,
          nativeCrashes: true,
          note: '',
        ),
      TargetPlatform.windows ||
      TargetPlatform.linux =>
        const TelemetryCapabilities(
          dartErrors: true,
          // sentry_flutter ships no native crash handler for desktop
          // Windows/Linux — a segfault or OOM kill reports NOTHING.
          nativeCrashes: false,
          note: 'Desktop Windows/Linux: Dart errors only. A native crash takes '
              'the process down before any Dart code runs and produces no '
              'report — which is exactly what a user means by "it just closed".',
        ),
      TargetPlatform.fuchsia => const TelemetryCapabilities(
          dartErrors: false,
          nativeCrashes: false,
          note: 'Fuchsia is not a target platform for this portfolio.',
        ),
    };
  }

  @override
  String toString() => 'TelemetryCapabilities(dartErrors: $dartErrors, '
      'nativeCrashes: $nativeCrashes)';
}
