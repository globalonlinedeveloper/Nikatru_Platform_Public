import 'dart:async';
import 'dart:convert';
import 'dart:math' show Random;

import '../storage/key_value_store.dart';

// ═════════════════════════════════════════════════════════════════════════════
// THE ONE DURABLE CLIENT OUTBOX — every write a device could not send yet.
//
// ⏱ 2026-09-30 · lead ruling on #1075 (review fix-rv2-offline-core): ONE shared
// primitive, here in core, used by the subscription outbox (#1075) and the
// preferences sync (#1080). Five properties, each a finding it closes:
//
// 🔴 USER-SCOPED. Every entry carries the user id it was queued under, and
//   [DurableOutbox.replay] sends ONLY the replaying user's entries — it takes
//   `currentOwner` and re-reads it before EVERY send, aborting on a change. A
//   write queued by one account is never sent under the next account's session
//   (review finding 1). An explicit sign-out calls [DurableOutbox.discardOwner];
//   a forced 401 keeps the entries for that same user's return.
// 🔴 PERSISTED. The queue is one JSON document in the key-value store, read on
//   every operation, so it survives a restart and is shared by every instance
//   over the same store.
// 🔴 SERIALISED. Every read-modify-write runs under one async lock per store
//   (and per key), across instances. A replay never writes back a snapshot: it
//   removes the entry it sent BY ID from a fresh read, so an entry queued while
//   it ran survives (finding 2). A [DurableOutbox.clear]/[discardOwner] bumps a
//   generation that aborts a replay mid-run and forbids its write-back.
// 🔴 BOUNDED. A transient failure (5xx, a timeout the classifier says is not
//   "offline") costs an attempt and an exponential backoff; at
//   [DurableOutbox.maxAttempts] the entry becomes a DEAD LETTER the UI can show
//   ("couldn't sync this change — retry or discard"). A refusal is a dead letter
//   at once. "Offline" costs nothing: a week on a plane is not five failures.
//   One stuck entry never blocks the others — only later ops on the SAME record.
// 🔴 ORDERED AND COALESCED PER RECORD. Operations on one record replay in the
//   order they were made. Before anything is sent they collapse: create+update
//   is one create, update+update one update, update+delete one delete, and a
//   delete of a record whose create never reached the server cancels both — it
//   sends nothing (finding 4). A create that WAS attempted may have committed
//   with its response lost, so a delete then queues behind it instead.
// ═════════════════════════════════════════════════════════════════════════════

/// The store key an outbox lives under unless the caller names another.
const String kOutboxStoreKey = 'nikatru.outbox.v1';

/// What an entry does to its record — the part coalescing reasons about.
enum OutboxOp { create, update, delete }

/// How a failed send is treated. See the header.
enum OutboxFailure {
  /// The device cannot reach the server. Costs no attempt; stops the run.
  offline,

  /// The session was not accepted (401). Costs no attempt; stops the run and
  /// keeps the entry for its owner.
  unauthorized,

  /// Worth retrying later (5xx, 408, 429, a malformed answer). Costs an attempt.
  transient,

  /// The server said no to this request. A dead letter at once.
  refused,
}

/// One write waiting for the server.
class OutboxEntry {
  const OutboxEntry({
    required this.id,
    required this.owner,
    required this.recordId,
    required this.op,
    required this.kind,
    required this.body,
    required this.queuedAt,
    this.attempts = 0,
    this.nextAttemptAt,
    this.lastError,
    this.dead = false,
  });

  /// The client-minted id — the `Idempotency-Key` every attempt sends.
  final String id;

  /// The user id the entry was queued under. Only that user replays it.
  final String owner;

  /// The record it acts on: a server id, or a client id for a record the
  /// server has not seen yet.
  final String recordId;

  final OutboxOp op;

  /// The caller's own name for the write (e.g. `subscription`); the sender
  /// dispatches on it and holds a kind it does not know.
  final String kind;

  /// The request body, as JSON.
  final Map<String, dynamic> body;

  final DateTime queuedAt;

  /// Failed attempts that counted (never "offline").
  final int attempts;

  /// Not before this instant (the backoff). Null = now.
  final DateTime? nextAttemptAt;

  /// The last failure, for the dead-letter row. Never row content.
  final String? lastError;

  /// A dead letter: not sent again until [DurableOutbox.retry].
  final bool dead;

