// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-30 · ST-N6 (D11) — PREFERENCES FOLLOW THE ACCOUNT, PER KEY.
//
// Rebuilt on the lead's ruling for #1080 (review fix-rv2-sync, findings 1-7):
// the first draft pushed and pulled a WHOLE document with no version and kept
// "unsent" in memory, which lost a user's change four realistic ways. The model
// now, in five lines:
//
//  1. The server holds one row per key with a `version` only it bumps; a PATCH
//     names the version each change was based on, and a newer row is a
//     CONFLICT the server wins and answers (GET is the whole per-key document).
//  2. The DIRTY SET is durable: each change the user makes on this device is a
//     [DurableOutbox] entry keyed by the preference key, owned by the user id
//     it was made under. It survives restart, Retry and a failed first read.
//  3. Only dirty keys are ever sent. Nothing is seeded and no default is sent:
//     a key leaves the device only because the user set it here.
//  4. One PATCH is in flight at a time (the outbox's single replay); changes to
//     one key coalesce and land in order. A read never overwrites a key changed
//     since the read began, nor with a version older than one this device
//     already holds, nor a dirty key — UNLESS the account already holds a
//     version newer than the one that change follows: its send could only be a
//     conflict the server wins, so the account's value is applied and announced
//     and the change dropped (review 3 of #1080).
//  5. Every request is bound to the user id it started under; its answer is
//     dropped if the user changed. Sign-out forgets that user's versions; their
//     pending changes stay queued, bound to them, for their next sign-in. A
//     permanent refusal (400/403/405/410/413/422) drops that key's change, says
//     so once, and the account's value is read back — it never loops.
//
// This is the DECISION half, pure Dart. The app supplies the transport, the
// user id, and how to apply values to its own settings; nothing here knows
// which preferences exist.
// ─────────────────────────────────────────────────────────────────────────────

import 'dart:async';
import 'dart:convert';
import 'dart:math' show Random;

import '../storage/key_value_store.dart';
import 'durable_outbox.dart';

/// One key as the server holds it.
class PreferenceValue {
  const PreferenceValue(this.value, this.version);

  final Object? value;

  /// The server's version of the key; 0 = the server has never held it.
  final int version;
}

/// One change as a PATCH carries it.
class PreferenceChange {
  const PreferenceChange(this.value, this.baseVersion);

  final Object? value;

  /// The version this device last saw for the key when the user changed it.
  final int baseVersion;
}

/// What a PATCH answered.
class PreferencesPatchResult {
  const PreferencesPatchResult({
    required this.current,
    required this.conflicts,
  });

  /// Every key of the PATCH as the server now holds it.
  final Map<String, PreferenceValue> current;

  /// The keys the server refused because it held a newer version.
  final Set<String> conflicts;
}

/// A request that did not succeed. [status] 0 means there was no answer.
class AccountPreferencesFailure implements Exception {
  const AccountPreferencesFailure(this.status, [this.detail, this.retryAfter]);

  final int status;
  final String? detail;

  /// The server's `Retry-After`, when it sent one: the queue waits at least
  /// this long before trying the change again.
  final Duration? retryAfter;

  @override
  String toString() =>
      'AccountPreferencesFailure($status${detail == null ? '' : ': $detail'})';
}

/// The account's preferences on the server — per key, versioned.
abstract interface class AccountPreferencesTransport {
  /// Every key the account holds. Throws [AccountPreferencesFailure].
  Future<Map<String, PreferenceValue>> read();

  /// Send [changes]. Throws [AccountPreferencesFailure].
  Future<PreferencesPatchResult> patch(Map<String, PreferenceChange> changes);
}

/// The outbox `kind` a preference change is queued under.
const String kPreferenceOutboxKind = 'preference';

/// The store key the preferences' outbox lives under — its own queue document
/// in the one [DurableOutbox] implementation, so a preferences replay never
/// hands a subscription write to this sender (or the reverse).
const String kPreferencesOutboxKey = 'nikatru.outbox.preferences.v1';

