// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-30 · ST-N6 (D11) — PREFERENCES FOLLOW THE ACCOUNT.
//
// Currency, theme, language and the reminder choices lived in the DEVICE's
// key-value store only, so a user who signed in on a second device met the
// defaults again and set everything twice — and a change on one device never
// reached the other. Sign-in is mandatory, so the account is the natural home.
//
// This is the DECISION half, pure Dart: when to read the account's copy, when
// to write it, and which one wins. The local store stays the CACHE — it is what
// first paint reads, and what an offline device keeps using. An app supplies
// the transport and two callbacks (what its preferences are now, and how to
// apply the account's); nothing here knows which preferences exist.
// ─────────────────────────────────────────────────────────────────────────────

import 'dart:convert';

import '../result.dart';

/// The account's preferences document on the server — one JSON object per
/// account, replaced whole.
abstract interface class AccountPreferencesTransport {
  /// The stored document, or `null` when the account has none yet.
  Future<Result<Map<String, Object?>?>> read();

  /// Replace the stored document with [preferences].
  Future<Result<void>> write(Map<String, Object?> preferences);
}

/// Keeps one device's preferences and its account's in step.
///
/// The rules, each a defect it prevents:
///  - **At sign-in the ACCOUNT wins.** A second device's untouched defaults
///    must not overwrite what the user chose on the first.
///  - **An account with no copy is SEEDED from this device**, so the first
///    device a user signs in on is the one whose choices follow them.
///  - **Nothing is written before the account's copy is known.** A change
///    that lands while the read is in flight would otherwise push this
///    device's state over the account's before the account was asked.
///  - **A local change that could not be written is not lost to the next
///    read.** It is written first; the read does not overwrite it.
///  - **Applying the account's copy is not a local change.** The document just
///    applied is remembered, so the listeners it trips write nothing back.
class AccountPreferencesSync {
  AccountPreferencesSync({
    required AccountPreferencesTransport transport,
    required Map<String, Object?> Function() snapshot,
    required Future<void> Function(Map<String, Object?> account) apply,
    Future<void> Function()? localReady,
  }) : _transport = transport,
       _snapshot = snapshot,
       _apply = apply,
       _localReady = localReady ?? _noWait;

  static Future<void> _noWait() async {}

  final AccountPreferencesTransport _transport;
  final Map<String, Object?> Function() _snapshot;
  final Future<void> Function(Map<String, Object?>) _apply;

  /// Completes once the device's own stored preferences are loaded — a seed
  /// taken before that would be the compiled-in defaults.
  final Future<void> Function() _localReady;

  bool _signedIn = false;
  bool _known = false;
  bool _dirty = false;
  bool _applying = false;
  String? _lastSynced;
  Future<void>? _pulling;

  /// Whether the account's copy has been read (or seeded) this session.
  bool get isSynced => _known;

  /// Signed in, switched account, or back in front of a signed-in user: read
  /// the account's copy and apply it — unless this device holds a change the
  /// account has not seen, which is written instead.
  ///
  /// Never throws — the callers are listeners nobody awaits, and preferences
  /// must never be able to break a sign-in. A failed read leaves the local
  /// cache in charge until the next trigger.
  Future<void> onSignedIn() {
    _signedIn = true;
    return _pulling ??= _pull().catchError((Object _) {}).whenComplete(() {
      _pulling = null;
    });
  }

  Future<void> _pull() async {
    await _localReady();
    if (!_signedIn) return;
    if (_known && _dirty) {
      await _push();
      return;
    }
    final Result<Map<String, Object?>?> read = await _transport.read();
    if (!_signedIn) return;
    await read.fold<Future<void>>((Map<String, Object?>? account) async {
      if (account == null) {
        _known = true;
        await _push();
        return;
      }
      _known = true;
      _dirty = false;
      // 🔴 APPLIED AS ONE STEP. An app applies a document one preference at a
      // time, and every step trips its listeners: a change seen half-way would
      // push a document that is half the account's and half this device's.
      _applying = true;
      try {
        await _apply(account);
      } finally {
        _applying = false;
      }
      // What the device holds NOW is what "in step" means — an older, partial
      // account document leaves this device's value for a key it lacks.
      _lastSynced = canonicalJson(_snapshot());
    }, (Failure _) async {});
  }

  /// A preference changed on this device. Written once the account's copy is
  /// known; before that the sign-in read decides.
  Future<void> onLocalChange() async {
    if (!_signedIn || !_known || _applying) return;
    if (canonicalJson(_snapshot()) == _lastSynced) return;
    await _push();
  }

  /// Signed out: nothing further is read or written for that account.
  void onSignedOut() {
    _signedIn = false;
    _known = false;
    _dirty = false;
    _lastSynced = null;
  }

  Future<void> _push() async {
    final Map<String, Object?> now = _snapshot();
    final String encoded = canonicalJson(now);
    Result<void> wrote;
    try {
      wrote = await _transport.write(now);
    } catch (e) {
      wrote = Result<void>.err(Failure('preferences not written: $e'));
    }
    wrote.fold((_) {
      _lastSynced = encoded;
      _dirty = false;
    }, (Failure _) => _dirty = true);
  }

  /// [value] as JSON with every object's keys sorted, so two documents that
  /// differ only in key order compare equal.
  static String canonicalJson(Object? value) => jsonEncode(_sorted(value));

  static Object? _sorted(Object? v) {
    if (v is Map) {
      final List<String> keys = v.keys.map((Object? k) => '$k').toList()
        ..sort();
      return <String, Object?>{for (final String k in keys) k: _sorted(v[k])};
    }
    if (v is List) return v.map(_sorted).toList();
    return v;
  }
}
