import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// ⏱ 2026-10-01 · train ST-account-plus — the adapter halves of EN-21 (e-mail
/// one-time code) and SE-04 (linked sign-in methods), on a REAL `GoTrueClient`
/// over a [MockClient]. EN-22 (Retry-After) landed on main first (#1122,
/// `RetryAfterLatch`) and is tested there.
void main() {
  /// One answer per path; every request is recorded.
  ({SupabaseAuthRepository repo, List<http.Request> seen}) build(
    http.Response Function(http.Request r) answer,
  ) {
    final List<http.Request> seen = <http.Request>[];
    final MockClient transport = MockClient((http.Request r) async {
      seen.add(r);
      return answer(r);
    });
    final sb.GoTrueClient client = sb.GoTrueClient(
      url: 'https://auth.example.test',
      autoRefreshToken: false,
      httpClient: transport,
      flowType: sb.AuthFlowType.implicit,
    );
    return (
      repo: SupabaseAuthRepository(client: client),
      seen: seen,
    );
  }

  http.Response refusal(
    int status,
    String code,
    String msg, {
    Map<String, String> headers = const <String, String>{},
  }) => http.Response(
    jsonEncode(<String, Object>{'code': code, 'error_code': code, 'msg': msg}),
    status,
    headers: <String, String>{'content-type': 'application/json', ...headers},
  );

  group('EN-21 · the e-mail one-time code', () {
    test('a send asks /otp NEVER to create an account', () async {
      final ({SupabaseAuthRepository repo, List<http.Request> seen}) h = build(
        (_) => http.Response('{}', 200),
      );
      await h.repo.sendEmailCode('a@example.com', captchaToken: 'tok');
      final http.Request otp = h.seen.single;
      expect(otp.url.path, endsWith('/otp'));
      final Map<String, Object?> body =
          jsonDecode(otp.body) as Map<String, Object?>;
      expect(body['email'], 'a@example.com');
      expect(body['create_user'], isFalse);
      expect(
        (body['gotrue_meta_security']
            as Map<String, Object?>?)?['captcha_token'],
        'tok',
      );
    });

    test(
      '🔴 an address with no account answers exactly like one with',
      () async {
        final ({SupabaseAuthRepository repo, List<http.Request> seen}) h =
            build(
              (_) =>
                  refusal(422, 'otp_disabled', 'Signups not allowed for otp'),
            );
        // Returns, as a real send does: no account oracle.
        await h.repo.sendEmailCode('nobody@example.com');
        expect(h.seen, hasLength(1));
      },
    );

    test(
      'a captcha refusal is NOT swallowed — it is not about the address',
      () async {
        final ({SupabaseAuthRepository repo, List<http.Request> seen}) h =
            build((_) => refusal(400, 'captcha_failed', 'captcha protection'));
        await expectLater(
          h.repo.sendEmailCode('a@example.com'),
          throwsA(
            isA<core.AuthFailure>().having(
              (core.AuthFailure f) => f.code,
              'code',
              'captcha_failed',
            ),
          ),
        );
      },
    );

    test(
      '🔴 a wrong code refuses with otp_expired and signs nobody in',
      () async {
        final ({SupabaseAuthRepository repo, List<http.Request> seen}) h =
            build(
              (_) => refusal(
                403,
                'otp_expired',
                'Token has expired or is invalid',
              ),
            );
        await expectLater(
          h.repo.verifyEmailCode(email: 'a@example.com', code: '000000'),
          throwsA(
            isA<core.AuthFailure>().having(
              (core.AuthFailure f) => f.code,
              'code',
              core.AuthFailure.codeInvalid,
            ),
          ),
        );
        expect(h.repo.currentUser, isNull);
        final Map<String, Object?> body =
            jsonDecode(h.seen.single.body) as Map<String, Object?>;
        expect(h.seen.single.url.path, endsWith('/verify'));
        expect(body['type'], 'email');
        expect(body['token'], '000000');
      },
    );

    test('only a build that can reach /otp offers it', () {
      expect(SupabaseAuthRepository().emailCodeAvailable, isTrue);
      expect(
        SupabaseAuthRepository(
          nativeCredentials: sb.GoTrueClient(autoRefreshToken: false),
        ).emailCodeAvailable,
        isFalse,
      );
    });

    test('the no-account refusals, and nothing else', () {
      expect(
        SupabaseAuthRepository.isNoAccountRefusal('otp_disabled', ''),
        isTrue,
      );
      expect(
        SupabaseAuthRepository.isNoAccountRefusal(
          null,
          'Signups not allowed for otp',
        ),
        isTrue,
      );
      expect(
        SupabaseAuthRepository.isNoAccountRefusal(
          'over_email_send_rate_limit',
          'email rate limit exceeded',
        ),
        isFalse,
      );
    });
  });

  group('SE-04 · linked sign-in methods', () {
    test(
      '🔴 unlinking with no second method is refused before any request',
      () async {
        final ({SupabaseAuthRepository repo, List<http.Request> seen}) h =
            build((_) => http.Response('{}', 200));
        await expectLater(
          h.repo.unlinkIdentity(core.SignInMethod.apple),
          throwsA(
            isA<core.AuthFailure>().having(
              (core.AuthFailure f) => f.code,
              'code',
              core.AuthFailure.lastSignInMethod,
            ),
          ),
        );
        expect(h.seen, isEmpty);
      },
    );

    test('the in-memory identity: refuses the last, drops a second', () async {
      final InMemoryAuthRepository mem = InMemoryAuthRepository();
      await mem.signInWithApple();
      // The demo Apple user still reads as holding a password (the model's
      // default), so Apple is NOT its last method — unlinking it works...
      final core.AuthUser after = await mem.unlinkIdentity(
        core.SignInMethod.apple,
      );
      expect(after.oauthProviders, isEmpty);
      expect(core.signInMethodsOf(after), <core.SignInMethod>[
        core.SignInMethod.password,
      ]);
      // ...and with nothing else linked, nothing more can go.
      await expectLater(
        mem.unlinkIdentity(core.SignInMethod.apple),
        throwsA(isA<core.AuthFailure>()),
      );
      await expectLater(
        mem.unlinkIdentity(core.SignInMethod.password),
        throwsA(
          isA<core.AuthFailure>().having(
            (core.AuthFailure f) => f.code,
            'code',
            core.AuthFailure.lastSignInMethod,
          ),
        ),
      );
      await mem.dispose();
    });

    test(
      'the in-memory code: the right one signs in, a wrong one refuses',
      () async {
        final InMemoryAuthRepository mem = InMemoryAuthRepository();
        expect(mem.emailCodeAvailable, isTrue);
        await expectLater(
          mem.verifyEmailCode(
            email: 'a@example.com',
            code: InMemoryAuthRepository.emailCode,
          ),
          throwsA(isA<core.AuthFailure>()),
          reason: 'no code was sent to this address',
        );
        await mem.sendEmailCode('a@example.com', captchaToken: 't');
        expect(mem.lastCaptchaToken, 't');
        await expectLater(
          mem.verifyEmailCode(email: 'a@example.com', code: '000000'),
          throwsA(
            isA<core.AuthFailure>().having(
              (core.AuthFailure f) => f.code,
              'code',
              core.AuthFailure.codeInvalid,
            ),
          ),
        );
        final core.AuthUser u = await mem.verifyEmailCode(
          email: 'a@example.com',
          code: InMemoryAuthRepository.emailCode,
        );
        expect(u.email, 'a@example.com');
        await mem.dispose();
      },
    );
  });
}
