// [ADR 082] §5 — the store age-signal adapters.
//
// What each group pins:
//   · the raw fields each native side returns are mapped by the core mappers,
//     and every failure shape (error flag, PlatformException, no native side, a
//     null or malformed answer) is NoAgeSignal(error), never "adult";
//   · host selection: android reads Play, ios reads Apple, every other host no
//     signal;
//   · 🔴 THE AGE RANGE IS READ, DECIDED ON AND DISCARDED: the Dart side logs
//     nothing and sends nothing but the one `read` call, and the native sources
//     contain no logging, storage or network call (owner's use restriction,
//     2026-09-15).
import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_platform_storage/age_signals.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final TestDefaultBinaryMessenger messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final List<MethodCall> calls = <MethodCall>[];

  void answer(Object? Function(MethodCall call) handler) {
    messenger.setMockMethodCallHandler(ageSignalsChannel,
        (MethodCall call) async {
      calls.add(call);
      return handler(call);
    });
  }

  setUp(calls.clear);
  tearDown(() => messenger.setMockMethodCallHandler(ageSignalsChannel, null));

  Future<core.AgeSignal> play() => const PlayAgeSignalSource().read();
  Future<core.AgeSignal> apple() => const AppleAgeSignalSource().read();

  group('Play Age Signals adapter', () {
    test('SHARED 18+ is adult', () async {
      answer((_) => <String, Object?>{
            'accessStatus': 'SHARED',
            'ageLower': 18,
            'ageUpper': null
          });
      expect(await play(), const core.AdultAgeSignal());
    });
    test('SHARED 13–15 is below adult', () async {
      answer((_) => <String, Object?>{
            'accessStatus': 'SHARED',
            'ageLower': 13,
            'ageUpper': 15
          });
      expect(await play(), const core.BelowAdultAgeSignal());
    });
    test('NOT_SHARED is declined', () async {
      answer((_) => <String, Object?>{'accessStatus': 'NOT_SHARED'});
      expect(await play(),
          const core.NoAgeSignal(core.NoAgeSignalReason.declined));
    });
    test('VERIFICATION_REQUIRED is unavailable (proceeds on the declaration)',
        () async {
      answer((_) => <String, Object?>{'accessStatus': 'VERIFICATION_REQUIRED'});
      expect(await play(),
          const core.NoAgeSignal(core.NoAgeSignalReason.unavailable));
    });
    test('the native error flag is error', () async {
      answer((_) => <String, Object?>{'error': true});
      expect(
          await play(), const core.NoAgeSignal(core.NoAgeSignalReason.error));
    });
    test('a PlatformException is error, never adult', () async {
      answer((_) => throw PlatformException(code: 'boom'));
      expect(
          await play(), const core.NoAgeSignal(core.NoAgeSignalReason.error));
    });
    test('no native side at all (MissingPluginException) is error', () async {
      expect(
          await play(), const core.NoAgeSignal(core.NoAgeSignalReason.error));
    });
    test('a null answer is error; a missing status is unavailable', () async {
      answer((_) => null);
      expect(
          await play(), const core.NoAgeSignal(core.NoAgeSignalReason.error));
      answer((_) => <String, Object?>{'ageLower': 18});
      expect(await play(),
          const core.NoAgeSignal(core.NoAgeSignalReason.unavailable));
    });
  });

  // ⏱ 2026-09-15 · iOS ships WITHOUT the com.apple.developer.declared-age-range
  // entitlement until the App ID capability is enabled and the provisioning
  // profile regenerated (an owner action; signing must not break meanwhile). An
  // app without it gets a thrown AgeRangeService error, which the Swift adapter
  // answers as `error: true`. This pins what that means end to end.
  group('🔴 entitlement missing on iOS', () {
    test(
        'the thrown request is error → no signal → proceeds on the 18+ declaration',
        () async {
      answer((_) => <String, Object?>{'error': true});
      final core.AgeSignal signal = await apple();
      expect(signal, const core.NoAgeSignal(core.NoAgeSignalReason.error));
      expect(
          core.signUpAgeGate(signal), core.SignUpAgeGate.proceedOnDeclaration);
    });

    test('the Swift adapter really answers a thrown request with error: true',
        () {
      final String swift = File(
        'ios/nikatru_platform_storage/Sources/nikatru_platform_storage/AgeSignalsPlugin.swift',
      ).readAsStringSync();
      expect(swift, contains('} catch {\n      return ["error": true]\n    }'));
    });
  });

  group('Apple Declared Age Range adapter', () {
    test('no API on this OS (eligible null) is unavailable', () async {
      answer((_) => <String, Object?>{'eligible': null});
      expect(await apple(),
          const core.NoAgeSignal(core.NoAgeSignalReason.unavailable));
    });
    test('not eligible is notEligible', () async {
      answer((_) => <String, Object?>{'eligible': false});
      expect(await apple(),
          const core.NoAgeSignal(core.NoAgeSignalReason.notEligible));
    });
    test('sharing lowerBound 18 is adult', () async {
      answer((_) => <String, Object?>{
            'eligible': true,
            'response': 'sharing',
            'lowerBound': 18,
            'upperBound': null
          });
      expect(await apple(), const core.AdultAgeSignal());
    });
    test('sharing below the gate is below adult', () async {
      answer((_) => <String, Object?>{
            'eligible': true,
            'response': 'sharing',
            'lowerBound': null,
            'upperBound': 17
          });
      expect(await apple(), const core.BelowAdultAgeSignal());
    });
    test('declinedSharing is declined', () async {
      answer((_) =>
          <String, Object?>{'eligible': true, 'response': 'declinedSharing'});
      expect(await apple(),
          const core.NoAgeSignal(core.NoAgeSignalReason.declined));
    });
    test('the native error flag and a PlatformException are error', () async {
      answer((_) => <String, Object?>{'error': true});
      expect(
          await apple(), const core.NoAgeSignal(core.NoAgeSignalReason.error));
      answer((_) => throw PlatformException(code: 'boom'));
      expect(
          await apple(), const core.NoAgeSignal(core.NoAgeSignalReason.error));
    });
  });

  group('storeAgeSignalSourceFor — every host', () {
    test('android reads Play', () {
      expect(storeAgeSignalSourceFor(core.AgeSignalHost.android),
          isA<PlayAgeSignalSource>());
    });
    test('ios reads Apple', () {
      expect(storeAgeSignalSourceFor(core.AgeSignalHost.ios),
          isA<AppleAgeSignalSource>());
    });
    test('macos, windows, linux, web and other read no signal (noApiOnTarget)',
        () async {
      expect(await storeAgeSignalSourceFor(core.AgeSignalHost.macos).read(),
          const core.NoAgeSignal(core.NoAgeSignalReason.noApiOnTarget));
      expect(await storeAgeSignalSourceFor(core.AgeSignalHost.windows).read(),
          const core.NoAgeSignal(core.NoAgeSignalReason.noApiOnTarget));
      expect(await storeAgeSignalSourceFor(core.AgeSignalHost.linux).read(),
          const core.NoAgeSignal(core.NoAgeSignalReason.noApiOnTarget));
      expect(await storeAgeSignalSourceFor(core.AgeSignalHost.web).read(),
          const core.NoAgeSignal(core.NoAgeSignalReason.noApiOnTarget));
      expect(await storeAgeSignalSourceFor(core.AgeSignalHost.other).read(),
          const core.NoAgeSignal(core.NoAgeSignalReason.noApiOnTarget));
    });
  });

  group('🔴 read, decided on, discarded — nothing logged, stored or sent', () {
    test(
        'a read prints and debugPrints nothing, on either adapter, on any answer',
        () async {
      final List<String> printed = <String>[];
      final DebugPrintCallback original = debugPrint;
      debugPrint =
          (String? message, {int? wrapWidth}) => printed.add(message ?? '');
      addTearDown(() => debugPrint = original);
      await runZoned(
        () async {
          answer((_) => <String, Object?>{
                'accessStatus': 'SHARED',
                'ageLower': 13,
                'ageUpper': 15
              });
          await play();
          answer((_) => <String, Object?>{
                'eligible': true,
                'response': 'sharing',
                'lowerBound': 18
              });
          await apple();
          answer((_) =>
              throw PlatformException(code: 'boom', message: 'age 13-15'));
          await play();
        },
        zoneSpecification: ZoneSpecification(
            print: (_, __, ___, String line) => printed.add(line)),
      );
      expect(printed, isEmpty);
    });

    test('the only message sent to the native side is one argument-less `read`',
        () async {
      answer(
          (_) => <String, Object?>{'accessStatus': 'SHARED', 'ageLower': 18});
      await play();
      expect(calls.map((MethodCall c) => c.method), <String>['read']);
      expect(calls.single.arguments, isNull);
    });

    test('the native sources contain no logging, storage or network call', () {
      final Map<String, String> sources = <String, String>{
        'android': File(
                'android/src/main/kotlin/com/nikatru/platform_storage/AgeSignalsPlugin.kt')
            .readAsStringSync(),
        'ios': File(
                'ios/nikatru_platform_storage/Sources/nikatru_platform_storage/AgeSignalsPlugin.swift')
            .readAsStringSync(),
      };
      final RegExp forbidden = RegExp(
        r'\bLog\.|\bprintln\(|\bprint\(|\bNSLog\(|\bos_log\(|\bLogger\(|SharedPreferences|UserDefaults|'
        r'FileOutputStream|\bwrite\(to|URLSession|HttpURLConnection|okhttp|Firebase|Analytics',
      );
      for (final MapEntry<String, String> e in sources.entries) {
        // Comments are allowed to NAME what is forbidden; code is not.
        final String code = e.value
            .split('\n')
            .where((String l) => !RegExp(r'^\s*(//|\*|/\*\*)').hasMatch(l))
            .join('\n');
        expect(forbidden.hasMatch(code), isFalse,
            reason: '${e.key}: ${forbidden.firstMatch(code)?.group(0)}');
      }
    });
  });
}
