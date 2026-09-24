import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/features/auth/auth_error_text.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/l10n/app_localizations_en.dart';
import 'package:subscriptiontracker/l10n/app_localizations_ta.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
/// `_friendlyMessage` shipped with NO test enumerating its branches — the two
/// incidental assertions in `login_chassis_parity_test.dart` cover exactly two
/// of them, as a side effect of testing something else. So a branch could be
/// deleted, reordered, or made unreachable and nothing would say so.
///
/// It matters more now that this function is shared: it is the only thing
/// standing between the user and the server's raw English on FOUR screens, and
/// the one whose absence meant three of them printed that English verbatim.
void main() {
  final AppLocalizations en = AppLocalizationsEn();
  final AppLocalizations ta = AppLocalizationsTa();

  /// The shape the app really passes in: `AuthFailure.toString()` is
  /// `'AuthFailure: <server message>'`, so every match runs against that
  /// prefix, not against a bare code. Testing bare strings would pass while the
  /// real call site failed.
  core.AuthFailure fail(String serverMessage) =>
      core.AuthFailure(serverMessage);

  group('authErrorText — every branch, against the real AuthFailure shape', () {
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
      // Measured on Box A 2026-09-03; the tidy `captcha_failed` is the code, but
      // what arrives in the message is prose. A test that only used the code
      // would pass while production showed the sentence.
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
        // Reusing authIncorrect would tell a user with a correct password that it
        // was wrong.
        expect(
          authErrorText(en, fail('captcha_failed')),
          isNot(en.authIncorrect),
        );
      },
    );

    test(
      'it is not swallowed by the network branch, which matches a bare "connection"',
      () {
        // The network test is the widest in the function. This pins the ORDER:
        // move the captcha branch below it and a server string carrying both words
        // would silently become "check your connection".
        expect(
          authErrorText(en, fail('captcha protection: connection disallowed')),
          en.authCaptchaFailed,
        );
      },
    );

    test('it is localized, not hardcoded English', () {
      expect(authErrorText(ta, fail('captcha_failed')), ta.authCaptchaFailed);
      expect(
        authErrorText(ta, fail('captcha_failed')),
        isNot(en.authCaptchaFailed),
      );
    });
  });

  group(
    '🔴 a weak password is mapped by REASON — ⏱ 2026-09-24, cutover prep',
    () {
      /// The REAL vendor type, not a look-alike: `authErrorText` reads the list
      /// out of this exception's own `toString()`, so a test built on a copy of
      /// that format would stay green after gotrue-dart changed it. What reaches
      /// the login screen's `catch (e)` is exactly this object.
      sb.AuthWeakPasswordException refused(List<String> reasons) =>
          sb.AuthWeakPasswordException(
            message: 'Password is known to be weak and easy to guess.',
            statusCode: '422',
            reasons: reasons,
          );

      test(
        'pwned → passwordBreached',
        () => expect(
          authErrorText(en, refused(<String>['pwned'])),
          en.passwordBreached,
        ),
      );
      test(
        'length → passwordTooShort',
        () => expect(
          authErrorText(en, refused(<String>['length'])),
          en.passwordTooShort,
        ),
      );
      test(
        'characters → passwordTooWeak',
        () => expect(
          authErrorText(en, refused(<String>['characters'])),
          en.passwordTooWeak,
        ),
      );
      test(
        'pwned + length → passwordBreached: pwned WINS, in either order',
        () {
          expect(
            authErrorText(en, refused(<String>['length', 'pwned'])),
            en.passwordBreached,
          );
          expect(
            authErrorText(en, refused(<String>['pwned', 'length'])),
            en.passwordBreached,
          );
        },
      );
      test('an unknown reason, or an empty list → passwordTooWeak', () {
        expect(
          authErrorText(en, refused(<String>['some_future_reason'])),
          en.passwordTooWeak,
        );
        expect(authErrorText(en, refused(<String>[])), en.passwordTooWeak);
      });

      test(
        'reasons MISSING — the reset screen\'s AuthFailure carries only the '
        'sentence — → passwordTooWeak for each of GoTrue\'s three sentences',
        () {
          // GoTrue v2.189.0 internal/api/password.go:43, :50 and :66. The pwned
          // one matched no branch before this change and showed "Something went
          // wrong"; the characters one was sent to the LENGTH message.
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

      test('it is localized, not hardcoded English', () {
        expect(
          authErrorText(ta, refused(<String>['pwned'])),
          ta.passwordBreached,
        );
        expect(
          authErrorText(ta, refused(<String>['characters'])),
          ta.passwordTooWeak,
        );
        expect(ta.passwordBreached, isNot(en.passwordBreached));
        expect(ta.passwordTooWeak, isNot(en.passwordTooWeak));
      });
    },
  );

  test(
    'a String passes through untouched — the pre-repository field errors rely on it',
    () {
      expect(
        authErrorText(en, 'Enter both an email and a password.'),
        'Enter both an email and a password.',
      );
    },
  );
}
