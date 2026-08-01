import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// [G-43] SIGN-OUT ON A STORE THAT CANNOT DELETE (2026-08-01 full-corpus review,
/// #22).
///
/// PR #96 moved the session into the secure store and kept the delete SWALLOWED,
/// on the same "best-effort by contract" reasoning as the write. The reasoning
/// does not transfer: a lost write costs a re-login, a lost delete leaves the
/// refresh token where the next launch reads it — the user signs out, is told so,
/// and the app comes back signed in. Nothing was red, because a swallowed failure
/// and a successful delete are indistinguishable from the outside, and the ONE
/// caller in supabase_flutter (`_onAuthStateChange`) only logs what escapes.
///
/// So these drive the class directly with a store that fails on command. The
/// assertion that matters is not "did it throw" — it is **what the next launch
/// sees**, which is what `hasAccessToken()`/`accessToken()` answer.
void main() {
  group('SecureSessionStorage.removePersistedSession', () {
    test('the ordinary case: delete removes the session', () async {
      final _FailableStore store = _FailableStore();
      final SecureSessionStorage storage = SecureSessionStorage(store: store);

      await storage.persistSession('{"refresh_token":"r"}');
      expect(await storage.hasAccessToken(), isTrue);

      await storage.removePersistedSession();

      expect(await storage.hasAccessToken(), isFalse);
      expect(await storage.accessToken(), isNull);
      expect(store.raw(SecureSessionStorage.defaultKey), isNull);
    });

    // 🔴 THE DEFECT. Before the fix this passed the sign-out off as done and the
    // token was still sitting there for the next launch to recover.
    test(
      'a delete that FAILS still leaves nothing the next launch can use',
      () async {
        final _FailableStore store = _FailableStore(failDelete: true);
        final SecureSessionStorage storage = SecureSessionStorage(store: store);
        await storage.persistSession('{"refresh_token":"r"}');

        // The store refuses to delete, but accepts writes — the shape of a Linux
        // keyring with no unlocked collection. The tombstone must be enough.
        await storage.removePersistedSession();

        expect(
          await storage.hasAccessToken(),
          isFalse,
          reason: 'a session the next launch can recover is not a sign-out',
        );
        expect(await storage.accessToken(), isNull);
        // …and the live refresh token specifically must be gone, not merely
        // hidden behind a flag: asserting on hasAccessToken() alone would pass on
        // an implementation that left the bytes in place.
        expect(
          store.raw(SecureSessionStorage.defaultKey),
          isNot(contains('r')),
        );
      },
    );

    // The next launch reads hasAccessToken() first and accessToken() second, so
    // a tombstone that only one of them understood would resurrect the session
    // through the other. Both are driven above; this pins the store-level fact.
    test('the tombstone is an EMPTY value, not a deleted key', () async {
      final _FailableStore store = _FailableStore(failDelete: true);
      final SecureSessionStorage storage = SecureSessionStorage(store: store);
      await storage.persistSession('{"refresh_token":"r"}');

      await storage.removePersistedSession();

      expect(store.raw(SecureSessionStorage.defaultKey), '');
    });

    // 🔴 A WRITE THAT DOES NOT THROW IS NOT A WRITE THAT LANDED. "It returned
    // without complaining" is precisely the evidence the swallowed delete used
    // to accept, so accepting it again one level down would rebuild the defect
    // inside its own fix.
    test('a tombstone that silently no-ops is NOT taken as a sign-out',
        () async {
      final _FailableStore store =
          _FailableStore(failDelete: true, writeNoOp: true);
      final SecureSessionStorage storage = SecureSessionStorage(store: store);
      store.seed(SecureSessionStorage.defaultKey, '{"refresh_token":"r"}');

      await expectLater(
        storage.removePersistedSession(),
        throwsA(isA<StateError>()),
        reason: 'the token is still on disk; nothing here may claim otherwise',
      );
      expect(
          store.raw(SecureSessionStorage.defaultKey), '{"refresh_token":"r"}');
    });

    // 🔴 NEITHER ROUTE WORKS. There is no honest way to report success here.
    test(
      'a delete AND a write that both fail THROWS rather than reporting done',
      () async {
        final _FailableStore store = _FailableStore(
          failDelete: true,
          failWrite: true,
        );
        final SecureSessionStorage storage = SecureSessionStorage(store: store);
        store.seed(SecureSessionStorage.defaultKey, '{"refresh_token":"r"}');

        await expectLater(
          storage.removePersistedSession(),
          throwsA(isA<StateError>()),
          reason: 'silence here is a sign-out the app cannot honour',
        );
        // The DELETE error is the reportable one — a caller told "write failed"
        // would look in the wrong place.
        await expectLater(
          storage.removePersistedSession(),
          throwsA(
            isA<StateError>().having(
              (StateError e) => e.message,
              'message',
              contains('delete'),
            ),
          ),
        );
      },
    );
  });

  // The other half of the asymmetry, asserted so the fix above cannot be
  // generalised into "throw on everything". A failed WRITE must stay swallowed:
  // throwing would abort a sign-in that has already succeeded on the server.
  group('SecureSessionStorage.persistSession', () {
    test(
      'a failed write is still swallowed — the sign-in already happened',
      () async {
        final _FailableStore store = _FailableStore(failWrite: true);
        final SecureSessionStorage storage = SecureSessionStorage(store: store);

        await storage.persistSession('{"refresh_token":"r"}');

        expect(await storage.hasAccessToken(), isFalse);
      },
    );

    test(
      'an unreadable store reads as "no session" rather than crashing',
      () async {
        final _FailableStore store = _FailableStore(failRead: true);
        final SecureSessionStorage storage = SecureSessionStorage(store: store);
        store.seed(SecureSessionStorage.defaultKey, '{"refresh_token":"r"}');

        expect(await storage.hasAccessToken(), isFalse);
        expect(await storage.accessToken(), isNull);
      },
    );
  });
}

/// A [core.SecureStore] whose three operations can be made to fail
/// independently — which is the only way to reach the branches that matter.
/// `InMemorySecureStore` cannot fail, so every test written against it proves
/// the happy path twice.
class _FailableStore implements core.SecureStore {
  _FailableStore({
    this.failRead = false,
    this.failWrite = false,
    this.failDelete = false,
    this.writeNoOp = false,
  });

  final bool failRead;
  final bool failWrite;
  final bool failDelete;

  /// Accepts a write and stores nothing — the quiet failure a store is under no
  /// obligation to report, and the one a "did it throw?" check cannot see.
  final bool writeNoOp;

  final Map<String, String> _values = <String, String>{};

  /// Puts a value in place WITHOUT going through the failing write path.
  void seed(String key, String value) => _values[key] = value;

  /// Reads through the failure flags, so a test can see what is really stored.
  String? raw(String key) => _values[key];

  @override
  Future<String?> read(String key) async {
    if (failRead) throw StateError('keyring read unavailable');
    return _values[key];
  }

  @override
  Future<void> write(String key, String value) async {
    if (failWrite) throw StateError('keyring write unavailable');
    if (writeNoOp) return;
    _values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    if (failDelete) throw StateError('keyring delete unavailable');
    _values.remove(key);
  }

  @override
  Future<void> deleteAll() async {
    if (failDelete) throw StateError('keyring delete unavailable');
    _values.clear();
  }
}
