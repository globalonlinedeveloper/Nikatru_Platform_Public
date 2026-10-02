import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ⏱ 2026-10-01 · SE-04 — the one rule the Connected accounts screen and both
/// adapters answer with.
void main() {
  AuthUser user({
    bool password = true,
    List<String> oauth = const <String>[],
    bool verified = true,
  }) => AuthUser(
    id: 'u',
    email: 'a@example.com',
    emailVerified: verified,
    hasPasswordIdentity: password,
    oauthProviders: oauth,
  );

  test('the methods on an account, in a stable order', () {
    expect(
      signInMethodsOf(user(oauth: <String>['google', 'apple'])),
      <SignInMethod>[
        SignInMethod.password,
        SignInMethod.apple,
        SignInMethod.google,
      ],
    );
    expect(signInMethodsOf(null), isEmpty);
    // A provider this build has no row for is not invented as one.
    expect(
      signInMethodsOf(user(password: false, oauth: <String>['github'])),
      isEmpty,
    );
  });

  group('🔴 unlinking the ONLY method is refused', () {
    test('an Apple-only account cannot drop Apple', () {
      final AuthUser apple = user(password: false, oauth: <String>['apple']);
      expect(mayUnlinkMethod(apple, SignInMethod.apple), isFalse);
    });

    test('with a second method it can', () {
      expect(
        mayUnlinkMethod(user(oauth: <String>['apple']), SignInMethod.apple),
        isTrue,
      );
      expect(
        mayUnlinkMethod(
          user(password: false, oauth: <String>['apple', 'google']),
          SignInMethod.google,
        ),
        isTrue,
      );
    });

    test('the password is never offered, and a method not held is not', () {
      expect(
        mayUnlinkMethod(user(oauth: <String>['apple']), SignInMethod.password),
        isFalse,
      );
      expect(mayUnlinkMethod(user(), SignInMethod.google), isFalse);
      expect(mayUnlinkMethod(null, SignInMethod.google), isFalse);
    });
  });

  test('linking: a verified account, a method it does not hold yet', () {
    expect(mayLinkMethod(user(), SignInMethod.google), isTrue);
    expect(
      mayLinkMethod(user(oauth: <String>['google']), SignInMethod.google),
      isFalse,
    );
    expect(mayLinkMethod(user(), SignInMethod.password), isFalse);
    // The takeover rule (`mayLinkIdentity`): never from an unproven address.
    expect(mayLinkMethod(user(verified: false), SignInMethod.apple), isFalse);
  });
}