/// The preferences queue — the one [DurableOutbox] implementation over its own
/// document, with NO attempt cap (review #1080 delta finding 2): a transient
/// failure (no answer, 5xx, 408/429, the 404 of a Worker older than the route)
/// keeps the change pending with capped backoff however long it lasts, so the
/// only dead letter is a REFUSAL (see [classifyPreferencesFailure]), which is
/// final. The queue holds at most one entry per key, so an uncapped retry
/// cannot grow it. Each wait is [preferencesRetryWait]'s.
DurableOutbox preferencesOutbox(
  Future<KeyValueStore> store, {
  Duration baseBackoff = const Duration(seconds: 2),
  Duration maxBackoff = const Duration(minutes: 5),
  DateTime Function()? now,
  double Function()? random,
}) => DurableOutbox(
  store,
  key: kPreferencesOutboxKey,
  maxAttempts: kPreferencesNoAttemptCap,
  baseBackoff: baseBackoff,
  maxBackoff: maxBackoff,
  now: now,
  retryWait: preferencesRetryWait(random: random),
);

/// The longest `Retry-After` the preferences queue obeys: a larger (or
/// garbled) one must not park a change for days.
const Duration kPreferencesMaxRetryAfter = Duration(hours: 1);

/// The wait after a failed preferences send (review 3 of #1080):
///
///  - JITTER: a random point in the upper half of the backoff
///    (`[backoff/2, backoff]`), so devices that failed together (one outage)
///    do not all come back in the same second. The backoff itself still doubles
///    up to its cap: a repeated 500 keeps backing off.
///  - `Retry-After`: never sooner than the server asked, up to
///    [kPreferencesMaxRetryAfter].
///
/// [random] returns a value in `[0, 1)`; tests pin it.
Duration Function(Duration backoff, Duration? retryAfter) preferencesRetryWait({
  double Function()? random,
}) {
  final double Function() next = random ?? Random().nextDouble;
  return (Duration backoff, Duration? retryAfter) {
    final Duration jittered = backoff * 0.5 + backoff * (0.5 * next());
    if (retryAfter == null) return jittered;
    final Duration asked = retryAfter > kPreferencesMaxRetryAfter
        ? kPreferencesMaxRetryAfter
        : retryAfter;
    return asked > jittered ? asked : jittered;
  };
}

/// The server's `Retry-After` on a failed preferences send, for the queue.
Duration? preferencesRetryAfter(Object error) =>
    error is AccountPreferencesFailure ? error.retryAfter : null;

/// Large enough that no transient run of failures reaches it (at one attempt
/// per backoff capped at five minutes, about 20 000 years).
const int kPreferencesNoAttemptCap = 1 << 31;

/// How a failed preferences request is treated by the outbox.
///
/// REFUSED — final, the change is dropped and the account's value read back:
/// 400 / 422 (malformed), 413 (too large), and the answers no retry can turn
/// around (review 3 of #1080): 403 (this account may not), 405 (the method is
/// not allowed there) and 410 (gone for good). Everything else is TRANSIENT,
/// retried with backoff for as long as it lasts — 5xx, 408, 429, and 404,
/// which is what a Worker deployed before this route answers: the change must
/// wait for the route, not be dropped.
OutboxFailure classifyPreferencesFailure(Object error) {
  if (error is! AccountPreferencesFailure) return OutboxFailure.transient;
  return switch (error.status) {
    0 => OutboxFailure.offline,
    401 => OutboxFailure.unauthorized,
    400 || 403 || 405 || 410 || 413 || 422 => OutboxFailure.refused,
    _ => OutboxFailure.transient,
  };
}

/// See the header.
class AccountPreferencesSync {
  AccountPreferencesSync({
    required AccountPreferencesTransport? Function() transport,
    required DurableOutbox outbox,
    required Future<KeyValueStore> store,
    required String? Function() currentUser,
    required Future<void> Function(Map<String, Object?> values) apply,
    void Function(String key)? onRefused,
    void Function(String key)? onConflict,
  }) : _transport = transport,
       _outbox = outbox,
       _store = store,
       _currentUser = currentUser,
       _apply = apply,
       _onRefused = onRefused,
       _onConflict = onConflict;

  final AccountPreferencesTransport? Function() _transport;
  final DurableOutbox _outbox;
  final Future<KeyValueStore> _store;
  final String? Function() _currentUser;
  final Future<void> Function(Map<String, Object?>) _apply;
  final void Function(String key)? _onRefused;

