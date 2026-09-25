import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ⏱ 2026-09-24 · O-GOOGLE-SIGN-IN-NOT-BUILT — THE KEEPER NAMES THE PROVIDER.
///
/// The server keeps one token row per (account, provider) and revokes each at
/// its own provider on deletion, so a token handed over under the WRONG name is
/// revoked at the wrong provider — which refuses, and the deletion never
/// finishes. What is proven here is the name the keeper hands [send]; where the
/// app then sends it is proven in the app's own keeper test.
class _SessionAuth extends AuthRepository {
  final StreamController<AuthUser?> users =
      StreamController<AuthUser?>.broadcast();

  /// The session [currentSession] hands back.
  AuthSession? session;

  @override
  Stream<AuthUser?> authStateChanges() => users.stream;

  @override
  Future<AuthSession?> currentSession() async => session;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const AuthUser _signedIn = AuthUser(id: 'u1', email: 'a@b.test');

void main() {
  group('keepProviderRefreshToken', () {
    test('a Google session hands send the provider google', () async {
      final List<String> sent = <String>[];
      final _SessionAuth auth = _SessionAuth()
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
      auth.users.add(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['google:google-refresh-1']);
    });

    test('an Apple session hands send the provider apple', () async {
      final List<String> sent = <String>[];
      final _SessionAuth auth = _SessionAuth()
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
      auth.users.add(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['apple:apple-refresh-1']);
    });

    test('a session that names no provider is Apple, as it always was',
        () async {
      final List<String> sent = <String>[];
      final _SessionAuth auth = _SessionAuth()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'apple-refresh-1',
        );
      final StreamSubscription<AuthUser?> sub = keepProviderRefreshToken(
        auth: auth,
        send: (String p, String t) async => sent.add('$p:$t'),
      );
      addTearDown(sub.cancel);
      auth.users.add(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['apple:apple-refresh-1']);
    });

    test('a round that gave up names the provider and never the token',
        () async {
      final List<Object> errors = <Object>[];
      final _SessionAuth auth = _SessionAuth()
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
      auth.users.add(_signedIn);
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
      final _SessionAuth auth = _SessionAuth()
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
      auth.users.add(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent, isEmpty);
    });

    test('still sends an Apple token exactly as before', () async {
      final List<String> sent = <String>[];
      final _SessionAuth auth = _SessionAuth()
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
      auth.users.add(_signedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['apple-refresh-1']);
    });
  });
}
