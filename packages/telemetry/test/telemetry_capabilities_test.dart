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
  // the exact failure a user calls "it just closed" is a native one.
  //
  // ⏱ 2026-10-01 · full review AA-08. Until today this file said Android, iOS
  // and macOS DO catch native crashes. They would have — the pinned SDK's
  // handler is on by default — but nothing uploads the symbols that make such
  // a report readable (no dSYM, PDB, NDK or R8 mapping), and a native event
  // never passes the Dart-side PII scrub. TelemetryBootstrap now turns the
  // handler off (`enableNativeCrashHandling = false`, plus the Android NDK's
  // manifest switch), so NO target reports a native crash, and each says why.
  test('no target reports native crashes: the native layer is off by decision',
      () {
    for (final TargetPlatform p in <TargetPlatform>[
      TargetPlatform.android,
      TargetPlatform.iOS,
      TargetPlatform.macOS,
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
        reason: 'TelemetryBootstrap sets enableNativeCrashHandling = false, '
            'so claiming $p reports native crashes hides the failure users '
            'actually hit',
      );
      expect(c.note, contains('enableNativeCrashHandling'),
          reason: '$p must name the switch that decides it');
    }
  });

  test('web reports Dart errors but has no native crash concept', () {
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
