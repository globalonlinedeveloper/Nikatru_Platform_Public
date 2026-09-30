// ⏱ 2026-09-29 · native sign-in attestation — the platform kinds.
//
// What each group pins, against a mocked `nikatru/native_attest` channel:
//   · Play Integrity: the nonce IS the request hash of the op's clientData, the
//     project number goes only when given, and the token is the proof;
//   · App Attest: one key made and kept in the secure store; registration
//     attests it over the clientData hash of op `install` and its own body;
//     each op asserts over its own clientData hash; forget drops the key;
//   · 🔴 every channel failure — an error map, a PlatformException, no native
//     side, an empty answer — is a THROWN NativeAttestationException, never a
//     proof-less success;
//   · platformNativeAttestor: the kind for every target.
//
// ⏱ 2026-09-30 · wire protocol v2: clientData carries the request target, so
// the vector's request hash is v2's, and an install is attested over the
// install URL's target it is handed.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

const String _app = 'subscriptiontracker';
const String _challenge = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

/// ⏱ 2026-09-30 · wire protocol v2's contract vector — the same literal core's
/// and the server's tests assert (recomputed with node:crypto).
const String _requestHash = 'OxAuf5vrL3xArivihIdBI7-GjML5J9Fb8l28ubtBYac';

/// The install URL's target: a path, no query.
const String _installTarget =
    '/v1/auth/native/subscriptiontracker/attest/install';

