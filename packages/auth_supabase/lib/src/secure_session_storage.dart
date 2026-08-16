import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// Persists the Supabase session in the platform SECURE store, not in
/// `shared_preferences`.
///
/// 🔴 [pipeline C-15 / G-43] (absent from origins.lock.json by construction — G-43 is a MASTER_PLAN §3 chassis-gap id, a different register from the pipeline ids; see Private/MASTER_PLAN.md) THIS EXISTS BECAUSE THE DEFAULT IS WRONG FOR US.
/// `supabase_flutter` defaults to `SharedPreferencesLocalStorage`, which writes
/// the session — a live bearer token and its refresh token — as **plaintext**:
/// an XML file in app-private storage on Android, a plist on iOS/macOS, a JSON
/// file on desktop, and `localStorage` on the web. App-private is not the same
/// as encrypted: a rooted or jailbroken device, an unencrypted backup, or any
/// process running as the same user reads it straight off disk.
///
/// A refresh token is the sensitive half. An access token expires in an hour; a
/// refresh token is a long-lived key to mint more, so leaking it is closer to
/// leaking a password than to leaking a cookie.
///
/// Routing it through core's [core.SecureStore] gets the Keychain on iOS/macOS,
/// the KeyStore-backed EncryptedSharedPreferences on Android, DPAPI on Windows
/// and libsecret on Linux — which is exactly the platform difference that earned
/// `platform_storage` its own package, reused here rather than solved twice.
///
/// ⚠️ WEB IS THE HONEST EXCEPTION. A browser has no OS keychain a page can
/// reach, so `SecureStore` on web is backed by ordinary web storage and this
/// class cannot make it stronger. That is a property of the platform, not a bug
/// here — it is stated rather than papered over, and it is why the web build
/// leans on short token lifetimes instead.
///
/// 🔴 WRITES AND DELETES ARE NOT SYMMETRIC, and the difference is the whole of
/// [removePersistedSession]. A failed WRITE costs the user a re-login. A failed
/// DELETE leaves a live refresh token on disk that the NEXT LAUNCH picks up —
/// the user asked to be signed out, the UI said they were, and the app comes
/// back signed in. On a desktop with no working keyring (a Linux session with no
/// libsecret provider running is the ordinary case) that is not an exotic path.
/// So the delete is not best-effort: it neutralises what it cannot remove, and
/// throws when it can do neither.
class SecureSessionStorage extends sb.LocalStorage {
  SecureSessionStorage({required core.SecureStore store, String? key})
      : _store = store,
        _key = key ?? defaultKey;

  /// The storage key. Namespaced so two NIKATRU apps on one device — which is
  /// the entire point of a portfolio — never share or clobber a session.
  static const String defaultKey = 'nikatru.auth.session';

  final core.SecureStore _store;
  final String _key;

  @override
  Future<void> initialize() async {
    // Nothing to open: SecureStore creates lazily off the platform.
  }

  @override
  Future<bool> hasAccessToken() async => await _read() != null;

  @override
  Future<String?> accessToken() => _read();

  @override
  Future<void> persistSession(String persistSessionString) async {
    try {
      await _store.write(_key, persistSessionString);
    } catch (_) {
      // Best-effort by contract. A failed write costs the user a re-login next
      // launch; THROWING here would abort a sign-in that has already succeeded
      // on the server, which is strictly worse.
    }
  }

  /// 🔴 A SIGN-OUT THAT CANNOT DELETE MUST NOT REPORT SUCCESS.
  ///
  /// This used to swallow the failure "for the same reason" as [persistSession]
  /// — and that reason does not transfer. Losing a write costs a re-login;
  /// losing a delete leaves the refresh token exactly where the next launch
  /// looks for it, so the account silently comes back. The note that stood in
  /// for a fix said `AuthRepository.signOut` clears the in-memory session
  /// regardless, which is true and is the WRONG SCOPE: in-memory state dies with
  /// the process, and the process dying is precisely when the leftover session
  /// starts mattering.
  ///
  /// Three steps, in order:
  ///  1. delete;
  ///  2. failing that, OVERWRITE THE KEY WITH AN EMPTY VALUE. [_read] treats an
  ///     empty value as absent, so a store that will accept a write but not a
  ///     delete still ends up unable to resurrect the session. This is not
  ///     hypothetical bookkeeping — `flutter_secure_storage`'s Linux backend
  ///     fails the delete when libsecret has no unlocked collection while the
  ///     write path can still succeed.
  ///  3. READ THE TOMBSTONE BACK. A write that does not throw is not a write
  ///     that landed, and "it did not throw" is exactly the evidence this class
  ///     used to accept before the swallow was removed. Without the read-back
  ///     the fix would be the same shape as the defect: a store whose write
  ///     silently no-ops would leave the live refresh token in place and this
  ///     would still report a clean sign-out.
  ///
  /// If none of the three succeed the original error is rethrown, stack intact.
  /// supabase_flutter catches it and logs a warning (`_onAuthStateChange`), so
  /// the throw alone would not protect anyone — step 2 is what actually does.
  /// The throw is here because the alternative is this class asserting a
  /// sign-out it knows did not happen, and a caller that wants to know now can.
  @override
  Future<void> removePersistedSession() async {
    try {
      await _store.delete(_key);
      return;
    } catch (deleteError, deleteStack) {
      try {
        await _store.write(_key, '');
        // Read through the STORE, not through [_read]: _read answers null for
        // an unreadable store, which would turn "I cannot tell" into "it
        // worked" at the one point where that distinction is the whole fix.
        final String? left = await _store.read(_key);
        if (left == null || left.isEmpty) return;
      } catch (_) {
        // Both routes into the store are shut. Nothing this class can do makes
        // the session go away, which is the one case worth surfacing.
      }
      // The DELETE failure is the reportable one; the tombstone was the
      // fallback. Rethrown with its own stack rather than wrapped, so the
      // platform error that actually explains a broken keyring survives.
      Error.throwWithStackTrace(deleteError, deleteStack);
    }
  }

  /// The stored session, or null when there is none.
  ///
  /// An EMPTY value reads as absent — that is the tombstone
  /// [removePersistedSession] writes when it cannot delete, and treating it as
  /// absent in one place keeps `hasAccessToken`/`accessToken` from disagreeing
  /// about it.
  Future<String?> _read() async {
    try {
      final String? raw = await _store.read(_key);
      return (raw == null || raw.isEmpty) ? null : raw;
    } catch (_) {
      // An unreadable store means "no session", never a crash at launch. The
      // user signs in again; the alternative is an app that cannot start.
      return null;
    }
  }
}
