import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// A sheet that answers as a fixture says: a token, a cancel (null) or a throw.
class _Sheet implements NativeSignInSheet {
  _Sheet({this.token, this.boom});
  final NativeIdToken? token;
  final Object? boom;
  int shown = 0;

  @override
  Future<NativeIdToken?> obtain() async {
    shown++;
    final Object? b = boom;
    if (b != null) throw b;
    return token;
  }
}

/// Records the two GoTrue doors. `signInWithOAuth` is a supabase_flutter
/// EXTENSION on GoTrueClient and cannot be overridden; its first act is
/// `getOAuthSignInUrl`, so a browser launch is observable — and refused —
/// here.
class _GoTrue extends sb.GoTrueClient {
  _GoTrue({this.idTokenError, this.session}) : super(autoRefreshToken: false);

  final sb.AuthException? idTokenError;

  /// The session `signInWithIdToken` lands, and `currentSession` then holds.
  sb.Session? session;
  sb.Session? _current;

  @override
  sb.Session? get currentSession => _current;

  @override
  Future<void> signOut({sb.SignOutScope scope = sb.SignOutScope.local}) async {
    _current = null;
  }
  final List<Map<String, Object?>> idTokenCalls = <Map<String, Object?>>[];
  int browserLaunches = 0;

  @override
  Future<sb.AuthResponse> signInWithIdToken({
    required sb.OAuthProvider provider,
    required String idToken,
    String? accessToken,
    String? nonce,
    String? captchaToken,
  }) async {
    idTokenCalls.add(<String, Object?>{
      'provider': provider,
      'idToken': idToken,
      'nonce': nonce,
    });
    final sb.AuthException? e = idTokenError;
    if (e != null) throw e;
    _current = session;
    return sb.AuthResponse(session: session);
  }

