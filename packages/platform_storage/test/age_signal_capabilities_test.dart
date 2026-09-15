import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/age_signals.dart';

/// [ADR 082] §5 / [pipeline C-7] — the age-signal matrix covers every platform,
/// and it AGREES with the adapter selection a build actually uses. A matrix that
/// said "android reads Play" while `storeAgeSignalSourceFor` handed back no
/// signal would be a comment with a type.
void main() {
  const Map<TargetPlatform, core.AgeSignalHost> hostOf =
      <TargetPlatform, core.AgeSignalHost>{
    TargetPlatform.android: core.AgeSignalHost.android,
    TargetPlatform.iOS: core.AgeSignalHost.ios,
    TargetPlatform.macOS: core.AgeSignalHost.macos,
    TargetPlatform.windows: core.AgeSignalHost.windows,
    TargetPlatform.linux: core.AgeSignalHost.linux,
    TargetPlatform.fuchsia: core.AgeSignalHost.other,
  };

  test('every platform has a declared row with a note, web included', () {
    for (final TargetPlatform p in TargetPlatform.values) {
      expect(
          AgeSignalCapabilities.forPlatform(p, isWeb: false).note, isNotEmpty,
          reason: '$p has no row');
    }
    expect(
        AgeSignalCapabilities.forPlatform(TargetPlatform.android, isWeb: true)
            .note,
        isNotEmpty);
  });

  test('only android (Play) and iOS (Declared Age Range) have a store API', () {
    expect(
        AgeSignalCapabilities.forPlatform(TargetPlatform.android, isWeb: false)
            .storeApi,
        AgeSignalApi.playAgeSignals);
    expect(
        AgeSignalCapabilities.forPlatform(TargetPlatform.iOS, isWeb: false)
            .storeApi,
        AgeSignalApi.appleDeclaredAgeRange);
    for (final TargetPlatform p in <TargetPlatform>[
      TargetPlatform.macOS,
      TargetPlatform.windows,
      TargetPlatform.linux,
      TargetPlatform.fuchsia,
    ]) {
      expect(AgeSignalCapabilities.forPlatform(p, isWeb: false).hasStoreApi,
          isFalse,
          reason: '$p declares a store API no adapter reads');
    }
  });

  // The declared fallback on web: a web build still reports a host platform, and
  // an android browser must NOT read as the Play row.
  test('web has no store API even on an android or iOS host', () {
    expect(
        AgeSignalCapabilities.forPlatform(TargetPlatform.android, isWeb: true)
            .hasStoreApi,
        isFalse);
    expect(
        AgeSignalCapabilities.forPlatform(TargetPlatform.iOS, isWeb: true)
            .hasStoreApi,
        isFalse);
  });

  test('the iOS row names both of its conditions: iOS 26+ and the entitlement',
      () {
    final String note =
        AgeSignalCapabilities.forPlatform(TargetPlatform.iOS, isWeb: false)
            .note;
    expect(note, contains('26'));
    expect(note, contains('entitlement'));
  });

  test('the matrix agrees with the adapter a build selects, on every platform',
      () {
    for (final MapEntry<TargetPlatform, core.AgeSignalHost> e
        in hostOf.entries) {
      final AgeSignalApi api =
          AgeSignalCapabilities.forPlatform(e.key, isWeb: false).storeApi;
      final core.AgeSignalSource source = storeAgeSignalSourceFor(e.value);
      final AgeSignalApi selected = switch (source) {
        PlayAgeSignalSource() => AgeSignalApi.playAgeSignals,
        AppleAgeSignalSource() => AgeSignalApi.appleDeclaredAgeRange,
        _ => AgeSignalApi.none,
      };
      expect(selected, api, reason: '${e.key}: matrix and selection disagree');
    }
    final core.AgeSignalSource web = storeAgeSignalSourceFor(
        core.ageSignalHostNamed(isWeb: true, platform: 'android'));
    expect(web, isNot(isA<PlayAgeSignalSource>()));
  });
}
