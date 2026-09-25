import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/auth_error_text.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/raw_vendor_error.dart';

/// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
/// `_friendlyMessage` shipped with NO test enumerating its branches — the two
/// incidental assertions in `login_chassis_parity_test.dart` cover exactly two
/// of them, as a side effect of testing something else. So a branch could be
/// deleted, reordered, or made unreachable and nothing would say so.
///
/// ⏱ 2026-09-24 — moved here with the mapper, which is now the ONE copy every
/// auth screen calls: the app's four and the chassis views. The real vendor
/// types stay pinned in `apps/subscriptiontracker/test/auth_error_vendor_test.dart`,
/// because this package may not import the SDK even in a test.
void main() {
  final ChassisLocalizations en =
      lookupChassisLocalizations(const Locale('en'));
  final ChassisLocalizations ta =
      lookupChassisLocalizations(const Locale('ta'));

  /// The shape the adapters really hand over: `AuthFailure.toString()` is
  /// `'AuthFailure: <server message>'`, so every sentence match runs against
  /// that prefix, not against a bare code. NO machine code — this is the
  /// FALLBACK path.
  core.AuthFailure fail(String serverMessage) =>
      core.AuthFailure(serverMessage);

  /// What `packages/auth_supabase` builds since 2026-09-24: GoTrue's code and
  /// reasons beside its English.
  core.AuthFailure coded(
    String code, {
    String message = 'the server said no',
    List<String> reasons = const <String>[],
  }) =>
      core.AuthFailure(message, code: code, reasons: reasons);

  core.AuthFailure weak(List<String> reasons, {String? message}) => coded(
        core.AuthFailure.weakPassword,
        message: message ?? 'Password is known to be weak and easy to guess.',
        reasons: reasons,
      );

  group('🔴 a weak password is mapped by REASON — one case per reason', () {
    test(
      'pwned → passwordBreached',
      () => expect(
        authErrorText(en, weak(<String>[core.AuthFailure.reasonPwned])),
        en.passwordBreached,
      ),
    );
    test(
      'length → passwordTooShort',
      () => expect(
        authErrorText(en, weak(<String>[core.AuthFailure.reasonLength])),
        en.passwordTooShort,
      ),
    );
    test(
      'characters → passwordTooWeak',
      () => expect(
        authErrorText(en, weak(<String>[core.AuthFailure.reasonCharacters])),
        en.passwordTooWeak,
      ),
    );
    test(
      'an unknown reason → passwordTooWeak, never the length message',
      () => expect(
        authErrorText(en, weak(<String>['some_future_reason'])),
        en.passwordTooWeak,
      ),
    );
    test(
      'NO reasons → passwordTooWeak',
      () => expect(authErrorText(en, weak(<String>[])), en.passwordTooWeak),
    );
    test('pwned + length → passwordBreached: pwned WINS, in either order', () {
      expect(
        authErrorText(en, weak(<String>['length', 'pwned'])),
        en.passwordBreached,
      );
      expect(
        authErrorText(en, weak(<String>['pwned', 'length'])),
        en.passwordBreached,
      );
    });
    test('length + characters → passwordTooShort: length beats characters', () {
      expect(
        authErrorText(en, weak(<String>['characters', 'length'])),
        en.passwordTooShort,
      );
    });
  });

  group('🔴 the CODE decides — the sentence is only a fallback', () {
    test('reasons beat a sentence that names a different rule', () {
      // GoTrue's LENGTH sentence, with the reasons list saying pwned. A mapper
      // that trusted the prose would answer "too short" and send the user off
      // to add characters to a password that is in a breach corpus.
      expect(
        authErrorText(
          en,
          weak(
            <String>['pwned'],
            message: 'Password should be at least 8 characters.',
          ),
        ),
        en.passwordBreached,
      );
    });
    test('captcha_failed beats a sentence the NETWORK branch would take', () {
      expect(
        authErrorText(
          en,
          coded('captcha_failed', message: 'connection refused by verifier'),
        ),
        en.authCaptchaFailed,
      );
    });
    test('invalid_credentials → authIncorrect, whatever the words', () {
      expect(
        authErrorText(en, coded('invalid_credentials', message: 'nope')),
        en.authIncorrect,
      );
    });
    test('user_already_exists and email_exists → authAlreadyRegistered', () {
      expect(
        authErrorText(en, coded('user_already_exists')),
        en.authAlreadyRegistered,
      );
      expect(
        authErrorText(en, coded('email_exists')),
        en.authAlreadyRegistered,
      );
    });
    test('email_not_confirmed → authConfirmEmail', () {
      expect(
        authErrorText(en, coded('email_not_confirmed')),
        en.authConfirmEmail,
      );
    });
    test('every over_*_rate_limit → authRateLimited', () {
      for (final String code in <String>[
        'over_request_rate_limit',
        'over_email_send_rate_limit',
        'over_sms_send_rate_limit',
      ]) {
        expect(
          authErrorText(en, coded(code)),
          en.authRateLimited,
          reason: code,
        );
      }
    });
    test('a code nobody modelled FALLS BACK to the sentence, not to unknown',
        () {
      expect(
        authErrorText(
          en,
          coded(
            'some_future_code',
            message: 'captcha protection: request disallowed',
          ),
        ),
        en.authCaptchaFailed,
      );
    });
  });

  group('text a screen already wrote is shown AS WRITTEN', () {
    test(
      'a String passes through untouched — the pre-repository field errors rely on it',
      () {
        expect(
          authErrorText(en, 'Enter both an email and a password.'),
          'Enter both an email and a password.',
        );
      },
    );
    test('AuthFailure.localized passes through, even with server-ish words',
        () {
      // A sentence that the network branch WOULD match if it were read as
      // server English. `localized` is the whole difference.
      expect(
        authErrorText(
          en,
          core.AuthFailure.localized('Check your connection, then try again.'),
        ),
        'Check your connection, then try again.',
      );
    });
    test(
      '🔴 the sign-up screens\' LOCAL length refusal → passwordTooShort, '
      'never authUnknownError',
      () {
        // Exactly what both sign-up screens raise before any request is made.
        // It was a bare `AuthFailure(l10n.passwordTooShort)`, which this
        // function read as unmatched server English: "Something went wrong".
        final core.AuthFailure local = core.AuthFailure(
          en.passwordTooShort,
          code: core.AuthFailure.weakPassword,
          reasons: const <String>[core.AuthFailure.reasonLength],
        );
        expect(authErrorText(en, local), en.passwordTooShort);
        expect(authErrorText(en, local), isNot(en.authUnknownError));
        expect(authErrorText(ta, local), ta.passwordTooShort);
      },
    );
  });

  group('the sentence FALLBACK — failures that carry no code', () {
    test(
      'invalid credentials',
      () => expect(
        authErrorText(en, fail('invalid_credentials')),
        en.authIncorrect,
      ),
    );
    test(
      'already registered',
      () => expect(
        authErrorText(en, fail('user_already_exists')),
        en.authAlreadyRegistered,
      ),
    );
    test(
      'weak password with no reason says "stronger", never the length rule',
      () =>
          expect(authErrorText(en, fail('weak_password')), en.passwordTooWeak),
    );
    test(
      'reasons MISSING → passwordTooWeak for each of GoTrue\'s three sentences',
      () {
        // GoTrue v2.189.0 internal/api/password.go:43, :50 and :66.
        for (final String sentence in <String>[
          'Password should be at least 8 characters.',
          'Password should contain at least one character of each: '
              'abcdefghijklmnopqrstuvwxyz, 0123456789.',
          'Password is known to be weak and easy to guess, please choose a '
              'different one.',
        ]) {
          expect(
            authErrorText(en, fail(sentence)),
            en.passwordTooWeak,
            reason: sentence,
          );
        }
      },
    );
    test(
      'email not confirmed',
      () => expect(
        authErrorText(en, fail('email_not_confirmed')),
        en.authConfirmEmail,
      ),
    );
    test(
      'rate limited',
      () => expect(
        authErrorText(en, fail('over_email_send_rate_limit')),
        en.authRateLimited,
      ),
    );
    test(
      'network',
      () => expect(
        authErrorText(en, fail('SocketException: Failed host lookup')),
        en.authNetworkError,
      ),
    );
    test('unmapped falls back, and never leaks the raw text', () {
      final String out = authErrorText(
        en,
        fail('some_new_server_code_nobody_modelled'),
      );
      expect(out, en.authUnknownError);
      expect(out, isNot(contains('some_new_server_code')));
    });
  });

  group('🔴 the captcha branch — the one the cutover needs', () {
    test(
      'the bare code maps',
      () => expect(
        authErrorText(en, fail('captcha_failed')),
        en.authCaptchaFailed,
      ),
    );

    test("GoTrue's REAL refusal sentence maps, not just the tidy code", () {
      // The tidy `captcha_failed` is the code, but what arrives in the message
      // is prose. A test that only used the code would pass while production
      // showed the sentence.
      expect(
        authErrorText(
          en,
          fail(
            'captcha protection: request disallowed (invalid-input-response)',
          ),
        ),
        en.authCaptchaFailed,
      );
      expect(
        authErrorText(
          en,
          fail(
            'captcha protection: request disallowed (no captcha_token found)',
          ),
        ),
        en.authCaptchaFailed,
      );
    });

    test(
      '🔴 it does NOT say "incorrect password" — the credentials may be fine',
      () {
        // On a gated endpoint the captcha is checked BEFORE the password, and
        // Turnstile tokens expire in ~5 minutes, so expiry is the dominant cause.
        expect(
          authErrorText(en, fail('captcha_failed')),
          isNot(en.authIncorrect),
        );
      },
    );

    test(
      'it is not swallowed by the network branch, which matches a bare "connection"',
      () {
        expect(
          authErrorText(en, fail('captcha protection: connection disallowed')),
          en.authCaptchaFailed,
        );
      },
    );

    test('a NON-AuthFailure vendor exception maps and is never printed', () {
      final String out = authErrorText(en, const RawVendorError());
      expect(out, en.authCaptchaFailed);
      expect(out, isNot(contains(rawVendorFragment)));
    });
  });

  test('it is localized, not hardcoded English', () {
    expect(authErrorText(ta, fail('captcha_failed')), ta.authCaptchaFailed);
    expect(
        authErrorText(ta, fail('captcha_failed')), isNot(en.authCaptchaFailed));
    expect(
      authErrorText(ta, weak(<String>['pwned'])),
      ta.passwordBreached,
    );
    expect(
      authErrorText(ta, weak(<String>['characters'])),
      ta.passwordTooWeak,
    );
    expect(ta.passwordBreached, isNot(en.passwordBreached));
    expect(ta.passwordTooWeak, isNot(en.passwordTooWeak));
  });
}
