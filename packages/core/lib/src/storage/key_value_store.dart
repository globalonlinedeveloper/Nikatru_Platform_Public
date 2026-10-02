/// Simple string key–value persistence seam (prefs, feature flags, the last-good
/// [AppConfig]). Concrete impls live in the app layer — e.g. a
/// `shared_preferences` adapter — so `core` stays pure Dart (ADR 005). Method
/// names mirror `shared_preferences` (`read`/`write`/`remove`) so the app-layer
/// adapter is a thin passthrough.
abstract interface class KeyValueStore {
  /// The stored value for [key], or null when absent.
  Future<String?> read(String key);

  /// Store [value] under [key], replacing any existing value.
  Future<void> write(String key, String value);

  /// Remove [key] if present (a no-op when absent).
  Future<void> remove(String key);

  /// Whether a value is stored under [key].
  Future<bool> containsKey(String key);
}

/// Volatile, dependency-free [KeyValueStore] backed by a plain map.
///
/// Intended for tests and as a safe last-resort fallback on a platform where no
/// real store is wired yet — values DO NOT survive a restart, so never use it as
/// the production store for data that must persist.
class InMemoryKeyValueStore implements KeyValueStore {
  InMemoryKeyValueStore([Map<String, String>? seed])
      : _store = <String, String>{...?seed};

  final Map<String, String> _store;

  @override
  Future<String?> read(String key) async => _store[key];

  @override
  Future<void> write(String key, String value) async => _store[key] = value;

  @override
  Future<void> remove(String key) async => _store.remove(key);

