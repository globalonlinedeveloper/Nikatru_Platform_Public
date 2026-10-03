import 'package:nikatru_core/nikatru_core.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// [KeyValueStore] backed by `shared_preferences` — non-secret persistence
/// (prefs, feature-flag install id, last-good [AppConfig]) on all six platforms.
///
/// For SECRETS/tokens use a `SecureStore` implementation instead — this store is
/// not encrypted.
///
/// 🔴 EVERY KEY IS NAMESPACED TO [appId], AND THAT IS NOT OPTIONAL. On web all
/// apps in this portfolio now serve from ONE origin (`nikatru.com/<app>`, not
/// `<app>.nikatru.com`), `shared_preferences` writes `flutter.<key>` into that
/// origin's `localStorage`, and `localStorage` is origin-scoped. Two apps
/// writing a pref of the same name would write the SAME slot and read back each
/// other's value with no error of any kind. The prefix is applied by core's
/// [NamespacedKeyValueStore] — one implementation, no second copy — and the raw
/// passthrough below is PRIVATE so no caller outside this library can obtain an
/// un-namespaced prefs store at all.
///
/// The auth session is not in this store at all: `SecureSessionStorage` keeps
/// it under one secure-store key, deliberately NOT namespaced — see
/// `key_value_store.dart` in `packages/core` for why.
class PrefsKeyValueStore implements KeyValueStore {
  /// Wrap an existing [prefs] instance, namespaced to [appId].
  ///
  /// [appId] is REQUIRED and must be injected — pass the stamped
  /// `AppConfig.appId`. A default, or a literal written here, would give every
  /// app in the portfolio the same namespace, which is precisely the collision
  /// the namespace exists to prevent.
  PrefsKeyValueStore(SharedPreferences prefs, {required String appId})
      : _delegate = NamespacedKeyValueStore(
          inner: _RawPrefsKeyValueStore(prefs),
          appId: appId,
        );

  /// Build from the platform's default `SharedPreferences` instance, namespaced
  /// to [appId].
  static Future<PrefsKeyValueStore> create({required String appId}) async =>
      PrefsKeyValueStore(await SharedPreferences.getInstance(), appId: appId);

  final NamespacedKeyValueStore _delegate;

  /// The prefix this store writes under. Exposed for diagnostics and for a
  /// caller that has to reason about RAW stored keys.
  StorageNamespace get namespace => _delegate.namespace;

  @override
  Future<String?> read(String key) => _delegate.read(key);

  @override
  Future<void> write(String key, String value) => _delegate.write(key, value);

  @override
  Future<void> remove(String key) => _delegate.remove(key);

  @override
  Future<bool> containsKey(String key) => _delegate.containsKey(key);

  @override
  String toString() => 'PrefsKeyValueStore(${namespace.appId})';
}

/// The unprefixed passthrough to `shared_preferences`.
///
/// 🔴 PRIVATE ON PURPOSE. This is the only object in the package that can write
/// a key with no app id in front of it, and nothing outside this library can
/// construct one — so "forgot to namespace" is not a mistake a caller is able
/// to make, rather than one a comment asks them not to make.
class _RawPrefsKeyValueStore implements KeyValueStore {
  _RawPrefsKeyValueStore(this._prefs);

  final SharedPreferences _prefs;

  @override
  Future<String?> read(String key) async => _prefs.getString(key);

  @override
  Future<void> write(String key, String value) => _prefs.setString(key, value);

  @override
  Future<void> remove(String key) => _prefs.remove(key);

  @override
  Future<bool> containsKey(String key) async => _prefs.containsKey(key);
}
