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
/// Catching those needs a native crash handler installed by the SDK.
///
/// ⏱ 2026-10-01 · full review AA-08. The pinned `sentry_flutter` (9.26.0)
/// ships one for every non-web target — sentry-android (JVM + NDK), KSCrash on
/// iOS/macOS, sentry-native on Windows/Linux — and turns it on by default.
/// [TelemetryBootstrap] turns it OFF everywhere (`enableNativeCrashHandling =
/// false`, and the Android NDK's `io.sentry.ndk.enable` manifest switch),
/// because no native symbols are uploaded and a native event bypasses the
/// Dart-side PII scrub. So on EVERY target the exact failures a user calls
/// "the app just closed" produce NO report, by decision — and this table says
/// so rather than letting a green build imply otherwise.
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
      // ⏱ 2026-10-01: Dart exceptions only. The browser SDK's window-level JS
      // error handlers were given up on 2026-09-12 (W5, see
      // TelemetryBootstrap.useHttpTransportOnWeb), so a JS error that never
      // becomes a Dart exception is not reported.
      return const TelemetryCapabilities(
        dartErrors: true,
        nativeCrashes: false,
        note: 'Web: Dart exceptions are reported; window-level JS errors are '
            'not (the browser SDK is not loaded). There is no native crash '
            'concept — a tab kill is invisible to the page.',
      );
    }
    const String nativeOff = 'The native crash handler is OFF by decision '
        '(TelemetryBootstrap: enableNativeCrashHandling = false): no native '
        'symbols are uploaded and a native event would bypass the Dart PII '
        'scrub, so a native crash takes the process down and produces no '
        'report — exactly what a user means by "it just closed".';
    return switch (platform) {
      TargetPlatform.android => const TelemetryCapabilities(
          dartErrors: true,
          nativeCrashes: false,
          note: 'Android: Dart errors only. $nativeOff The NDK handler is off '
              "too, by each app manifest's io.sentry.ndk.enable.",
        ),
      TargetPlatform.iOS ||
      TargetPlatform.macOS =>
        const TelemetryCapabilities(
          dartErrors: true,
          nativeCrashes: false,
          note: 'iOS/macOS: Dart errors only. $nativeOff',
        ),
      TargetPlatform.windows ||
      TargetPlatform.linux =>
        const TelemetryCapabilities(
          dartErrors: true,
          nativeCrashes: false,
          note: 'Desktop Windows/Linux: Dart errors only. $nativeOff',
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