  OutboxEntry copyWith({
    String? recordId,
    Map<String, dynamic>? body,
    int? attempts,
    DateTime? nextAttemptAt,
    bool clearNextAttempt = false,
    String? lastError,
    bool? dead,
  }) => OutboxEntry(
    id: id,
    owner: owner,
    recordId: recordId ?? this.recordId,
    op: op,
    kind: kind,
    body: body ?? this.body,
    queuedAt: queuedAt,
    attempts: attempts ?? this.attempts,
    nextAttemptAt: clearNextAttempt
        ? null
        : (nextAttemptAt ?? this.nextAttemptAt),
    lastError: lastError ?? this.lastError,
    dead: dead ?? this.dead,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'owner': owner,
    'record': recordId,
    'op': op.name,
    'kind': kind,
    'body': body,
    'queued_at': queuedAt.toUtc().toIso8601String(),
    'attempts': attempts,
    if (nextAttemptAt != null)
      'next_at': nextAttemptAt!.toUtc().toIso8601String(),
    if (lastError != null) 'error': lastError,
    if (dead) 'dead': true,
  };

  /// Rebuild a stored entry; null when [json] is not one.
  static OutboxEntry? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final Object? id = json['id'];
    final Object? owner = json['owner'];
    final Object? record = json['record'];
    final Object? kind = json['kind'];
    final Object? body = json['body'];
    final OutboxOp? op = OutboxOp.values
        .where((OutboxOp o) => o.name == json['op'])
        .firstOrNull;
    if (id is! String ||
        owner is! String ||
        record is! String ||
        kind is! String ||
        body is! Map<String, dynamic> ||
        op == null) {
      return null;
    }
    DateTime? at(Object? v) => v is String ? DateTime.tryParse(v) : null;
    return OutboxEntry(
      id: id,
      owner: owner,
      recordId: record,
      op: op,
      kind: kind,
      body: body,
      queuedAt: at(json['queued_at']) ?? DateTime.now(),
      attempts: json['attempts'] is int ? json['attempts'] as int : 0,
      nextAttemptAt: at(json['next_at']),
      lastError: json['error'] is String ? json['error'] as String : null,
      dead: json['dead'] == true,
    );
  }
}

/// What [DurableOutbox.enqueue] did.
class OutboxEnqueueResult {
  const OutboxEnqueueResult._(this.entry, {required this.cancelled});

  /// The entry that now carries the write (a new one, or the one it merged
  /// into); null when the write cancelled out.
  final OutboxEntry? entry;

  /// True when a delete cancelled a create the server never saw: nothing will
  /// be sent for the record, and the caller drops it locally.
  final bool cancelled;
}

/// What one [DurableOutbox.replay] run did.
class OutboxReplayResult {
  const OutboxReplayResult({
    this.sent = 0,
    this.deadLettered = 0,
    this.aborted = false,
    this.stoppedOffline = false,
  });

  final int sent;
  final int deadLettered;

  /// The owner changed, or the queue was cleared, mid-run.
  final bool aborted;

  /// The run met an unreachable server and stopped.
  final bool stoppedOffline;
}

/// The lock, the generation and the single replay, per store and key — shared
/// by every [DurableOutbox] over the same store.
class _Shared {
  Future<void> tail = Future<void>.value();
  int generation = 0;
  String? sending;
  Future<OutboxReplayResult>? replaying;
}

final Expando<Map<String, _Shared>> _sharedByStore =
    Expando<Map<String, _Shared>>('DurableOutbox');

/// See the header.
class DurableOutbox {
  DurableOutbox(
    this._store, {
    this.key = kOutboxStoreKey,
    this.maxAttempts = 5,
    this.baseBackoff = const Duration(seconds: 2),
    this.maxBackoff = const Duration(minutes: 5),
    DateTime Function()? now,
    void Function()? onChanged,
  }) : _now = now ?? DateTime.now,
       _onChanged = onChanged;

  final Future<KeyValueStore> _store;
  final DateTime Function() _now;
  final void Function()? _onChanged;

  /// The store key the queue lives under.
  final String key;

  /// Counted failures before an entry becomes a dead letter.
  final int maxAttempts;
  final Duration baseBackoff;
  final Duration maxBackoff;

  _Shared _sharedFor(KeyValueStore kv) =>
      (_sharedByStore[kv] ??= <String, _Shared>{})[key] ??= _Shared();