  @override
  Future<sb.OAuthResponse> getOAuthSignInUrl({
    required sb.OAuthProvider provider,
    String? redirectTo,
    String? scopes,
    Map<String, String>? queryParams,
  }) async {
    browserLaunches++;
    throw StateError('the browser door was taken');
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('RED CONTROL: the native path never opens a browser', () {
    test(
      'Apple: the sheet token goes to signInWithIdToken with the raw nonce',
      () async {
        final _GoTrue gotrue = _GoTrue();
        final _Sheet apple = _Sheet(
          token: const NativeIdToken(idToken: 'apple.jwt', rawNonce: 'raw-n'),
        );
        await SupabaseAuthRepository(
          client: gotrue,
          nativeSheets: NativeSignInSheets(apple: apple),
        ).signInWithApple();
        expect(apple.shown, 1);
        expect(gotrue.browserLaunches, 0);
        expect(gotrue.idTokenCalls.single, <String, Object?>{
          'provider': sb.OAuthProvider.apple,
          'idToken': 'apple.jwt',
          'nonce': 'raw-n',
        });
      },
    );

    test('Google: the sheet token goes to signInWithIdToken', () async {
      final _GoTrue gotrue = _GoTrue();
      await SupabaseAuthRepository(
        client: gotrue,
        nativeSheets: NativeSignInSheets(
          google: _Sheet(token: const NativeIdToken(idToken: 'g.jwt')),
        ),
      ).signInWithGoogle();
      expect(gotrue.browserLaunches, 0);
      expect(gotrue.idTokenCalls.single['provider'], sb.OAuthProvider.google);
      expect(gotrue.idTokenCalls.single['nonce'], isNull);
    });
  });

  group('⏱ 2026-10-02 · #1155 review, finding 1: the Apple code reaches the '
      'session', () {
    sb.Session sessionFor(String id) => sb.Session(
      accessToken: 'at',
      tokenType: 'bearer',
      user: sb.User(
        id: id,
        appMetadata: const <String, dynamic>{},
        userMetadata: const <String, dynamic>{},
        aud: 'authenticated',
        createdAt: '2026-10-02T00:00:00Z',
      ),
    );

    test(
      'RED CONTROL: a native Apple sign-in session carries the sheet code, '
      'for the keeper to exchange; a sign-out forgets it',
      () async {
        final _GoTrue gotrue = _GoTrue(session: sessionFor('u-native'));
        final SupabaseAuthRepository repo = SupabaseAuthRepository(
          client: gotrue,
          nativeSheets: NativeSignInSheets(
            apple: _Sheet(
              token: const NativeIdToken(
                idToken: 'apple.jwt',
                rawNonce: 'raw-n',
                authorizationCode: 'c.native-code',
              ),
            ),
          ),
        );
        await repo.signInWithApple();
        final core.AuthSession? s = await repo.currentSession();
        expect(s?.providerAuthorizationCode, 'c.native-code');
        expect(s?.oauthProvider, 'apple');
        expect(s?.providerRefreshToken, isNull);

        await repo.signOut();
        gotrue.session = sessionFor('u-native');
        // Signed back in by another door: the old code is not offered again.
        await gotrue.signInWithIdToken(
          provider: sb.OAuthProvider.google,
          idToken: 'g.jwt',
        );
        expect((await repo.currentSession())?.providerAuthorizationCode, isNull);
      },
    );

    test('a Google sheet never carries a code', () async {
      final _GoTrue gotrue = _GoTrue(session: sessionFor('u-g'));
      final SupabaseAuthRepository repo = SupabaseAuthRepository(
        client: gotrue,
        nativeSheets: NativeSignInSheets(
          google: _Sheet(
            token: const NativeIdToken(
              idToken: 'g.jwt',
              authorizationCode: 'not-apple',
            ),
          ),
        ),
      );
      await repo.signInWithGoogle();
      expect((await repo.currentSession())?.providerAuthorizationCode, isNull);
    });
  });

  group('RED CONTROL: a cancelled sheet returns quietly to sign-in', () {
    test('no throw, no session call, no browser', () async {
      final _GoTrue gotrue = _GoTrue();
      final SupabaseAuthRepository repo = SupabaseAuthRepository(
        client: gotrue,
        nativeSheets: NativeSignInSheets(apple: _Sheet(), google: _Sheet()),
      );
      await repo.signInWithApple();
      await repo.signInWithGoogle();
      expect(gotrue.idTokenCalls, isEmpty);
      expect(gotrue.browserLaunches, 0);
    });
  });

  test(
    'a sheet that fails leaves as AuthFailure, never the vendor type',
    () async {
      final SupabaseAuthRepository repo = SupabaseAuthRepository(
        client: _GoTrue(),
        nativeSheets: NativeSignInSheets(
          apple: _Sheet(boom: Exception('someone@example.com not allowed')),
        ),
      );
      await expectLater(
        repo.signInWithApple(),
        throwsA(
          isA<core.AuthFailure>()
              .having(
                (core.AuthFailure f) => f.code,
                'code',
                'native_sheet_failed',
              )
              .having(
                (core.AuthFailure f) => f.message,
                'message',
                isNot(contains('@')),
              ),
        ),
      );
    },
  );

  test(
    'GoTrue refusing the ID token is mapped like every other refusal',
    () async {
      final SupabaseAuthRepository repo = SupabaseAuthRepository(
        client: _GoTrue(
          idTokenError: const sb.AuthException(
            'bad id token',
            statusCode: '400',
          ),
        ),
        nativeSheets: NativeSignInSheets(
          google: _Sheet(token: const NativeIdToken(idToken: 'g.jwt')),
        ),
      );
      await expectLater(
        repo.signInWithGoogle(),
        throwsA(isA<core.AuthFailure>()),
      );
    },
  );

  test('with no sheet the browser door is still the one taken', () async {
    final _GoTrue gotrue = _GoTrue();
    await expectLater(
      SupabaseAuthRepository(client: gotrue).signInWithApple(),
      throwsA(isA<StateError>()),
    );
    expect(gotrue.browserLaunches, 1);
    expect(gotrue.idTokenCalls, isEmpty);
  });

  group('which targets get a sheet', () {
    NativeSignInSheets of(TargetPlatform p, {bool web = false}) =>
        NativeSignInSheets.forPlatform(p, isWeb: web);

    test('Apple on iOS and macOS only', () {
      expect(of(TargetPlatform.iOS).apple, isNotNull);
      expect(of(TargetPlatform.macOS).apple, isNotNull);
      expect(of(TargetPlatform.android).apple, isNull);
      expect(of(TargetPlatform.windows).apple, isNull);
      expect(of(TargetPlatform.linux).apple, isNull);
    });

    test(
      'Google keeps the browser door on every target until its sheet lands',
      () {
        for (final TargetPlatform p in TargetPlatform.values) {
          expect(of(p).google, isNull, reason: '$p');
        }
      },
    );

    test('web, Windows and Linux keep the PKCE browser door', () {
      for (final NativeSignInSheets s in <NativeSignInSheets>[
        of(TargetPlatform.iOS, web: true),
        of(TargetPlatform.windows),
        of(TargetPlatform.linux),
      ]) {
        expect(s.apple, isNull);
        expect(s.google, isNull);
      }
    });
  });
}