/// The contract vector's clientData (app, op token, challenge, target, body).
final String _clientData = core.nativeAttestClientData(
  app: _app,
  op: 'token',
  challenge: _challenge,
  target: '/v1/auth/native/subscriptiontracker/token?grant_type=password',
  body: utf8.encode('{"email":"a@example.test","password":"pw"}'),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final TestDefaultBinaryMessenger messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final List<MethodCall> calls = <MethodCall>[];

  void answer(Object? Function(MethodCall call) handler) {
    messenger.setMockMethodCallHandler(nativeAttestChannel, (
      MethodCall call,
    ) async {
      calls.add(call);
      return handler(call);
    });
  }

  setUp(calls.clear);
  tearDown(() => messenger.setMockMethodCallHandler(nativeAttestChannel, null));

  Matcher throwsAttest(String code) => throwsA(
    isA<core.NativeAttestationException>().having(
      (core.NativeAttestationException e) => e.code,
      'code',
      code,
    ),
  );

  group('Play Integrity', () {
    test('the nonce is the request hash; the token is the proof', () async {
      answer((_) => <String, Object?>{'token': 'integrity-token'});
      final core.NativeAttestProof proof = await const PlayIntegrityAttestor()
          .prove(clientData: _clientData);
      expect(proof.kind, 'play-integrity');
      expect(proof.keyId, isNull);
      expect(proof.proof, 'integrity-token');
      expect(calls.single.method, 'playIntegrityToken');
      expect(calls.single.arguments, <String, Object?>{'nonce': _requestHash});
      expect(proof.headers(_challenge).containsKey('X-NK-Attest-Key'), isFalse);
    });

    test('the cloud project number goes only when given', () async {
      answer((_) => <String, Object?>{'token': 't'});
      await const PlayIntegrityAttestor(
        cloudProjectNumber: 123456789012,
      ).prove(clientData: _clientData);
      expect(calls.single.arguments, <String, Object?>{
        'nonce': _requestHash,
        'cloudProjectNumber': 123456789012,
      });
    });

    test('no install step', () async {
      const PlayIntegrityAttestor attestor = PlayIntegrityAttestor();
      expect(attestor.needsInstall, isFalse);
      expect(await attestor.isRegistered(app: _app), isTrue);
      expect(calls, isEmpty);
    });

    group('🔴 a failure is an ERROR, never a proof-less success', () {
      test('the native error map', () async {
        answer((_) => <String, Object?>{'error': true, 'code': '-12'});
        await expectLater(
          const PlayIntegrityAttestor().prove(clientData: _clientData),
          throwsAttest('-12'),
        );
      });
      test('a PlatformException', () async {
        answer((_) => throw PlatformException(code: 'boom'));
        await expectLater(
          const PlayIntegrityAttestor().prove(clientData: _clientData),
          throwsAttest('boom'),
        );
      });
      test('no native side at all (MissingPluginException)', () async {
        await expectLater(
          const PlayIntegrityAttestor().prove(clientData: _clientData),
          throwsAttest('channel_failed'),
        );
      });
      test(
        'a null answer, an empty token, a token of the wrong type',
        () async {
          for (final Object? a in <Object?>[
            null,
            <String, Object?>{'token': ''},
            <String, Object?>{'token': 42},
            <String, Object?>{},
          ]) {
            answer((_) => a);
            await expectLater(
              const PlayIntegrityAttestor().prove(clientData: _clientData),
              throwsAttest('no_token'),
              reason: '$a',
            );
          }
        },
      );
    });
  });

  group('App Attest', () {
    late core.InMemorySecureStore store;
    late AppAttestAttestor attestor;
    int keys = 0;
    setUp(() {
      keys = 0;
      store = core.InMemorySecureStore();
      attestor = AppAttestAttestor(store: store);
      answer(
        (MethodCall call) => switch (call.method) {
          'appAttestGenerateKey' => 'apple/key+${++keys}==',
          'appAttestAttestKey' => Uint8List.fromList(<int>[1, 2, 3, 250]),
          'appAttestAssert' => Uint8List.fromList(<int>[9, 8, 7, 251]),
          _ => null,
        },
      );
    });

    test('register makes ONE key, keeps its id, and attests it over the '
        'clientData hash of op install, the install target and its own '
        'body', () async {
      expect(await attestor.isRegistered(app: _app), isFalse);
      expect(calls, isEmpty, reason: 'isRegistered never makes a key');

      final core.NativeAttestInstall install = await attestor.register(
        app: _app,
        challenge: _challenge,
        target: _installTarget,
      );
      expect(install.kind, 'app-attest');
      expect(
        utf8.decode(install.body),
        '{"kind":"app-attest","key_id":"apple/key+1=="}',
      );
      expect(install.proof, core.nativeAttestBase64Url(<int>[1, 2, 3, 250]));
      expect(
        await store.read(AppAttestAttestor.keyIdStoreKey),
        'apple/key+1==',
      );

      final MethodCall attest = calls.singleWhere(
        (MethodCall c) => c.method == 'appAttestAttestKey',
      );
      final Map<Object?, Object?> args =
          attest.arguments as Map<Object?, Object?>;
      expect(args['keyId'], 'apple/key+1==');
      List<int> hashFor(String target) => core.nativeAttestClientDataHash(
        core.nativeAttestClientData(
          app: _app,
          op: 'install',
          challenge: _challenge,
          target: target,
          body: install.body,
        ),
      );
      expect(args['clientDataHash'], hashFor(_installTarget));
      expect(
        args['clientDataHash'],
        isNot(hashFor('/v1/auth/native/subscriptiontracker/token')),
        reason: 'red control: the attestation is bound to the install target',
      );

      await attestor.markRegistered(app: _app);
      expect(await attestor.isRegistered(app: _app), isTrue);
      expect(
        await AppAttestAttestor(store: store).isRegistered(app: _app),
        isTrue,
        reason: 'the next launch reads it back',
      );
    });

    test('prove asserts over the op\'s clientData hash; the key header is '
        'Apple\'s id, unchanged', () async {
      await attestor.register(
        app: _app,
        challenge: _challenge,
        target: _installTarget,
      );
      calls.clear();
      final core.NativeAttestProof proof = await attestor.prove(
        clientData: _clientData,
      );
      expect(proof.kind, 'app-attest');
      expect(proof.keyId, 'apple/key+1==');
      expect(proof.proof, core.nativeAttestBase64Url(<int>[9, 8, 7, 251]));
      final Map<Object?, Object?> args =
          calls.single.arguments as Map<Object?, Object?>;
      expect(calls.single.method, 'appAttestAssert');
      expect(
        args['clientDataHash'],
        base64Url.decode('$_requestHash='),
        reason: 'the contract vector\'s clientDataHash',
      );
    });

    test('forget drops the registration AND the key: the next registration '
        'attests a new one', () async {
      await attestor.register(
        app: _app,
        challenge: _challenge,
        target: _installTarget,
      );
      await attestor.markRegistered(app: _app);
      await attestor.forget(app: _app);
      expect(await attestor.isRegistered(app: _app), isFalse);
      expect(await store.read(AppAttestAttestor.keyIdStoreKey), isNull);
      final core.NativeAttestInstall again = await attestor.register(
        app: _app,
        challenge: _challenge,
        target: _installTarget,
      );
      expect(utf8.decode(again.body), contains('apple/key+2=='));
    });

    test('🔴 an attest failure throws and discards the key', () async {
      answer((MethodCall call) {
        if (call.method == 'appAttestGenerateKey') return 'k1';
        throw PlatformException(code: 'attest_failed');
      });
      await expectLater(
        attestor.register(
          app: _app,
          challenge: _challenge,
          target: _installTarget,
        ),
        throwsAttest('attest_failed'),
      );
      expect(await store.read(AppAttestAttestor.keyIdStoreKey), isNull);
    });

    test(
      '🔴 an assertion failure, an empty answer or no native side throws',
      () async {
        await store.write(AppAttestAttestor.keyIdStoreKey, 'k1');
        answer((_) => throw PlatformException(code: 'assert_failed'));
        await expectLater(
          attestor.prove(clientData: _clientData),
          throwsAttest('assert_failed'),
        );
        answer((_) => Uint8List(0));
        await expectLater(
          attestor.prove(clientData: _clientData),
          throwsAttest('no_bytes'),
        );
        messenger.setMockMethodCallHandler(nativeAttestChannel, null);
        await expectLater(
          attestor.prove(clientData: _clientData),
          throwsAttest('channel_failed'),
        );
      },
    );
  });

  group('App Attest where supported, else the install key', () {
    AppAttestOrInstallKeyAttestor build(core.SecureStore store) =>
        AppAttestOrInstallKeyAttestor(
          appAttest: AppAttestAttestor(store: store),
          installKey: core.InstallKeyAttestor(store: store),
        );

    test('supported → app-attest', () async {
      answer(
        (MethodCall call) => switch (call.method) {
          'appAttestSupported' => true,
          'appAttestGenerateKey' => 'k1',
          'appAttestAssert' => Uint8List.fromList(<int>[1]),
          _ => null,
        },
      );
      final AppAttestOrInstallKeyAttestor a = build(core.InMemorySecureStore());
      final core.NativeAttestProof proof = await a.prove(
        clientData: _clientData,
      );
      expect(proof.kind, 'app-attest');
      expect(a.kind, 'app-attest');
      expect(a.chosen, isA<AppAttestAttestor>());
    });

    test('unsupported (iOS 13, a simulator) → install-key', () async {
      answer(
        (MethodCall call) => call.method == 'appAttestSupported'
            ? false
            : throw StateError('App Attest must not be touched'),
      );
      final AppAttestOrInstallKeyAttestor a = build(core.InMemorySecureStore());
      final core.NativeAttestProof proof = await a.prove(
        clientData: _clientData,
      );
      expect(proof.kind, 'install-key');
      expect(a.kind, 'install-key');
    });

    test(
      'register hands the install target to the attestor it chose',
      () async {
        answer((MethodCall call) => false);
        final core.InMemorySecureStore store = core.InMemorySecureStore();
        final core.NativeAttestInstall install = await build(
          store,
        ).register(app: _app, challenge: _challenge, target: _installTarget);
        expect(install.kind, 'install-key');
        // Ed25519 is deterministic: the same key over the same clientData is
        // the same proof, and over another target another one.
        final core.InstallKeyAttestor same = core.InstallKeyAttestor(
          store: store,
        );
        expect(
          install.proof,
          (await same.register(
            app: _app,
            challenge: _challenge,
            target: _installTarget,
          )).proof,
        );
        expect(
          install.proof,
          isNot(
            (await same.register(
              app: _app,
              challenge: _challenge,
              target: '/v1/auth/native/subscriptiontracker/token',
            )).proof,
          ),
        );
      },
    );

    test('no native side (macos today) → install-key', () async {
      final AppAttestOrInstallKeyAttestor a = build(core.InMemorySecureStore());
      expect((await a.prove(clientData: _clientData)).kind, 'install-key');
    });

    test('the choice is made once', () async {
      answer((MethodCall call) => false);
      final AppAttestOrInstallKeyAttestor a = build(core.InMemorySecureStore());
      await a.isRegistered(app: _app);
      await a.prove(clientData: _clientData);
      expect(
        calls.where((MethodCall c) => c.method == 'appAttestSupported'),
        hasLength(1),
      );
    });
  });

  group('platformNativeAttestor — every target', () {
    final core.InMemorySecureStore store = core.InMemorySecureStore();
    core.NativeAttestor? on(TargetPlatform p, {bool isWeb = false}) =>
        platformNativeAttestor(secureStore: store, platform: p, isWeb: isWeb);

    test('web: none', () {
      for (final TargetPlatform p in TargetPlatform.values) {
        expect(on(p, isWeb: true), isNull, reason: '$p');
      }
    });
    test('android: Play Integrity', () {
      expect(on(TargetPlatform.android), isA<PlayIntegrityAttestor>());
    });
    test('ios and macos: App Attest where supported, else the install key', () {
      expect(on(TargetPlatform.iOS), isA<AppAttestOrInstallKeyAttestor>());
      expect(on(TargetPlatform.macOS), isA<AppAttestOrInstallKeyAttestor>());
    });
    test('windows and linux: the install key', () {
      expect(on(TargetPlatform.windows), isA<core.InstallKeyAttestor>());
      expect(on(TargetPlatform.linux), isA<core.InstallKeyAttestor>());
    });
    test('fuchsia: none', () {
      expect(on(TargetPlatform.fuchsia), isNull);
    });
  });

  // The Kotlin and Swift cannot be compiled on the Windows host, and a channel
  // nobody registered answers MissingPluginException — which on android is a
  // sign-in that fails for everyone. So the native half of the channel contract
  // is read here: the one pluginClass registers the handler, on this channel,
  // and the handler answers every method name the Dart side calls.
  group('the native sources answer what the Dart side calls', () {
    const String kotlinDir =
        'android/src/main/kotlin/com/nikatru/platform_storage';
    const String swiftDir =
        'ios/nikatru_platform_storage/Sources/nikatru_platform_storage';
    String read(String path) => File(path).readAsStringSync();

    test('android: AgeSignalsPlugin registers NativeAttestHandler on '
        'nikatru/native_attest, which answers playIntegrityToken', () {
      final String plugin = read('$kotlinDir/AgeSignalsPlugin.kt');
      expect(
        plugin,
        contains(
          'MethodChannel(binding.binaryMessenger, "nikatru/native_attest")',
        ),
      );
      expect(
        plugin,
        contains(
          'setMethodCallHandler(NativeAttestHandler(binding.applicationContext))',
        ),
      );
      final String handler = read('$kotlinDir/NativeAttestHandler.kt');
      expect(handler, contains('"playIntegrityToken"'));
      expect(handler, contains('call.argument<String>("nonce")'));
      expect(handler, contains('call.argument<Number>("cloudProjectNumber")'));
    });

    test('ios: AgeSignalsPlugin registers NativeAttestPlugin, which answers '
        'the four App Attest methods on nikatru/native_attest', () {
      expect(
        read('$swiftDir/AgeSignalsPlugin.swift'),
        contains('NativeAttestPlugin.register(with: registrar)'),
      );
      final String swift = read('$swiftDir/NativeAttestPlugin.swift');
      expect(swift, contains('name: "nikatru/native_attest"'));
      for (final String method in <String>[
        'appAttestSupported',
        'appAttestGenerateKey',
        'appAttestAttestKey',
        'appAttestAssert',
      ]) {
        expect(swift, contains('case "$method":'), reason: method);
      }
      expect(swift, contains('args["keyId"]'));
      expect(swift, contains('args["clientDataHash"]'));
    });

    test('neither logs nor stores what it handles', () {
      final RegExp forbidden = RegExp(
        r'\bLog\.|\bprintln\(|\bprint\(|\bNSLog\(|\bos_log\(|\bLogger\(|'
        r'SharedPreferences|UserDefaults|FileOutputStream|\bwrite\(to',
      );
      for (final String path in <String>[
        '$kotlinDir/NativeAttestHandler.kt',
        '$swiftDir/NativeAttestPlugin.swift',
      ]) {
        final String code = read(path)
            .split('\n')
            .where((String l) => !RegExp(r'^\s*(//|\*|/\*\*)').hasMatch(l))
            .join('\n');
        expect(
          forbidden.hasMatch(code),
          isFalse,
          reason: '$path: ${forbidden.firstMatch(code)?.group(0)}',
        );
      }
    });
  });
}