  /// The server kept another device's value for [key] and it was applied here
  /// (review #1080 delta finding 3): the flip is announced, never silent.
  final void Function(String key)? _onConflict;

  /// A counter of local changes, and the value it had when each key last
  /// changed — the fence a read is checked against.
  int _seq = 0;
  final Map<String, int> _changedAt = <String, int>{};

  /// Serialises every read-modify-write of the versions document.
  Future<void> _tail = Future<void>.value();

  /// One sync per user at a time; never shared across users.
  final Map<String, Future<void>> _syncing = <String, Future<void>>{};

  bool _disposed = false;

  /// The store key of [owner]'s versions document.
  static String versionsKey(String owner) => 'nikatru.prefs.versions.$owner';

  /// The user set [key] to [value] on THIS device.
  ///
  /// Queued durably under the current user and sent in the background. Signed
  /// out, it stays a local choice and is never sent. Never throws.
  Future<void> changed(String key, Object? value) async {
    final String? owner = _currentUser();
    if (owner == null || _disposed) return;
    _changedAt[key] = ++_seq;
    try {
      final int base = await _locked(
        () async => (await _load(owner)).versions[key] ?? 0,
      );
      await _outbox.enqueue(
        owner: owner,
        recordId: key,
        op: OutboxOp.update,
        kind: kPreferenceOutboxKind,
        body: <String, dynamic>{'value': value, 'base_version': base},
        // A new change is tried at once, not after the old one's backoff.
        freshBackoff: true,
      );
    } catch (_) {
      return; // the device store refused; the change is only on screen
    }
    unawaited(push());
  }

  /// Send the current user's dirty keys, one PATCH at a time. Never throws.
  Future<void> push() async {
    final String? owner = _currentUser();
    if (owner == null || _disposed) return;
    await _push(owner);
  }

  Future<void> _push(String owner) async {
    try {
      await _outbox.replay(
        owner: owner,
        currentOwner: _currentUser,
        send: (OutboxEntry e) => _send(owner, e),
        classify: classifyPreferencesFailure,
        retryAfter: preferencesRetryAfter,
        // Its own queue document already; this only makes a stray kind wait
        // for its own sender instead of being sent by this one.
        accepts: (OutboxEntry e) => e.kind == kPreferenceOutboxKind,
      );
      // A refusal is final: drop that change, say so once, and read the
      // account back — the key is no longer dirty, so the read restores the
      // account's value (in a sync this IS that sync; it is shared).
      bool refused = false;
      for (final OutboxEntry dead in await _outbox.deadLetters(owner: owner)) {
        if (dead.kind != kPreferenceOutboxKind) continue;
        await _outbox.discard(dead.id);
        refused = true;
        if (_currentUser() == owner && !_disposed) {
          _onRefused?.call(dead.recordId);
        }
      }
      if (refused && !_stale(owner)) unawaited(sync());
    } catch (_) {
      // Never thrown to a listener nobody awaits.
    }
  }

  Future<String?> _send(String owner, OutboxEntry e) async {
    if (e.kind != kPreferenceOutboxKind) {
      throw const AccountPreferencesFailure(400, 'not a preference');
    }
    final AccountPreferencesTransport? transport = _transport();
    if (transport == null) throw const AccountPreferencesFailure(0);
    final String key = e.recordId;
    final int base = await _locked(
      () async => _baseOf(await _load(owner), key, e),
    );
    final PreferencesPatchResult result = await transport.patch(
      <String, PreferenceChange>{key: PreferenceChange(e.body['value'], base)},
    );
    final PreferenceValue? now = result.current[key];
    if (now == null || _currentUser() != owner || _disposed) return null;
    final bool conflict = result.conflicts.contains(key);
    final bool queuedBehind = (await _outbox.pending(
      owner: owner,
    )).any((OutboxEntry x) => x.recordId == key && x.id != e.id);
    await _locked(() async {
      final _Versions doc = await _load(owner);
      doc.versions[key] = now.version;
      if (conflict) {
        doc.own.remove(key);
      } else {
        doc.own[key] = <int>[base, now.version];
      }
      await _save(owner, doc);
    });
    // The server kept another device's value: apply it — unless the user has
    // already changed the key again here, which is sent next.
    if (conflict && !queuedBehind && _currentUser() == owner && !_disposed) {
      await _apply(<String, Object?>{key: now.value});
      if (_currentUser() == owner && !_disposed) _onConflict?.call(key);
    }
    return null;
  }

