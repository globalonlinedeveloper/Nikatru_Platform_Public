/// The store age-signal adapters — [ADR 082] §5. Its own library inside
/// `nikatru_platform_storage`, so a later split into a package stays mechanical.
///
/// 🔴 USE RESTRICTION, accepted by the owner on 2026-09-15 with the Play Age
/// Signals terms: the age range is read ONLY to decide the sign-up age gate — an
/// age-appropriate experience — and is NEVER used for analytics, advertising,
/// marketing or profiling. It is read, decided on and DISCARDED: nothing here
/// stores it, logs it, or sends it anywhere, and `test/` proves that on the Dart
/// side and scans the native sources for it.
///
/// The native side returns the store's raw fields over one MethodChannel call;
/// the meaning of those fields is `core.ageSignalFromPlay` /
/// `core.ageSignalFromApple`. Any failure is `NoAgeSignal(error)`, which the gate
/// treats as "no signal" and proceeds on the 18+ declaration — never as "adult".
library;

import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/services.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// The one channel both native adapters answer on.
const MethodChannel ageSignalsChannel = MethodChannel('nikatru/age_signals');

int? _intOrNull(Object? v) => v is int ? v : null;

/// Google Play Age Signals (beta) on Android.
final class PlayAgeSignalSource implements core.AgeSignalSource {
  const PlayAgeSignalSource({this.channel = ageSignalsChannel});

  final MethodChannel channel;

  @override
  Future<core.AgeSignal> read() async {
    try {
      final Map<Object?, Object?>? raw =
          await channel.invokeMapMethod<Object?, Object?>('read');
      if (raw == null || raw['error'] == true) {
        return const core.NoAgeSignal(core.NoAgeSignalReason.error);
      }
      final Object? status = raw['accessStatus'];
      if (status is! String) {
        return const core.NoAgeSignal(core.NoAgeSignalReason.unavailable);
      }
      return core.ageSignalFromPlay(
        accessStatus: status,
        ageLower: _intOrNull(raw['ageLower']),
        ageUpper: _intOrNull(raw['ageUpper']),
      );
    } on Object {
      // MissingPluginException (no native side), PlatformException, a bad
      // shape: all "could not tell", never "adult".
      return const core.NoAgeSignal(core.NoAgeSignalReason.error);
    }
  }
}

/// Apple Declared Age Range on iOS 26+.
final class AppleAgeSignalSource implements core.AgeSignalSource {
  const AppleAgeSignalSource({this.channel = ageSignalsChannel});

  final MethodChannel channel;

  @override
  Future<core.AgeSignal> read() async {
    try {
      final Map<Object?, Object?>? raw =
          await channel.invokeMapMethod<Object?, Object?>('read');
      if (raw == null || raw['error'] == true) {
        return const core.NoAgeSignal(core.NoAgeSignalReason.error);
      }
      final Object? eligible = raw['eligible'];
      final Object? response = raw['response'];
      return core.ageSignalFromApple(
        eligible: eligible is bool ? eligible : null,
        response: response is String ? response : null,
        lowerBound: _intOrNull(raw['lowerBound']),
        upperBound: _intOrNull(raw['upperBound']),
      );
    } on Object {
      return const core.NoAgeSignal(core.NoAgeSignalReason.error);
    }
  }
}

/// The source this build reads for [host]: the store adapter on android and
/// ios, no signal everywhere else (see `core.ageSignalSourceFor`).
core.AgeSignalSource storeAgeSignalSourceFor(core.AgeSignalHost host) =>
    core.ageSignalSourceFor(
      host,
      android: const PlayAgeSignalSource(),
      ios: const AppleAgeSignalSource(),
    );

/// The store source for the host this build is running on.
core.AgeSignalSource currentStoreAgeSignalSource() => storeAgeSignalSourceFor(
      core.ageSignalHostNamed(
          isWeb: kIsWeb, platform: defaultTargetPlatform.name),
    );
