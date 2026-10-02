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

  group('⏱ 2026-10-02 · #1155 review, finding 3: guardSignInMethodChange', () {
    final DateTime now = DateTime.utc(2026, 10, 2, 12);
    AuthUser signedInAt(DateTime? at) =>
        AuthUser(id: 'u1', email: 'a@b.test', lastSignInAt: at);

    test('RED CONTROL: a stale session that does not re-authenticate cannot '
        'link or unlink — nothing changes', () async {
      int changes = 0;
      int checks = 0;
      int asked = 0;
      await expectLater(
        guardSignInMethodChange<void>(
          user: signedInAt(now.subtract(const Duration(hours: 3))),
          reauthenticate: () async {
            asked++;
            return false;
          },
          serverCheck: () async => checks++,
          change: () async => changes++,
          now: () => now,
        ),
        throwsA(
          isA<AuthFailure>().having(
            (AuthFailure f) => f.code,
            'code',
            AuthFailure.reauthRequired,
          ),
        ),
      );
      expect(asked, 1);
      expect(checks, 0);
      expect(changes, 0);
    });

    test('RED CONTROL: the server refusing a stale token stops the change',
        () async {
      int changes = 0;
      await expectLater(
        guardSignInMethodChange<void>(
          user: signedInAt(now.subtract(const Duration(minutes: 1))),
          reauthenticate: () async => true,
          serverCheck: () async => throw AuthFailure(
            'stale',
            code: AuthFailure.reauthRequired,
          ),
          change: () async => changes++,
          now: () => now,
        ),
        throwsA(isA<AuthFailure>()),
      );
      expect(changes, 0);
    });

    test('a sign-in a minute ago goes straight through, server checked first',
        () async {
      final List<String> order = <String>[];
      await guardSignInMethodChange<void>(
        user: signedInAt(now.subtract(const Duration(minutes: 1))),
        reauthenticate: () async {
          order.add('asked');
          return true;
        },
        serverCheck: () async => order.add('server'),
        change: () async => order.add('change'),
        now: () => now,
      );
      expect(order, <String>['server', 'change']);
    });

    test('a stale session that re-authenticates may change', () async {
      final List<String> order = <String>[];
      await guardSignInMethodChange<void>(
        user: signedInAt(null),
        reauthenticate: () async {
          order.add('asked');
          return true;
        },
        serverCheck: () async => order.add('server'),
        change: () async => order.add('change'),
        now: () => now,
      );
      expect(order, <String>['asked', 'server', 'change']);
    });

    test('nobody signed in: refused', () async {
      await expectLater(
        guardSignInMethodChange<void>(
          user: null,
          reauthenticate: () async => true,
          serverCheck: () async {},
          change: () async {},
        ),
        throwsA(isA<AuthFailure>()),
      );
    });
  });
}
