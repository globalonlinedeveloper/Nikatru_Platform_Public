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
      test('signs out and records that the request happened', () async {
        await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
        await auth.deleteAccount();
        expect(auth.deletionRequested, isTrue);
        expect(auth.currentUser, isNull);
        expect(await auth.currentAccessToken(), isNull);
      });

      test('refuses when nobody is signed in', () async {
        await expectLater(
          auth.deleteAccount(),
          throwsA(isA<core.AuthFailure>()),
        );
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
    test('an unreadable store reports no session instead of throwing',
        () async {
      final SecureSessionStorage broken = SecureSessionStorage(
        store: _ThrowingSecureStore(),
      );
      expect(await broken.hasAccessToken(), isFalse);
      expect(await broken.accessToken(), isNull);
      // …and a failed write must not abort a sign-in that already succeeded.
      await expectLater(broken.persistSession('x'), completes);
      await expectLater(broken.removePersistedSession(), completes);
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