  /// Sign-in, a return to the app, a pull: send what is dirty, then read the
  /// account and apply every key that is not dirty here — and every dirty key
  /// the account has already moved past (announced as a conflict; see the
  /// header, point 4). Never throws.
  Future<void> sync() {
    final String? owner = _currentUser();
    if (owner == null || _disposed) return Future<void>.value();
    return _syncing[owner] ??= _sync(owner).whenComplete(() {
      _syncing.remove(owner);
    });
  }

  Future<void> _sync(String owner) async {
    try {
      await _push(owner);
      final AccountPreferencesTransport? transport = _transport();
      if (transport == null || _stale(owner)) return;
      final int started = _seq;
      final Map<String, PreferenceValue> server = await transport.read();
      if (_stale(owner)) return; // A's answer never lands in B
      final List<OutboxEntry> pending = <OutboxEntry>[
        for (final OutboxEntry e in await _outbox.pending(owner: owner))
          if (e.kind == kPreferenceOutboxKind) e,
      ];
      final Map<String, Object?> take = <String, Object?>{};
      // Dirty keys another device has moved past: see below.
      final Map<String, List<OutboxEntry>> overtaken =
          <String, List<OutboxEntry>>{};
      await _locked(() async {
        if (_stale(owner))
          return; // a sign-out landed: never re-create its versions
        final _Versions doc = await _load(owner);
        server.forEach((String key, PreferenceValue v) {
          if ((_changedAt[key] ?? 0) > started) return;
          if (v.version < (doc.versions[key] ?? 0)) return;
          final List<OutboxEntry> mine = <OutboxEntry>[
            for (final OutboxEntry e in pending)
              if (e.recordId == key) e,
          ];
          if (mine.isNotEmpty) {
            // 🔴 A DIRTY KEY STILL PICKS UP ANOTHER DEVICE'S VALUE (review 3 of
            // #1080). After the push above, a change still pending is one in
            // backoff (a 5xx, a Retry-After). If the account already holds a
            // newer version than the one it was based on, its send can only
            // be a conflict the server wins — so the answer is known now: the
            // account's value is applied, said once, and the change dropped,
            // instead of the screen holding a value the account never takes
            // until the backoff ends.
            if (mine.any(
              (OutboxEntry e) => v.version <= _baseOf(doc, key, e),
            )) {
              return;
            }
            overtaken[key] = mine;
          }
          doc.versions[key] = v.version;
          take[key] = v.value;
        });
        await _save(owner, doc);
      });
      // Checked again at the last moment: a change made while the versions were
      // being written is newer than this read. Checked before EACH discard too:
      // a change made from here on is queued after it, never into it.
      take.removeWhere((String key, _) => (_changedAt[key] ?? 0) > started);
      for (final MapEntry<String, List<OutboxEntry>> o in overtaken.entries) {
        for (final OutboxEntry e in o.value) {
          if (!take.containsKey(o.key) || _stale(owner)) break;
          if ((_changedAt[o.key] ?? 0) > started) {
            take.remove(o.key);
            break;
          }
          await _outbox.discard(e.id);
        }
      }
      take.removeWhere((String key, _) => (_changedAt[key] ?? 0) > started);
      if (take.isEmpty || _stale(owner)) return;
      await _apply(take);
      for (final String key in overtaken.keys) {
        if (!take.containsKey(key) || _stale(owner)) continue;
        _onConflict?.call(key);
      }
    } catch (_) {
      // Offline, refused, or a store that would not answer: the device keeps
      // what it shows, and the next trigger reads again.
    }
  }

  bool _stale(String owner) => _disposed || _currentUser() != owner;

  /// The version [e]'s change really follows. A change queued behind this
  /// device's OWN accepted write to the same key was based on the version
  /// before it; the version that write produced is the one it follows.
  static int _baseOf(_Versions doc, String key, OutboxEntry e) {
    final int queued = e.body['base_version'] is int
        ? e.body['base_version'] as int
        : 0;
    final List<int>? own = doc.own[key];
    return own != null && own[0] == queued ? own[1] : queued;
  }

