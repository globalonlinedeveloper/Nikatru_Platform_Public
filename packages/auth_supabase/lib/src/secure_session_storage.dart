import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// Persists the Supabase session in the platform SECURE store, not in
/// `shared_preferences`.
///
/// 🔴 [pipeline C-15 / G-43] THIS EXISTS BECAUSE THE DEFAULT IS WRONG FOR US.
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
  Future<bool> hasAccessToken() async {
    final String? raw = await _read();
    return raw != null && raw.isNotEmpty;
  }

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

  @override
  Future<void> removePersistedSession() async {
    try {
      await _store.delete(_key);
    } catch (_) {
      // Swallowed for the same reason — but note the asymmetry: a failed DELETE
      // leaves a session on disk, so callers that need a guaranteed sign-out
      // must not rely on this alone. AuthRepository.signOut clears the
      // in-memory session regardless.
    }
  }

  Future<String?> _read() async {
    try {
      return await _store.read(_key);
    } catch (_) {
      // An unreadable store means "no session", never a crash at launch. The
      // user signs in again; the alternative is an app that cannot start.
      return null;
    }
  }
}
