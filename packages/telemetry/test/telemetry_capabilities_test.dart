import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';

/// [pipeline C-7] Crash reporting is the adapter where "it works on six
/// platforms" is most likely to be believed and least likely to be true.
void main() {
  const List<TargetPlatform> all = <TargetPlatform>[
    TargetPlatform.android,
    TargetPlatform.iOS,
    TargetPlatform.macOS,
    TargetPlatform.windows,
    TargetPlatform.linux,
    TargetPlatform.fuchsia,
  ];

  test('every platform has a declared row, web included', () {
    for (final TargetPlatform p in all) {
      expect(TelemetryCapabilities.forPlatform(p, isWeb: false), isNotNull);
    }
    expect(
      TelemetryCapabilities.forPlatform(TargetPlatform.android, isWeb: true),
      isNotNull,
    );
  });

  test('Dart errors are reported on every real target', () {
    for (final TargetPlatform p in all) {
      if (p == TargetPlatform.fuchsia) continue;
      expect(
        TelemetryCapabilities.forPlatform(p, isWeb: false).dartErrors,
        isTrue,
        reason: '$p lost Dart error reporting',
      );
    }
  });

  // 🔴 THE DISTINCTION THAT MATTERS. Collapsing "Dart errors" and "native
  // crashes" is how a portfolio believes it has crash reporting and does not:
  // on desktop Windows/Linux the exact failure a user calls "it just closed"
  // produces NO report at all.
  test('desktop Windows and Linux catch NO native crashes', () {
    for (final TargetPlatform p in <TargetPlatform>[
      TargetPlatform.windows,
      TargetPlatform.linux,
    ]) {
      final TelemetryCapabilities c = TelemetryCapabilities.forPlatform(
        p,
        isWeb: false,
      );
      expect(c.dartErrors, isTrue);
      expect(
        c.nativeCrashes,
        isFalse,
        reason: 'sentry_flutter ships no native crash handler for desktop '
            '$p — claiming otherwise hides the failure users actually hit',
      );
      expect(c.note, isNotEmpty);
    }
  });

  test('mobile and macOS DO catch native crashes', () {
    for (final TargetPlatform p in <TargetPlatform>[
      TargetPlatform.android,
      TargetPlatform.iOS,
      TargetPlatform.macOS,
    ]) {
      expect(
        TelemetryCapabilities.forPlatform(p, isWeb: false).nativeCrashes,
        isTrue,
        reason: '$p should have a native handler',
      );
    }
  });

  test('web reports Dart/JS errors but has no native crash concept', () {
    final TelemetryCapabilities web = TelemetryCapabilities.forPlatform(
      TargetPlatform.android,
      isWeb: true,
    );
    expect(web.dartErrors, isTrue);
    expect(web.nativeCrashes, isFalse);
    expect(web.note, isNotEmpty);
  });

  test('every platform that degrades explains why', () {
    for (final TargetPlatform p in all) {
      final TelemetryCapabilities c = TelemetryCapabilities.forPlatform(
        p,
        isWeb: false,
      );
      if (!c.nativeCrashes) {
        expect(c.note, isNotEmpty, reason: '$p degrades silently');
      }
    }
  });
}