  Future<T> _locked<T>(
    Future<T> Function(KeyValueStore kv, _Shared shared) body,
  ) async {
    final KeyValueStore kv = await _store;
    final _Shared shared = _sharedFor(kv);
    final Future<void> previous = shared.tail;
    final Completer<void> mine = Completer<void>();
    shared.tail = mine.future;
    try {
      await previous;
      return await body(kv, shared);
    } finally {
      mine.complete();
    }
  }

  Future<_Doc> _read(KeyValueStore kv) async {
    final String? raw;
    try {
      raw = await kv.read(key);
    } catch (_) {
      return _Doc(<OutboxEntry>[], <String, String>{});
    }
    return _Doc.decode(raw);
  }

  Future<void> _write(KeyValueStore kv, _Doc doc) async {
    await kv.write(key, doc.encode());
    _onChanged?.call();
  }

  /// Every entry (dead letters included) — of [owner] only, when given.
  Future<List<OutboxEntry>> entries({String? owner}) =>
      _locked((KeyValueStore kv, _) async {
        final _Doc doc = await _read(kv);
        return doc.entries
            .where((OutboxEntry e) => owner == null || e.owner == owner)
            .toList();
      });

  /// Entries still to send (not dead).
  Future<List<OutboxEntry>> pending({String? owner}) async =>
      (await entries(owner: owner)).where((OutboxEntry e) => !e.dead).toList();

  /// Dead letters: what the UI offers to retry or discard.
  Future<List<OutboxEntry>> deadLetters({String? owner}) async =>
      (await entries(owner: owner)).where((OutboxEntry e) => e.dead).toList();

  /// The server id a client [recordId] was resolved to, or [recordId] itself.
  Future<String> resolve(String recordId) =>
      _locked((KeyValueStore kv, _) async {
        final _Doc doc = await _read(kv);
        return doc.aliases[recordId] ?? recordId;
      });

  /// Queue a write, coalescing it with what is already waiting for the same
  /// record (see the header). Throws whatever the store throws on write: the
  /// caller must then tell the user the write was NOT kept.
  Future<OutboxEnqueueResult> enqueue({
    required String owner,
    required String recordId,
    required OutboxOp op,
    required String kind,
    Map<String, dynamic> body = const <String, dynamic>{},
    String? id,
  }) => _locked((KeyValueStore kv, _Shared shared) async {
    final _Doc doc = await _read(kv);
    final String record = doc.aliases[recordId] ?? recordId;
    final OutboxEntry fresh = OutboxEntry(
      id: id ?? newOutboxId(),
      owner: owner,
      recordId: record,
      op: op,
      kind: kind,
      body: body,
      queuedAt: _now(),
    );
    // The entries for this record that may still change: not the one in flight.
    final List<OutboxEntry> same = doc.entries
        .where(
          (OutboxEntry e) =>
              e.owner == owner &&
              e.recordId == record &&
              e.id != shared.sending,
        )
        .toList();
    final OutboxEntry? last = same.isEmpty ? null : same.last;
    final bool lastIsLatest =
        last != null &&
        !doc.entries.any(
          (OutboxEntry e) =>
              e.owner == owner &&
              e.recordId == record &&
              doc.entries.indexOf(e) > doc.entries.indexOf(last),
        );

    OutboxEnqueueResult result;
    switch (op) {
      case OutboxOp.create:
        doc.entries.add(fresh);
        result = OutboxEnqueueResult._(fresh, cancelled: false);
      case OutboxOp.update:
        if (lastIsLatest && last.op != OutboxOp.delete) {
          // Merge into the create/update still waiting; an edit re-queues a
          // dead letter (the user just changed what was refused).
          final OutboxEntry merged = last.copyWith(
            body: <String, dynamic>{...last.body, ...body},
            dead: false,
            attempts: last.dead ? 0 : last.attempts,
            clearNextAttempt: last.dead,
          );
          doc.entries[doc.entries.indexOf(last)] = merged;
          result = OutboxEnqueueResult._(merged, cancelled: false);
        } else {
          doc.entries.add(fresh);
          result = OutboxEnqueueResult._(fresh, cancelled: false);
        }
      case OutboxOp.delete:
        final OutboxEntry? create = same
            .where((OutboxEntry e) => e.op == OutboxOp.create)
            .firstOrNull;
        // Never attempted, or refused: the server has no such row.
        final bool neverReached =
            create != null && (create.attempts == 0 || create.dead);
        final bool inFlight = doc.entries.any(
          (OutboxEntry e) =>
              e.owner == owner &&
              e.recordId == record &&
              e.id == shared.sending,
        );
        doc.entries.removeWhere(
          (OutboxEntry e) =>
              e.owner == owner &&
              e.recordId == record &&
              e.id != shared.sending &&
              (e.op == OutboxOp.update || (neverReached && e == create)),
        );
        if (neverReached && !inFlight) {
          result = const OutboxEnqueueResult._(null, cancelled: true);
        } else {
          doc.entries.add(fresh);
          result = OutboxEnqueueResult._(fresh, cancelled: false);
        }
    }
    await _write(kv, doc);
    return result;
  });

