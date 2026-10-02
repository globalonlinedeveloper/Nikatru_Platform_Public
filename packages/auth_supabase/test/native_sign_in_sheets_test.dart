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
  _GoTrue({this.idTokenError}) : super(autoRefreshToken: false);

  final sb.AuthException? idTokenError;
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
    return sb.AuthResponse();
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
