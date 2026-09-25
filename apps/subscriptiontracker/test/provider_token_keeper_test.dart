import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
// Narrowed: Subly's own data layer declares names of its own.
import 'package:nikatru_api_client/nikatru_api_client.dart' show RestClient;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';

// ⏱ 2026-09-24 · O-GOOGLE-SIGN-IN-NOT-BUILT — WHERE THIS APP SENDS EACH
// PROVIDER'S TOKEN, driven through the REAL `appleTokenKeeperProvider`.
//
// The shared Worker revokes each stored token at its own provider when the
// account is deleted. A Google token sent to `/account/apple-token` is stored
// as Apple's (or refused, for an account that never linked Apple), and either
// way the deletion cannot revoke it at Google. So the assertion is the REQUEST
// this app put on the wire — its path and its body — never only that one was
// made. Apple's request is asserted unchanged beside it.
//
// It makes no network call: the platform REST client is built on a recording
// dio adapter, and the retry list is empty so a failure would be the last one.

/// Records every request and answers the route's 200 `{ok, stored}`.
class _RecordingAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromString(
      '{"ok":true,"stored":1}',
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

/// A signed-in account whose session carries a provider token, naming
/// [provider] as its issuer (null: the session names none).
class _SignInAuth extends MockAuthRepository {
  _SignInAuth(this.token, this.provider);

  final String token;
  final String? provider;
  final StreamController<core.AuthUser?> _users =
      StreamController<core.AuthUser?>.broadcast();

  /// The sign-in landing — the one moment the token is ever offered.
  void arrive() => _users.add(const core.AuthUser(id: 'u1', email: 'a@b.test'));

  @override
  Stream<core.AuthUser?> authStateChanges() => _users.stream;

  @override
  Future<core.AuthSession?> currentSession() async => core.AuthSession(
    accessToken: 'at',
    providerRefreshToken: token,
    oauthProvider: provider,
  );
}

ProviderContainer _keeper(_SignInAuth auth, _RecordingAdapter adapter) {
  final RestClient client = RestClient(
    baseUrl: 'https://platform.test/v1',
    tokenProvider: () async => 'bearer',
    httpClient: Dio()..httpClientAdapter = adapter,
  );
  return ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith(
        (Ref ref) async => core.InMemoryKeyValueStore(),
      ),
      authRepositoryProvider.overrideWithValue(auth),
      platformRestClientProvider.overrideWithValue(client),
      appleTokenRetryDelaysProvider.overrideWithValue(const <Duration>[]),
    ],
  );
}

/// Subscribes the keeper as the root widget does, lands the sign-in, and
/// returns the one request it made.
Future<RequestOptions> _signIn(_SignInAuth auth) async {
  final _RecordingAdapter adapter = _RecordingAdapter();
  final ProviderContainer c = _keeper(auth, adapter);
  addTearDown(c.dispose);
  c.read(appleTokenKeeperProvider);
  auth.arrive();
  await pumpEventQueue();
  expect(adapter.requests, hasLength(1));
  return adapter.requests.single;
}

void main() {
  group('appleTokenKeeperProvider sends each token to its route', () {
    test('🔴 a Google sign-in PUTs /account/provider-token', () async {
      final _SignInAuth auth = _SignInAuth('google-refresh-1', 'google');
      final RequestOptions put = await _signIn(auth);
      expect(put.method, 'PUT');
      expect(put.path, '/account/provider-token');
      final Map<String, Object?> sent = put.data as Map<String, Object?>;
      expect(sent['provider'], 'google');
      expect(sent['refreshToken'], 'google-refresh-1');
      expect(sent['appId'], AppConfig.appId);
      expect(sent, hasLength(3));
    });

    test('Apple is unchanged: PUT /account/apple-token', () async {
      final _SignInAuth auth = _SignInAuth('apple-refresh-1', 'apple');
      final RequestOptions put = await _signIn(auth);
      expect(put.method, 'PUT');
      expect(put.path, '/account/apple-token');
      final Map<String, Object?> sent = put.data as Map<String, Object?>;
      expect(sent['refreshToken'], 'apple-refresh-1');
      expect(sent['appId'], AppConfig.appId);
      expect(sent, hasLength(2));
    });

    test('a session naming no provider is sent as Apple', () async {
      final _SignInAuth auth = _SignInAuth('apple-refresh-1', null);
      final RequestOptions put = await _signIn(auth);
      expect(put.path, '/account/apple-token');
    });
  });
}