  /// Send [owner]'s waiting entries through [send], oldest first per record.
  ///
  /// [currentOwner] is read before every send; a change aborts the run. [send]
  /// returns the server's id for the record when it differs from the client id
  /// (a create), which later entries for the record are rewritten to.
  /// [classify] maps a thrown error to an [OutboxFailure]; unclassified errors
  /// are [OutboxFailure.transient]. An entry [accepts] refuses (a kind this
  /// sender does not know) is held, not sent. Concurrent callers share one run. Never
  /// throws: a store that refuses a write-back ends the run.
  Future<OutboxReplayResult> replay({
    required String owner,
    required String? Function() currentOwner,
    required Future<String?> Function(OutboxEntry entry) send,
    OutboxFailure Function(Object error)? classify,
    bool Function(OutboxEntry entry)? accepts,
  }) async {
    final KeyValueStore kv = await _store;
    final _Shared shared = _sharedFor(kv);
    return shared.replaying ??= _run(
      shared,
      owner,
      currentOwner,
      send,
      classify ?? (Object _) => OutboxFailure.transient,
      accepts ?? (OutboxEntry _) => true,
    ).whenComplete(() => shared.replaying = null);
  }

  Future<OutboxReplayResult> _run(
    _Shared shared,
    String owner,
    String? Function() currentOwner,
    Future<String?> Function(OutboxEntry entry) send,
    OutboxFailure Function(Object error) classify,
    bool Function(OutboxEntry entry) accepts,
  ) async {
    final int generation = shared.generation;
    final Set<String> attempted = <String>{};
    int sent = 0;
    int dead = 0;
    bool stale() => currentOwner() != owner || shared.generation != generation;
    try {
      while (true) {
        if (stale()) {
          return OutboxReplayResult(
            sent: sent,
            deadLettered: dead,
            aborted: true,
          );
        }
        final OutboxEntry? next = await _locked((KeyValueStore kv, _) async {
          final _Doc doc = await _read(kv);
          final DateTime now = _now();
          final Set<String> blocked = <String>{};
          for (final OutboxEntry e in doc.entries) {
            if (e.owner != owner) continue;
            if (blocked.contains(e.recordId)) continue;
            // Whatever happens to e, later ops on its record wait for it.
            blocked.add(e.recordId);
            // A kind this sender does not know is HELD, never sent or failed.
            if (e.dead || attempted.contains(e.id) || !accepts(e)) continue;
            if (e.nextAttemptAt != null && e.nextAttemptAt!.isAfter(now)) {
              continue;
            }
            shared.sending = e.id;
            return e;
          }
          return null;
        });
        if (next == null) {
          return OutboxReplayResult(sent: sent, deadLettered: dead);
        }
        attempted.add(next.id);
        if (stale()) {
          shared.sending = null;
          return OutboxReplayResult(
            sent: sent,
            deadLettered: dead,
            aborted: true,
          );
        }
        String? serverId;
        Object? error;
        try {
          serverId = await send(next);
        } catch (e) {
          error = e;
        }
        shared.sending = null;
        if (shared.generation != generation) {
          // Cleared or discarded while the request was out: write NOTHING back.
          return OutboxReplayResult(
            sent: sent,
            deadLettered: dead,
            aborted: true,
          );
        }
        final OutboxFailure? failure = error == null ? null : classify(error);
        if (failure == OutboxFailure.offline) {
          return OutboxReplayResult(
            sent: sent,
            deadLettered: dead,
            stoppedOffline: true,
          );
        }
        if (failure == OutboxFailure.unauthorized) {
          return OutboxReplayResult(sent: sent, deadLettered: dead);
        }
        await _locked((KeyValueStore kv, _) async {
          final _Doc doc = await _read(kv);
          final int i = doc.entries.indexWhere(
            (OutboxEntry e) => e.id == next.id,
          );
          if (i < 0) return; // discarded while it was out
          if (failure == null) {
            doc.entries.removeAt(i);
            if (serverId != null && serverId != next.recordId) {
              doc.aliases[next.recordId] = serverId;
              for (int j = 0; j < doc.entries.length; j++) {
                final OutboxEntry e = doc.entries[j];
                if (e.owner == owner && e.recordId == next.recordId) {
                  doc.entries[j] = e.copyWith(recordId: serverId);
                }
              }
            }
            sent += 1;
          } else {
            final int attempts = doc.entries[i].attempts + 1;
            final bool isDead =
                failure == OutboxFailure.refused || attempts >= maxAttempts;
            if (isDead) dead += 1;
            doc.entries[i] = doc.entries[i].copyWith(
              attempts: attempts,
              dead: isDead,
              lastError: _describe(error!),
              nextAttemptAt: isDead ? null : _now().add(_backoff(attempts)),
              clearNextAttempt: isDead,
            );
          }
          await _write(kv, doc);
        });
      }
    } catch (_) {
      // The store refused a write-back: the entry stays as it was, and the
      // next run tries again. Never thrown to the reader that triggered it.
      shared.sending = null;
      return OutboxReplayResult(sent: sent, deadLettered: dead);
    }
  }

