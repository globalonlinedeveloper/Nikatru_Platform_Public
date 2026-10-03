// Runs around EVERY test file under apps/subscriptiontracker/test (Flutter
// picks up the nearest flutter_test_config.dart and calls [testExecutable]).
//
// With `NIKATRU_TEST_NOW` unset — every pull request, every local run — the
// clock is untouched. With it set, `wallClock` (the seam behind
// `nowProvider`) starts at that instant, so the weekly time-travel run executes
// this suite on another day. See test/support/test_clock.dart.

import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/test_clock.dart';

/// ⏱ 2026-10-02 · review of #1155, finding 5 — THE KEYCHAIN ANSWERS IN TESTS.
///
/// The app lock now covers the app until the secure store has ANSWERED (a cold
/// start must not paint the content before it knows whether the lock is on).
/// A widget test that mounts the real `SublyApp` builds the real
/// `FlutterSecureStore`, whose plugin channel has no handler under
/// `flutter test` — so its read never completed, the cover never lifted, and
/// every whole-app test tapped a cover. This answers that channel as an EMPTY
/// keychain that keeps what is written to it for the test: the state of a
/// fresh install, which is what those tests describe. A test that needs another
/// store still overrides `secureStoreProvider`, as before.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  installTestClock(Platform.environment);
  TestWidgetsFlutterBinding.ensureInitialized();
  final Map<String, String> keychain = <String, String>{};
  setUp(keychain.clear);
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
        const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
        (MethodCall call) async {
          final Map<Object?, Object?> args =
              (call.arguments as Map<Object?, Object?>?) ??
              const <Object?, Object?>{};
          final String? key = args['key'] as String?;
          switch (call.method) {
            case 'read':
              return keychain[key];
            case 'write':
              keychain[key!] = args['value']! as String;
              return null;
            case 'delete':
              keychain.remove(key);
              return null;
            case 'deleteAll':
              keychain.clear();
              return null;
            case 'containsKey':
              return keychain.containsKey(key);
            case 'readAll':
              return Map<String, String>.of(keychain);
          }
          return null;
        },
      );
  await testMain();
}
