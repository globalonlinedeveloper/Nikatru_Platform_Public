import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// [pipeline C-15] The auth seam, proven to OPEN — not merely to refuse.
///
/// [pipeline C-6]'s lesson applies directly here: a fail-closed seam with no
/// proven open path is a dead feature that reports healthy. Four of those
/// shipped before, and no test went red, because refusing is the correct answer
/// when nothing is configured. So every test below drives the seam through to a
/// real result.
void main() {
  group('InMemoryAuthRepository — a real implementation, not a mock', () {
    late InMemoryAuthRepository auth;
    setUp(() => auth = InMemoryAuthRepository());
    tearDown(() => auth.dispose());

    test('starts signed out, with no token', () async {
      expect(auth.currentUser, isNull);
      expect(await auth.currentAccessToken(), isNull);
      expect(await auth.currentSession(), isNull);
    });

    test('sign-in OPENS the seam: a user, a session and a real token',
        () async {
      final core.AuthUser u = await auth.signInWithEmail(
        email: 'a@b.com',
        password: 'pw',
      );
      expect(u.email, 'a@b.com');
      expect(auth.currentUser, isNotNull);
      final String? token = await auth.currentAccessToken();
      expect(token, isNotNull);
      expect(token, isNotEmpty);
    });

    test('each sign-in issues a DIFFERENT token', () async {
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      final String? first = await auth.currentAccessToken();
      await auth.signOut();
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      // A constant token would let a test that asserts "the token reached the
      // HTTP layer" pass even when nothing had refreshed.
      expect(await auth.currentAccessToken(), isNot(first));
    });

    test('authStateChanges emits on sign-in and sign-out', () async {
      final List<core.AuthUser?> seen = <core.AuthUser?>[];
      final sub = auth.authStateChanges().listen(seen.add);
      addTearDown(sub.cancel);

      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      await auth.signOut();
      await Future<void>.delayed(Duration.zero);

      expect(seen, hasLength(2));
      expect(seen.first?.email, 'a@b.com');
      expect(seen.last, isNull, reason: 'sign-out must emit null');
    });

    test('sign-out clears the token', () async {
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      await auth.signOut();
      expect(await auth.currentAccessToken(), isNull);
      expect(auth.currentUser, isNull);
    });

    // A token store that hands back an expired token is how a caller ends up
    // retrying a 401 forever.
    test('an EXPIRED session yields no token', () async {
      final InMemoryAuthRepository shortLived = InMemoryAuthRepository(
        sessionLifetime: Duration.zero,
      );
      addTearDown(shortLived.dispose);
      await shortLived.signInWithEmail(email: 'a@b.com', password: 'pw');
      expect(await shortLived.currentAccessToken(), isNull);
      // …but the session itself is still readable, so a caller can tell
      // "expired" apart from "never signed in".
      expect(await shortLived.currentSession(), isNotNull);
    });

    test('empty credentials are refused', () async {
      await expectLater(
        auth.signInWithEmail(email: '', password: ''),
        throwsA(isA<core.AuthFailure>()),
      );
    });

    group('deleteAccount', () {
      // 🔴 [ADR 027] IT MUST NOT RETURN NORMALLY. A normal return is what the
      // Delete-account control renders as "Your account has been deleted.
      // Signing in with the same email and password will not work any more." —
      // while `signInWithEmail` above accepts any non-empty pair and signs the
      // same user straight back in. Only a real 2xx from `DELETE /v1/account`
      // may ever produce `deleted`.
      test(
        'records the request, signs out, and then REFUSES — it never claims a '
        'deletion',
        () async {
          await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
          await expectLater(
            auth.deleteAccount(),
            throwsA(
              isA<core.AccountDeletionFailure>().having(
                (core.AccountDeletionFailure f) => f.outcome,
                'outcome',
                core.AccountDeletionOutcome.notConfigured,
              ),
            ),
            reason:
                'a demo build that reports a deletion is lying to the user — '
                '[ADR 027]',
          );
          // The request still REACHED the seam: the dead-button shape and the
          // lying-button shape are different defects, and both are asserted.
          expect(auth.deletionRequested, isTrue);
          expect(auth.currentUser, isNull);
          expect(await auth.currentAccessToken(), isNull);
        },
      );

      test('refuses when nobody is signed in', () async {
        await expectLater(
          auth.deleteAccount(),
          throwsA(isA<core.AuthFailure>()),
        );
        // …and it did not record a request it never made.
        expect(auth.deletionRequested, isFalse);
      });
    });
  });

  // ── [G-43] The session must never sit in plaintext. ───────────────────────
  group('SecureSessionStorage', () {
    late core.SecureStore store;
    late SecureSessionStorage storage;
    setUp(() {
      store = core.InMemorySecureStore();
      storage = SecureSessionStorage(store: store);
    });

    test('round-trips a session through the SECURE store', () async {
      await storage.initialize();
      expect(await storage.hasAccessToken(), isFalse);

      await storage.persistSession('{"access_token":"t"}');
      expect(await storage.hasAccessToken(), isTrue);
      expect(await storage.accessToken(), '{"access_token":"t"}');
      // The point of the class: it landed in SecureStore, not in prefs.
      expect(await store.read(SecureSessionStorage.defaultKey), isNotNull);
    });

    test('removePersistedSession clears it', () async {
      await storage.persistSession('{"access_token":"t"}');
      await storage.removePersistedSession();
      expect(await storage.hasAccessToken(), isFalse);
      expect(await store.read(SecureSessionStorage.defaultKey), isNull);
    });

    test('the key is namespaced, so two NIKATRU apps cannot collide', () {
      expect(SecureSessionStorage.defaultKey, startsWith('nikatru.'));
    });

    // An unreadable store must mean "no session", never a crash at launch.
    //
    // 🔴 THE LAST LINE OF THIS TEST USED TO ASSERT THE DEFECT (2026-08-01
    // full-corpus review, #22). It required `removePersistedSession()` to
    // COMPLETE on a store where every operation throws — i.e. it pinned the
    // swallow in place, and would have gone red against the honest behaviour.
    // A sign-out that cannot delete AND cannot overwrite has not signed anyone
    // out, so it now has to say so. The write half is unchanged and still
    // swallows: that asymmetry is the point, and it is driven in full in
    // secure_session_storage_test.dart.
    test('an unreadable store reports no session instead of throwing',
        () async {
      final SecureSessionStorage broken = SecureSessionStorage(
        store: _ThrowingSecureStore(),
      );
      expect(await broken.hasAccessToken(), isFalse);
      expect(await broken.accessToken(), isNull);
      // …and a failed write must not abort a sign-in that already succeeded.
      await expectLater(broken.persistSession('x'), completes);
      await expectLater(
        broken.removePersistedSession(),
        throwsA(isA<StateError>()),
      );
    });
  });

  // ── [pipeline C-13] updateProfile. ────────────────────────────────────────
  // The profile screen was refused because "there is no profile data model".
  // There is: gotrue writes `auth.users.user_metadata`, and this in-memory
  // implementation drives the same seam end to end.
  group('InMemoryAuthRepository.updateProfile', () {
    late InMemoryAuthRepository auth;
    setUp(() => auth = InMemoryAuthRepository());
    tearDown(() => auth.dispose());

    test('changes the name on the live session', () async {
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      expect(auth.currentUser!.displayName, isNull);
      final core.AuthUser u = await auth.updateProfile(
        displayName: 'Ada Lovelace',
      );
      expect(u.displayName, 'Ada Lovelace');
      expect(auth.currentUser!.displayName, 'Ada Lovelace');
      // The identity must not move: user_metadata is not the subject claim, and
      // every server-side row is keyed on the id.
      expect(auth.currentUser!.id, u.id);
      expect(auth.currentUser!.email, 'a@b.com');
    });

    test('EMITS, so a screen showing the name learns it changed', () async {
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      final List<core.AuthUser?> seen = <core.AuthUser?>[];
      final StreamSubscription<core.AuthUser?> sub =
          auth.authStateChanges().listen(seen.add);
      addTearDown(sub.cancel);

      await auth.updateProfile(displayName: 'Ada');
      await Future<void>.delayed(Duration.zero);

      expect(
        seen.map((core.AuthUser? u) => u?.displayName),
        contains('Ada'),
        reason: 'a save nothing is told about is invisible, which is '
            'indistinguishable from one that silently failed',
      );
    });

    test('an empty name CLEARS it rather than storing a blank', () async {
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      await auth.updateProfile(displayName: 'Ada');
      await auth.updateProfile(displayName: '');
      expect(auth.currentUser!.displayName, isNull);
    });

    test('refuses when nobody is signed in', () async {
      await expectLater(
        auth.updateProfile(displayName: 'Ada'),
        throwsA(isA<core.AuthFailure>()),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PASSWORD RESET — the demo identity's half.
  //
  // 🔴 THIS IS THE ONLY PLACE THE RECOVERY PATH CAN BE OPENED WITHOUT A LIVE
  // PROJECT AND A REAL MAILBOX. Every non-web artifact `build-platforms.yml`
  // produces runs on this repository, and every widget test in `apps/subly`
  // that does not override the seam resolves it — so a recovery gate whose only
  // input is a Supabase event would be the [pipeline C-6] dead shape: it
  // compiles, it never fires, and every closed-side test stays green.
  // ══════════════════════════════════════════════════════════════════════════
  group('InMemoryAuthRepository — password reset', () {
    late InMemoryAuthRepository auth;
    setUp(() => auth = InMemoryAuthRepository());
    tearDown(() => auth.dispose());

    test('a reset request is RECORDED — there is no mailbox to send to',
        () async {
      await auth.sendPasswordReset('a@b.com');
      expect(auth.passwordResetsRequested, <String>['a@b.com']);
    });

    // 🔴 THE WHOLE POINT OF THE EVENT SEAM, in three lines: a recovery arrival
    // and an ordinary sign-in put the SAME value on `authStateChanges()`. The
    // only thing that can tell them apart is the event.
    test('recovery and sign-in are INDISTINGUISHABLE on authStateChanges',
        () async {
      final List<core.AuthUser?> users = <core.AuthUser?>[];
      final List<core.AuthEvent> events = <core.AuthEvent>[];
      final StreamSubscription<core.AuthUser?> a =
          auth.authStateChanges().listen(users.add);
      final StreamSubscription<core.AuthEvent> b = auth.authEvents().listen(
            events.add,
          );
      addTearDown(a.cancel);
      addTearDown(b.cancel);

      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      await auth.signOut();
      auth.deliverPasswordRecovery('a@b.com');
      await Future<void>.delayed(Duration.zero);

      expect(
        users.first,
        users.last,
        reason:
            'same id, same email, same verification — the user stream cannot '
            'see the difference, which is exactly why the router could not',
      );
      expect(events.map((core.AuthEvent e) => e.kind), <core.AuthEventKind>[
        core.AuthEventKind.signedIn,
        core.AuthEventKind.signedOut,
        core.AuthEventKind.passwordRecovery,
      ]);
      expect(events.last.startsPasswordRecovery, isTrue);
    });

    test('updatePassword records the VALUE and reports userUpdated', () async {
      auth.deliverPasswordRecovery('a@b.com');
      final List<core.AuthEvent> events = <core.AuthEvent>[];
      final StreamSubscription<core.AuthEvent> sub = auth.authEvents().listen(
            events.add,
          );
      addTearDown(sub.cancel);

      await auth.updatePassword(newPassword: 'correct-horse');
      await Future<void>.delayed(Duration.zero);

      expect(auth.passwordsSet, <String>['correct-horse']);
      expect(
        events.single.kind,
        core.AuthEventKind.userUpdated,
        reason: 'the session did not change, only the record did. Reporting a '
            'sign-in here would look like a second arrival; reporting a '
            'sign-out would tear the success screen down under the user',
      );
    });

    // 🔴 IT REFUSES A PASSWORD ITS OWN SIGN-IN WOULD ACCEPT, and the asymmetry
    // is the feature: a demo identity that took `'a'` would let a reset screen
    // ship with no length check and every widget test still pass.
    test('a short password is refused, using the SHARED floor', () async {
      auth.deliverPasswordRecovery('a@b.com');
      await expectLater(
        auth.updatePassword(newPassword: 'sevench'),
        throwsA(isA<core.AuthFailure>()),
      );
      expect(auth.passwordsSet, isEmpty);
      expect('sevench'.length, core.kMinPasswordLength - 1);
    });

    // The expired / already-used / wrong-device link, at the seam.
    test('with no session at all it refuses rather than doing nothing',
        () async {
      await expectLater(
        auth.updatePassword(newPassword: 'correct-horse'),
        throwsA(isA<core.AuthFailure>()),
      );
    });
  });

  // ── The six-platform matrix. ──────────────────────────────────────────────
  group('AuthCapabilities', () {
    test('the host platform declares its identity capabilities', () {
      final AuthCapabilities c = AuthCapabilities.current();
      // Email/password is pure REST and must work on every target.
      expect(c.emailPassword, isTrue);
      expect(c.oauthRedirect, isA<bool>());
      expect(c.note, isA<String>());
    });
  });
}

class _ThrowingSecureStore implements core.SecureStore {
  @override
  Future<String?> read(String key) async => throw StateError('keychain locked');
  @override
  Future<void> write(String key, String value) async =>
      throw StateError('keychain locked');
  @override
  Future<void> delete(String key) async => throw StateError('keychain locked');
  @override
  Future<void> deleteAll() async => throw StateError('keychain locked');
}