  Duration _backoff(int attempts) {
    final int factor = 1 << (attempts - 1).clamp(0, 20);
    final Duration d = baseBackoff * factor;
    return d > maxBackoff ? maxBackoff : d;
  }

  static String _describe(Object error) {
    final String s = error.toString();
    return s.length > 200 ? s.substring(0, 200) : s;
  }

  /// Put a dead letter back in the queue with a fresh attempt budget.
  Future<void> retry(String id) => _locked((KeyValueStore kv, _) async {
    final _Doc doc = await _read(kv);
    final int i = doc.entries.indexWhere((OutboxEntry e) => e.id == id);
    if (i < 0) return;
    doc.entries[i] = doc.entries[i].copyWith(
      dead: false,
      attempts: 0,
      clearNextAttempt: true,
    );
    await _write(kv, doc);
  });

  /// Drop one entry — the dead letter's "discard".
  Future<void> discard(String id) => _locked((KeyValueStore kv, _) async {
    final _Doc doc = await _read(kv);
    doc.entries.removeWhere((OutboxEntry e) => e.id == id);
    await _write(kv, doc);
  });

  /// Forget every entry [owner] queued — the explicit sign-out. Aborts a
  /// replay in flight.
  Future<void> discardOwner(String owner) =>
      _locked((KeyValueStore kv, _Shared shared) async {
        shared.generation += 1;
        final _Doc doc = await _read(kv);
        doc.entries.removeWhere((OutboxEntry e) => e.owner == owner);
        await _write(kv, doc);
      });

  /// Forget everything. Aborts a replay in flight.
  Future<void> clear() => _locked((KeyValueStore kv, _Shared shared) async {
    shared.generation += 1;
    await kv.remove(key);
    _onChanged?.call();
  });
}

/// A fresh client id: a random (version 4) UUID.
String newOutboxId() {
  final List<int> b = List<int>.generate(16, (_) => _random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final String h = b.map((int x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
      '${h.substring(16, 20)}-${h.substring(20)}';
}

final Random _random = Random.secure();

class _Doc {
  _Doc(this.entries, this.aliases);

  factory _Doc.decode(String? raw) {
    if (raw == null) return _Doc(<OutboxEntry>[], <String, String>{});
    Object? d;
    try {
      d = jsonDecode(raw);
    } on FormatException {
      d = null;
    }
    if (d is! Map<String, dynamic>) {
      return _Doc(<OutboxEntry>[], <String, String>{});
    }
    final Object? es = d['entries'];
    final Object? as = d['aliases'];
    return _Doc(
      es is List<Object?>
          ? es.map(OutboxEntry.fromJson).nonNulls.toList()
          : <OutboxEntry>[],
      as is Map<String, dynamic>
          ? <String, String>{
              for (final MapEntry<String, dynamic> m in as.entries)
                if (m.value is String) m.key: m.value as String,
            }
          : <String, String>{},
    );
  }

  final List<OutboxEntry> entries;
  final Map<String, String> aliases;

  String encode() => jsonEncode(<String, dynamic>{
    'v': 1,
    'entries': entries.map((OutboxEntry e) => e.toJson()).toList(),
    'aliases': aliases,
  });
}
