/// ⏱ 2026-10-01 · DEVICE INTEGRITY — the platform kind of core's
/// [core.DeviceIntegrityProbe], and the one function that picks this build's
/// (row O-APPS-GOV-IN-VAPT-CHECKLIST).
///
/// The native halves answer raw facts on `nikatru/device_integrity`
/// (android/…/DeviceIntegrityHandler.kt, ios/…/DeviceIntegrityPlugin.swift);
/// what they MEAN is decided in `core` (`detectRoot`, `compareSigner`), where
/// it is unit tested with [core.FixedDeviceIntegrityProbe].
///
/// Every channel failure THROWS here, on purpose: `core.detectRoot` turns a
/// throw into `RootStatus.unknown` and `core.assessDeviceIntegrity` into
/// `SignerVerdict.unreadable` — both recorded, neither ever blocks. A probe
/// that swallowed the failure would answer "clean" instead, and a clean answer
/// that was never read is the one this file must not give.
library;

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter/services.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// The channel both native halves answer on.
const MethodChannel deviceIntegrityChannel = MethodChannel(
  'nikatru/device_integrity',
);

/// This build's probe, or null where there is no native side (web, desktop):
/// android and ios only.
core.DeviceIntegrityProbe? platformDeviceIntegrityProbe({
  TargetPlatform? platform,
  bool isWeb = kIsWeb,
}) {
  if (isWeb) return null;
  switch (platform ?? defaultTargetPlatform) {
    case TargetPlatform.android:
    case TargetPlatform.iOS:
      return const MethodChannelDeviceIntegrityProbe();
    case TargetPlatform.macOS:
    case TargetPlatform.windows:
    case TargetPlatform.linux:
    case TargetPlatform.fuchsia:
      return null;
  }
}

/// The probe over [deviceIntegrityChannel].
final class MethodChannelDeviceIntegrityProbe
    implements core.DeviceIntegrityProbe {
  const MethodChannelDeviceIntegrityProbe({
    this.channel = deviceIntegrityChannel,
  });

  final MethodChannel channel;

  Future<Map<Object?, Object?>> _call(String method) async {
    final Map<Object?, Object?>? raw = await channel
        .invokeMapMethod<Object?, Object?>(method);
    if (raw == null || raw['error'] == true) {
      throw StateError('$method answered no result');
    }
    return raw;
  }

  @override
  Future<Set<core.RootSignal>> rootSignals() async {
    final Object? signals = (await _call('rootSignals'))['signals'];
    if (signals is! List<Object?>) {
      throw StateError('rootSignals answered no list');
    }
    return <core.RootSignal>{
      for (final Object? s in signals)
        if (s is String && core.RootSignal.named(s) != null)
          core.RootSignal.named(s)!,
    };
  }

  @override
  Future<core.SigningCertificates> signingCertificates() async {
    final Map<Object?, Object?> raw = await _call('signingCertificates');
    final Object? digests = raw['sha256'];
    if (digests is! List<Object?>) {
      throw StateError('signingCertificates answered no list');
    }
    return core.SigningCertificates(
      sha256: <String>[for (final Object? d in digests) '$d'],
      multipleSigners: raw['multipleSigners'] == true,
    );
  }
}
