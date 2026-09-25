import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/auth_error_text.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// The shared mapper against the REAL vendor types — ⏱ 2026-09-24.
///
/// `authErrorText` moved to `nikatru_chassis_screens`, whose own tests may not
/// import the SDK, so the half of its contract that is about gotrue-dart's own
/// `toString()` is pinned here, where the app's tests already could. A test
/// built on a copy of that format would stay green after gotrue-dart changed
/// it.
///
/// These are the exceptions that STILL reach a screen unwrapped: the Supabase
/// adapter wraps `signUpWithEmail` and `updatePassword`, not `signInWithEmail`,
/// so a wrong password arrives at the login screen as the vendor's own type.
void main() {
  final ChassisLocalizations en = lookupChassisLocalizations(
    const Locale('en'),
  );

  test('AuthApiException invalid_credentials → authIncorrect', () {
    const sb.AuthApiException e = sb.AuthApiException(
      'Invalid login credentials',
      statusCode: '400',
      code: 'invalid_credentials',
    );
    expect(authErrorText(en, e), en.authIncorrect);
    expect(authErrorText(en, e), isNot(contains('AuthApiException')));
  });

  test(
    'AuthApiException captcha_failed → authCaptchaFailed, never printed',
    () {
      const sb.AuthApiException e = sb.AuthApiException(
        'captcha protection: request disallowed (invalid-input-response)',
        statusCode: '400',
        code: 'captcha_failed',
      );
      expect(authErrorText(en, e), en.authCaptchaFailed);
    },
  );

  test('an unwrapped AuthWeakPasswordException still maps by its reasons', () {
    sb.AuthWeakPasswordException refused(List<String> reasons) =>
        sb.AuthWeakPasswordException(
          message: 'Password is known to be weak and easy to guess.',
          statusCode: '422',
          reasons: reasons,
        );
    expect(authErrorText(en, refused(<String>['pwned'])), en.passwordBreached);
    expect(authErrorText(en, refused(<String>['length'])), en.passwordTooShort);
    expect(
      authErrorText(en, refused(<String>['characters'])),
      en.passwordTooWeak,
    );
    expect(authErrorText(en, refused(<String>[])), en.passwordTooWeak);
  });

  test('a dropped connection → authNetworkError', () {
    final sb.AuthRetryableFetchException e = sb.AuthRetryableFetchException(
      message: 'ClientException with SocketException: Failed host lookup',
    );
    expect(authErrorText(en, e), en.authNetworkError);
  });
}