  /// The keys [owner]'s ACCOUNT holds — a version above 0 on this device's
  /// record. Read BEFORE [forget]: a sign-out resets these and [pendingKeys]
  /// (they come back at the next sign-in); every other key is a device choice
  /// the account never held, and is left alone (review #1080 delta finding 1).
  /// Never throws.
  Future<Set<String>> heldKeys(String owner) async {
    try {
      final _Versions doc = await _locked(() => _load(owner));
      return <String>{
        for (final MapEntry<String, int> e in doc.versions.entries)
          if (e.value > 0) e.key,
      };
    } catch (_) {
      return <String>{};
    }
  }

  /// The keys [owner] changed on this device that the account has NOT yet
  /// acknowledged — offline, in backoff, or waiting on an older Worker. Read
  /// BEFORE a sign-out: they are the leaving account's too, so they are reset
  /// on this device with the held ones (review 3 of #1080, finding 1 — the
  /// lead's decision). Never throws.
  Future<Set<String>> pendingKeys(String owner) async {
    try {
      return <String>{
        for (final OutboxEntry e in await _outbox.pending(owner: owner))
          if (e.kind == kPreferenceOutboxKind) e.recordId,
      };
    } catch (_) {
      return <String>{};
    }
  }

  /// [owner] signed out: forget their versions — this device's record of what
  /// the account holds. Never throws.
  ///
  /// 🔴 THEIR PENDING SENDS ARE KEPT (review 3 of #1080, finding 1 — the lead's
  /// decision). Each is bound to [owner] in the shared queue, so no other
  /// account's replay ever sends it, and [owner]'s next sign-in delivers it.
  /// Dropping it would lose a change the user made while signed in.
  ///
  /// [erase]: the account was DELETED (review 4 of #1080, finding 1). Its
  /// pending sends can never be delivered, and neither the owner id nor the
  /// values may outlive the account on this device: they are discarded.
  Future<void> forget(String owner, {bool erase = false}) async {
    _changedAt.clear();
    if (erase) {
      try {
        await _outbox.discardOwner(owner);
      } catch (_) {}
    }
    try {
      await _locked(() async => (await _store).remove(versionsKey(owner)));
    } catch (_) {}
  }

  /// Stop: nothing this instance has in flight is applied after this.
  void dispose() => _disposed = true;

  Future<T> _locked<T>(Future<T> Function() body) {
    final Future<void> previous = _tail;
    final Completer<void> mine = Completer<void>();
    _tail = mine.future;
    return previous.then((_) => body()).whenComplete(mine.complete);
  }

  Future<_Versions> _load(String owner) async {
    try {
      return _Versions.decode(await (await _store).read(versionsKey(owner)));
    } catch (_) {
      return _Versions.decode(null);
    }
  }

  Future<void> _save(String owner, _Versions doc) async =>
      (await _store).write(versionsKey(owner), doc.encode());
}

/// The versions this device holds for one user, and its own last accepted
/// write per key (`[base, produced]`).
class _Versions {
  _Versions(this.versions, this.own);

  factory _Versions.decode(String? raw) {
    Object? d;
    try {
      d = raw == null ? null : jsonDecode(raw);
    } on FormatException {
      d = null;
    }
    final Map<String, int> versions = <String, int>{};
    final Map<String, List<int>> own = <String, List<int>>{};
    if (d is Map<String, dynamic>) {
      final Object? v = d['v'];
      if (v is Map<String, dynamic>) {
        v.forEach((String k, Object? n) {
          if (n is int) versions[k] = n;
        });
      }
      final Object? o = d['own'];
      if (o is Map<String, dynamic>) {
        o.forEach((String k, Object? pair) {
          if (pair is List &&
              pair.length == 2 &&
              pair.every((Object? x) => x is int)) {
            own[k] = <int>[pair[0] as int, pair[1] as int];
          }
        });
      }
    }
    return _Versions(versions, own);
  }

  final Map<String, int> versions;
  final Map<String, List<int>> own;

  String encode() => jsonEncode(<String, Object?>{'v': versions, 'own': own});
}