  @override
  Future<bool> containsKey(String key) async => _store.containsKey(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE ORIGIN, MANY APPS.
//
// 🔴 THIS IS THE ROUTING MIGRATION'S SHARP EDGE. Every app moved from
// `<app>.nikatru.com` to `nikatru.com/<app>`, so all of them now run on ONE
// browser origin. `localStorage`, `sessionStorage`, IndexedDB and Cache Storage
// are scoped to the ORIGIN, never to the path — the browser does not know or
// care that `/one` and `/two` are different products.
//
// `shared_preferences` on web writes `flutter.<key>` into that origin's
// `localStorage`. So two apps that each persist a pref called `theme_mode` are
// not writing two entries: they are writing ONE, `flutter.theme_mode`, and the
// second app reads back the first app's value. There is no exception, no
// quota error and no console warning — the read SUCCEEDS with somebody else's
// data. A silent swap is the worst shape a persistence bug takes, because
// neither app's logs contain anything at all.
//
// The fix is a prefix, and it is applied in EXACTLY ONE PLACE:
// [StorageNamespace.qualify]. Everything the chassis persists goes through
// [NamespacedKeyValueStore], which is the only caller of it, so there is no
// second implementation to keep in step and no key that can quietly opt out.
//
// ⚠️ THE APP ID IS INJECTED, NEVER A LITERAL. A hard-coded id would be wrong
// twice over: this chassis is stamped into every app by the brick, so one
// literal would give ALL of them the same namespace — the exact collision this
// file exists to prevent — and the ids themselves are not stable, one app in
// this portfolio has already been renamed once.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 WHAT IS *NOT* OURS TO NAMESPACE, SO NOBODY "FIXES" IT LATER.
//
// The auth session. `initNikatruAuth` hands the Supabase SDK its own storage —
// `SecureSessionStorage` (packages/auth_supabase), one secure-store key,
// `nikatru.auth.session` — so the session never passes through this store, and
// the SDK's default `sb-<project-ref>-auth-token` key is not written at all
// (it belongs to the SDK's SharedPreferencesLocalStorage, which the override
// replaces; 2026-10-01, rv2-security-008 — this paragraph used to say the SDK
// wrote it into `localStorage`). The session key IS NOT PREFIXED, and must not
// be: one shared session across every app on the origin is the DELIBERATE and
// accepted consequence of path routing. The portfolio's stated premise is that
// one login reaches everything, and per-app auth storage would break that
// premise on purpose.
//
// So: a session shared between apps on this origin is the FEATURE. It is not a
// leak, not an oversight, and not a bug report. Namespacing it would be the
// regression.
// ─────────────────────────────────────────────────────────────────────────────

/// The per-app prefix carried by every key the chassis writes.
///
/// A value type rather than a bare `String` so the app id is VALIDATED once, at
/// construction, instead of being concatenated hopefully at each call site.
class StorageNamespace {
  /// The namespace for [appId].
  ///
  /// Throws [ArgumentError] unless [appId] is a snake_case identifier
  /// (lowercase letters, digits and underscores, starting with a letter). That
  /// is not fussiness: the id becomes the literal head of every stored key, and
  /// an id containing the [separator] would let one app's prefix match another
  /// app's keys — a namespace that leaks is worse than no namespace, because it
  /// reads as safe.
  factory StorageNamespace(String appId) {
    if (!_validAppId.hasMatch(appId)) {
      throw ArgumentError.value(
        appId,
        'appId',
        'a storage namespace must be a snake_case app id: lowercase letters, '
            'digits and underscores only, starting with a letter. It becomes '
            'the literal prefix of every stored key, so a separator inside it '
            'would make one app id a prefix of another',
      );
    }
    return StorageNamespace._(appId);
  }

  const StorageNamespace._(this.appId);

  /// What divides the app id from the caller's logical key.
  ///
  /// A dot, matching the existing key style in this chassis
  /// (`nikatru.install_id`). Stored keys therefore read
  /// `flutter.<app_id>.nikatru.install_id` once `shared_preferences` has added
  /// its own web prefix.
  static const String separator = '.';

  static final RegExp _validAppId = RegExp(r'^[a-z][a-z0-9_]*$');

  /// The app this namespace belongs to.
  final String appId;

  /// The literal string every key of this app starts with.
  String get prefix => '$appId$separator';

  /// 🔴 THE ONE PLACE A PREFIX IS APPLIED. Every namespaced read, write, remove
  /// and containsKey routes through here; there is no second copy of this
  /// concatenation anywhere in the chassis, and there must never be one.
  String qualify(String key) => '$prefix$key';

  /// Whether [storedKey] — a raw, already-qualified key as it sits in the
  /// backing store — belongs to this app.
  bool owns(String storedKey) => storedKey.startsWith(prefix);

  /// The logical key behind [storedKey], or null when another app owns it.
  String? unqualify(String storedKey) =>
      owns(storedKey) ? storedKey.substring(prefix.length) : null;

  @override
  bool operator ==(Object other) =>
      other is StorageNamespace && other.appId == appId;

  @override
  int get hashCode => appId.hashCode;

  @override
  String toString() => 'StorageNamespace($appId)';
}

/// A [KeyValueStore] that prefixes every key with its app's
/// [StorageNamespace] before touching [inner].
///
/// Wrap the platform store in this ONCE, at the composition root, and every
/// caller downstream keeps writing plain logical keys (`theme_mode`) while the
/// bytes land under `<app_id>.theme_mode`. Two apps sharing one backing store —
/// which, after the path-routing move, is what every web build now is — then
/// cannot see or clobber each other's values.
class NamespacedKeyValueStore implements KeyValueStore {
  /// Namespace [inner] to [appId]. Both are required: an optional app id is an
  /// app id somebody forgets, and forgetting it is silent.
  NamespacedKeyValueStore({
    required KeyValueStore inner,
    required String appId,
  })  : _inner = inner,
        namespace = StorageNamespace(appId);

  final KeyValueStore _inner;

  /// The prefix this store applies. Exposed so a caller that must reason about
  /// RAW stored keys (a migration, a diagnostic) can do so without rebuilding
  /// the string itself.
  final StorageNamespace namespace;

  @override
  Future<String?> read(String key) => _inner.read(namespace.qualify(key));

  @override
  Future<void> write(String key, String value) =>
      _inner.write(namespace.qualify(key), value);

  @override
  Future<void> remove(String key) => _inner.remove(namespace.qualify(key));

  @override
  Future<bool> containsKey(String key) =>
      _inner.containsKey(namespace.qualify(key));

  @override
  String toString() => 'NamespacedKeyValueStore(${namespace.appId})';
}
