import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_core/testing.dart';
import 'package:test/test.dart';

const AuthUser _signedIn = AuthUser(id: 'u1', email: 'a@b.test');

void main() {
  group('keepProviderRefreshToken', () {
    test('a Google session hands send the provider google', () async {
      final List<String> sent = <String>[];
      final FakeAuthRepository auth = FakeAuthRepository()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'google-refresh-1',
          oauthProvider: 'google',
        );
      final StreamSubscription<AuthUser?> sub = keepProviderRefreshToken(
        auth: auth,
        send: (String p, String t) async => sent.add('$p:$t'),
      );
      addTearDown(sub.cancel);
      auth.emit(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['google:google-refresh-1']);
    });

    test('an Apple session hands send the provider apple', () async {
      final List<String> sent = <String>[];
      final FakeAuthRepository auth = FakeAuthRepository()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'apple-refresh-1',
          oauthProvider: 'apple',
        );
      final StreamSubscription<AuthUser?> sub = keepProviderRefreshToken(
        auth: auth,
        send: (String p, String t) async => sent.add('$p:$t'),
      );
      addTearDown(sub.cancel);
      auth.emit(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['apple:apple-refresh-1']);
    });

    test('a session that names no provider is Apple, as it always was',
        () async {
      final List<String> sent = <String>[];
      final FakeAuthRepository auth = FakeAuthRepository()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'apple-refresh-1',
        );
      final StreamSubscription<AuthUser?> sub = keepProviderRefreshToken(
        auth: auth,
        send: (String p, String t) async => sent.add('$p:$t'),
      );
      addTearDown(sub.cancel);
      auth.emit(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['apple:apple-refresh-1']);
    });

    test('a round that gave up names the provider and never the token',
        () async {
      final List<Object> errors = <Object>[];
      final FakeAuthRepository auth = FakeAuthRepository()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'google-refresh-1',
          oauthProvider: 'google',
        );
      final StreamSubscription<AuthUser?> sub = keepProviderRefreshToken(
        auth: auth,
        send: (String p, String t) async =>
            throw StateError('refused google-refresh-1'),
        onError: errors.add,
        retryDelays: const <Duration>[],
      );
      addTearDown(sub.cancel);
      auth.emit(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(errors, hasLength(1));
      final ProviderTokenNotKept report = errors.single as ProviderTokenNotKept;
      expect(report.provider, 'google');
      expect(report.attempts, 1);
      expect(report.toString(), isNot(contains('google-refresh-1')));
      final String text = providerTokenNotKeptReport(report);
      expect(text, contains('provider: google'));
      expect(text, contains('attempts: 1'));
      expect(text, isNot(contains('google-refresh-1')));
    });
  });

  group('keepAppleRefreshToken, the Apple-only name', () {
    test('is never offered a Google token', () async {
      final List<String> sent = <String>[];
      final FakeAuthRepository auth = FakeAuthRepository()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'google-refresh-1',
          oauthProvider: 'google',
        );
      final StreamSubscription<AuthUser?> sub = keepAppleRefreshToken(
        auth: auth,
        send: (String t) async => sent.add(t),
      );
      addTearDown(sub.cancel);
      auth.emit(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent, isEmpty);
    });

    test('still sends an Apple token exactly as before', () async {
      final List<String> sent = <String>[];
      final FakeAuthRepository auth = FakeAuthRepository()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'apple-refresh-1',
          oauthProvider: 'apple',
        );
      final StreamSubscription<AuthUser?> sub = keepAppleRefreshToken(
        auth: auth,
        send: (String t) async => sent.add(t),
      );
      addTearDown(sub.cancel);
      auth.emit(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['apple-refresh-1']);
    });
  });
}
