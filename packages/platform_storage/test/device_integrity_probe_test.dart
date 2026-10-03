// ⏱ 2026-10-01 · O-APPS-GOV-IN-VAPT-CHECKLIST — the channel half of the device
// integrity probe: what the native side answers, read back into core's types.
//
// 🔴 EVERY FAILURE THROWS. core turns a throw into `unknown` / `unreadable`,
// both recorded and neither blocking; a probe that answered "clean" on a
// failure would hide a device it never read. Each failure shape has its case.
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

// An app that records no per-app pin of its own.
const Map<String, List<String>> _appPins = <String, List<String>>{};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final TestDefaultBinaryMessenger messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final List<MethodCall> calls = <MethodCall>[];

  void answer(Object? Function(MethodCall call) reply) {
    messenger.setMockMethodCallHandler(deviceIntegrityChannel, (
      MethodCall call,
    ) async {
      calls.add(call);
      return reply(call);
    });
  }

  setUp(calls.clear);
  tearDown(
    () => messenger.setMockMethodCallHandler(deviceIntegrityChannel, null),
  );

  const MethodChannelDeviceIntegrityProbe probe =
      MethodChannelDeviceIntegrityProbe();

  test('the channel is the one the native halves register', () {
    expect(deviceIntegrityChannel.name, 'nikatru/device_integrity');
  });

  group('rootSignals', () {
    test('wire names become signals; unknown names are dropped', () async {
      answer(
        (_) => <String, Object?>{
          'signals': <String>['su_binary', 'writable_system', 'bogus'],
        },
      );
      expect(await probe.rootSignals(), <core.RootSignal>{
        core.RootSignal.suBinary,
        core.RootSignal.writableSystem,
      });
      expect(calls.single.method, 'rootSignals');
    });

    test('an empty list is clean', () async {
      answer((_) => <String, Object?>{'signals': <String>[]});
      expect(await probe.rootSignals(), isEmpty);
    });

    test('an error map, no map, or no list throws', () async {
      for (final Object? reply in <Object?>[
        <String, Object?>{'error': true},
        null,
        <String, Object?>{'signals': 'su_binary'},
      ]) {
        answer((_) => reply);
        await expectLater(probe.rootSignals(), throwsA(isA<StateError>()));
      }
    });

    test('a missing plugin throws, so core records unknown', () async {
      // No handler at all: MissingPluginException.
      expect((await core.detectRoot(probe)).status, core.RootStatus.unknown);
    });
  });

  group('signingCertificates', () {
    test('the digests and the multiple-signer flag come back', () async {
      answer(
        (_) => <String, Object?>{
          'sha256': <String>['AB' * 32, 'CD' * 32],
          'multipleSigners': true,
        },
      );
      final core.SigningCertificates c = await probe.signingCertificates();
      expect(c.sha256, <String>['AB' * 32, 'CD' * 32]);
      expect(c.multipleSigners, isTrue);
      expect(calls.single.method, 'signingCertificates');
    });

    test('an error map throws, so core records unreadable', () async {
      answer((_) => <String, Object?>{'error': true});
      final core.DeviceIntegrity i = await core.assessDeviceIntegrity(
        appPins: _appPins,
        probe: probe,
        releaseChannel: 'android-play',
        isDebugBuild: false,
        checksSigner: true,
      );
      expect(i.signer, core.SignerVerdict.unreadable);
      expect(i.blocksDataAccess, isFalse);
    });
  });

  group('platformDeviceIntegrityProbe', () {
    test('android and ios have a probe', () {
      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.android,
        TargetPlatform.iOS,
      ]) {
        expect(
          platformDeviceIntegrityProbe(platform: p, isWeb: false),
          isA<MethodChannelDeviceIntegrityProbe>(),
          reason: p.name,
        );
      }
    });

    test('web and desktop have none', () {
      expect(
        platformDeviceIntegrityProbe(
          platform: TargetPlatform.android,
          isWeb: true,
        ),
        isNull,
      );
      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.macOS,
        TargetPlatform.windows,
        TargetPlatform.linux,
        TargetPlatform.fuchsia,
      ]) {
        expect(
          platformDeviceIntegrityProbe(platform: p, isWeb: false),
          isNull,
          reason: p.name,
        );
      }
    });
  });
}
