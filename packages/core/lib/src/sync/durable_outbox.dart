import 'dart:async';
import 'dart:convert';
import 'dart:math' show Random;

import '../storage/key_value_store.dart';

// ═════════════════════════════════════════════════════════════════════════════
// THE ONE DURABLE CLIENT OUTBOX — every write a device could not send yet.
//
// ⏱ 2026-09-30 · lead ruling on #1075 (review fix-rv2-offline-core): ONE shared
// primitive, here in core, used by the subscription outbox (#1075) and the
// preferences sync (#1080). Its properties, each a finding it closes:
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
// 🔴 A FAILED READ NEVER WIPES THE QUEUE (review 2, minor e). A read is retried;
//   if the store still will not answer, [OutboxStoreFailure] is thrown — a
//   mutation aborts and writes nothing, so what is stored stays stored.
// 🔴 SERIALISED. Every read-modify-write runs under one async lock per store
//   (and per key), across instances in one isolate (two browser tabs over one
//   localStorage are two isolates: the server's Idempotency-Key ledger keeps a
//   duplicate send harmless, but a tab's write-back can overwrite the other's
//   enqueue). A replay never writes back a snapshot: it reconciles the entry it
//   sent BY ID AND REVISION from a fresh read (review 2, minor a): an entry
//   that changed while its request was out is kept and sent again. A
//   [DurableOutbox.clear]/[discardOwner] bumps a generation that aborts a replay
//   mid-run and forbids its write-back.
// 🔴 BOUNDED. A transient failure costs an attempt and an exponential backoff;
//   at [DurableOutbox.maxAttempts] the entry becomes a DEAD LETTER the UI can
//   show ("couldn't sync this change — retry or discard"). A refusal (the
//   classifier's word, and an undecodable answer is one) is a dead letter at
//   once. "Offline" costs nothing: a week on a plane is not five failures. One
//   stuck entry never blocks the others — only later ops on the SAME record.
// 🔴 ORDERED AND COALESCED PER RECORD, ON WHAT THE SERVER MAY HAVE SEEN (review
//   2, major 1). [OutboxEntry.mayHaveReached] is set BEFORE every dispatch — a
//   request whose response was lost looks exactly like one that never left, so
//   only an entry that has never been dispatched is known unseen. Operations on
//   one record replay in order and, before anything is sent, collapse:
//   update+update is one update and update+delete one delete; an edit merges
//   into a create ONLY while that create has never left the device, and a
//   delete cancels a create (sending nothing) ONLY then. Otherwise the edit or
//   the delete queues BEHIND the create and is sent to the server id the
//   create's replay returns.
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

  /// Worth retrying later (5xx, 408, 429). Costs an attempt.
  transient,

  /// The server is still PROCESSING this very write (a 409
  /// `idempotency_in_progress` on its Idempotency-Key; any other 409 is a
  /// refusal — review #1075 round 4, minor 1). Costs NO attempt and never
  /// becomes a dead letter: the entry waits — the server's `Retry-After` when
  /// it sent one, a backoff capped at [DurableOutbox.maxBackoff] otherwise —
  /// for as long as the server holds the claim (review #1075 round 3, minor
  /// d: 5 counted 409s dead-lettered an add in ~30 s while the server abandons
  /// a claim only after 10 minutes).
  busy,

  /// The server said no to this request, or answered what cannot be read. A
  /// dead letter at once.
  refused,
}

/// The store could not be read, so nothing was changed. See the header.
class OutboxStoreFailure implements Exception {
  const OutboxStoreFailure(this.cause);
  final Object cause;
  @override
  String toString() =>
      'OutboxStoreFailure: the outbox could not be read — $cause';
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
    this.mayHaveReached = false,
    this.rev = 0,
    this.waits = 0,
    this.serverWaitUntil,
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

  /// Whether a request for this entry has EVER been dispatched — set before
  /// the dispatch, so a lost response still counts. See the header.
  final bool mayHaveReached;

  /// Bumped by every merge into this entry; the write-back after a send
  /// removes the entry only when the revision it sent is still current.
  final int rev;

  /// How many times the server answered "still processing" ([OutboxFailure.busy]):
  /// the busy backoff grows with it; it never counts as an attempt.
  final int waits;

  /// Not before this instant BECAUSE THE SERVER SAID SO (its `Retry-After`).
  /// A fresh change resets the client's own backoff, never this (review 4 of
  /// #1080): a tap during a rate limit must not send at once.
  final DateTime? serverWaitUntil;

  OutboxEntry copyWith({
    String? recordId,
    Map<String, dynamic>? body,
    int? attempts,
    DateTime? nextAttemptAt,
    bool clearNextAttempt = false,
    String? lastError,
    bool? dead,
    bool? mayHaveReached,
    int? rev,
    int? waits,
    DateTime? serverWaitUntil,
    bool clearServerWait = false,
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
    mayHaveReached: mayHaveReached ?? this.mayHaveReached,
    rev: rev ?? this.rev,
    waits: waits ?? this.waits,
    serverWaitUntil: clearServerWait
        ? null
        : (serverWaitUntil ?? this.serverWaitUntil),
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
    if (mayHaveReached) 'sent': true,
    'rev': rev,
    if (waits > 0) 'waits': waits,
    if (serverWaitUntil != null)
      'server_until': serverWaitUntil!.toUtc().toIso8601String(),
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
      // A stored entry that predates the flag is treated as possibly seen:
      // the safe direction (it is sent, never silently cancelled).
      mayHaveReached: json['sent'] == true || json['attempts'] != 0,
      rev: json['rev'] is int ? json['rev'] as int : 0,
      waits: json['waits'] is int ? json['waits'] as int : 0,
      serverWaitUntil: at(json['server_until']),
    );
  }
}

/// What [DurableOutbox.enqueue] did.
class OutboxEnqueueResult {
  const OutboxEnqueueResult._(this.entry, {required this.cancelled});

  /// The entry that now carries the write (a new one, or the one it merged
  /// into); null when the write cancelled out.
  final OutboxEntry? entry;

  /// True when a delete cancelled a create that was never dispatched: nothing
  /// will be sent for the record, and the caller drops it locally.
  final bool cancelled;
}

/// What one [DurableOutbox.replay] run did.
class OutboxReplayResult {
  const OutboxReplayResult({
    this.sent = 0,
    this.deadLettered = 0,
    this.aborted = false,
    this.stoppedOffline = false,
    this.storeError,
  });

  final int sent;
  final int deadLettered;

  /// The owner changed, or the queue was cleared, mid-run.
  final bool aborted;

  /// The run met an unreachable server and stopped.
  final bool stoppedOffline;

  /// The store could not be read or written; nothing was lost, the run ended.
  final Object? storeError;
}

/// The lock, the generation and the single replay, per store and key — shared
/// by every [DurableOutbox] over the same store in this isolate.
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
    this.readAttempts = 3,
    DateTime Function()? now,
    void Function()? onChanged,
    Duration Function(Duration backoff, Duration? retryAfter)? retryWait,
  }) : _now = now ?? DateTime.now,
       _onChanged = onChanged,
       _retryWait = retryWait;

  final Future<KeyValueStore> _store;
  final DateTime Function() _now;
  final void Function()? _onChanged;

  /// How long a counted failure waits, from the exponential backoff and the
  /// server's `Retry-After` (when it sent one). Null: the backoff, exactly.
  /// The preferences queue sets it (review 3 of #1080: Retry-After and jitter).
  final Duration Function(Duration backoff, Duration? retryAfter)? _retryWait;

  /// The store key the queue lives under.
  final String key;

  /// Counted failures before an entry becomes a dead letter.
  final int maxAttempts;
  final Duration baseBackoff;
  final Duration maxBackoff;

  /// How many times a store read is tried before [OutboxStoreFailure].
  final int readAttempts;

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

  /// The stored document. Retried; throws [OutboxStoreFailure] rather than
  /// answer "empty" for a store that did not answer — see the header.
  Future<_Doc> _read(KeyValueStore kv) async {
    Object? last;
    for (int i = 0; i < readAttempts; i++) {
      try {
        return _Doc.decode(await kv.read(key));
      } catch (e) {
        last = e;
      }
    }
    throw OutboxStoreFailure(last!);
  }

  Future<void> _write(KeyValueStore kv, _Doc doc) async {
    await kv.write(key, doc.encode());
    _onChanged?.call();
  }

  /// Every entry (dead letters included) — of [owner] only, when given.
  /// Throws [OutboxStoreFailure] when the store cannot be read.
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
  /// record (see the header). [mayHaveReached] is true when the caller already
  /// dispatched this write once itself (a first attempt whose outcome is
  /// unknown). [freshBackoff]: a merge into a waiting entry also clears its
  /// backoff, so a NEW change is tried at once (review 3 of #1080) — but not
  /// before a wait the SERVER imposed ([OutboxEntry.serverWaitUntil]). Throws
  /// whatever the store throws: the caller must then tell the user the write
  /// was NOT kept.
  Future<OutboxEnqueueResult> enqueue({
    required String owner,
    required String recordId,
    required OutboxOp op,
    required String kind,
    Map<String, dynamic> body = const <String, dynamic>{},
    String? id,
    bool mayHaveReached = false,
    bool freshBackoff = false,
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
      mayHaveReached: mayHaveReached,
    );
    bool mine(OutboxEntry e) => e.owner == owner && e.recordId == record;
    final List<OutboxEntry> same = doc.entries.where(mine).toList();
    final OutboxEntry? last = same.isEmpty ? null : same.last;
    // The last entry for the record may absorb this one only while it is not
    // the request in flight and not a dead letter.
    final bool open = last != null && last.id != shared.sending && !last.dead;

    OutboxEnqueueResult result;
    switch (op) {
      case OutboxOp.create:
        doc.entries.add(fresh);
        result = OutboxEnqueueResult._(fresh, cancelled: false);
      case OutboxOp.update:
        final bool intoCreate =
            open && last.op == OutboxOp.create && !last.mayHaveReached;
        final bool intoUpdate = open && last.op == OutboxOp.update;
        if (intoCreate || intoUpdate) {
          final DateTime? asked = last.serverWaitUntil;
          final bool serverHolds =
              freshBackoff && asked != null && asked.isAfter(_now());
          final OutboxEntry merged = last.copyWith(
            body: <String, dynamic>{...last.body, ...body},
            rev: last.rev + 1,
            attempts: freshBackoff ? 0 : null,
            waits: freshBackoff ? 0 : null,
            clearNextAttempt: freshBackoff && !serverHolds,
            nextAttemptAt: serverHolds ? asked : null,
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
        final bool unseen =
            create != null &&
            !create.mayHaveReached &&
            create.id != shared.sending;
        // Updates not in flight are moot once the record is deleted.
        doc.entries.removeWhere(
          (OutboxEntry e) =>
              mine(e) &&
              e.id != shared.sending &&
              (e.op == OutboxOp.update || (unseen && e.id == create.id)),
        );
        if (unseen) {
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
  /// sender does not know) is held, not sent. Concurrent callers share one run.
  /// Never throws: a store that fails ends the run with [storeError] set.
  Future<OutboxReplayResult> replay({
    required String owner,
    required String? Function() currentOwner,
    required Future<String?> Function(OutboxEntry entry) send,
    OutboxFailure Function(Object error)? classify,
    bool Function(OutboxEntry entry)? accepts,
    Duration? Function(Object error)? retryAfter,
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
      retryAfter ?? (Object _) => null,
    ).whenComplete(() => shared.replaying = null);
  }

  Future<OutboxReplayResult> _run(
    _Shared shared,
    String owner,
    String? Function() currentOwner,
    Future<String?> Function(OutboxEntry entry) send,
    OutboxFailure Function(Object error) classify,
    bool Function(OutboxEntry entry) accepts,
    Duration? Function(Object error) retryAfter,
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
        final OutboxEntry? next = await _pick(owner, attempted, accepts);
        if (next == null) {
          return OutboxReplayResult(sent: sent, deadLettered: dead);
        }
        attempted.add(next.id);
        if (stale()) {
          await _release();
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
        if (shared.generation != generation) {
          // Cleared or discarded while the request was out: write NOTHING back.
          await _release();
          return OutboxReplayResult(
            sent: sent,
            deadLettered: dead,
            aborted: true,
          );
        }
        // A method with plain arguments, not a closure over this loop's locals:
        // dart2js boxed the captured locals across iterations, so on web a
        // success once wrote back through the PREVIOUS failure's branch.
        final OutboxFailure? failure = error == null ? null : classify(error);
        final _Settled settled = await _writeBack(
          owner,
          next,
          serverId,
          failure,
          error == null ? null : _describe(error),
          error == null ? null : retryAfter(error),
        );
        sent += settled.sent;
        dead += settled.dead;
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
      }
    } catch (e) {
      // The store failed a read or a write-back: what is stored stays stored,
      // and the next run tries again. Never thrown to the reader that
      // triggered it.
      await _release().catchError((Object _) {});
      return OutboxReplayResult(sent: sent, deadLettered: dead, storeError: e);
    }
  }

  /// The next entry to send, marked dispatched (persisted) BEFORE it is sent.
  Future<OutboxEntry?> _pick(
    String owner,
    Set<String> attempted,
    bool Function(OutboxEntry entry) accepts,
  ) => _locked((KeyValueStore kv, _Shared shared) async {
    final _Doc doc = await _read(kv);
    final DateTime now = _now();
    final Set<String> blocked = <String>{};
    for (int i = 0; i < doc.entries.length; i++) {
      final OutboxEntry e = doc.entries[i];
      if (e.owner != owner) continue;
      if (blocked.contains(e.recordId)) continue;
      // Whatever happens to e, later ops on its record wait for it.
      blocked.add(e.recordId);
      // A kind this sender does not know is HELD, never sent or failed.
      if (e.dead || attempted.contains(e.id) || !accepts(e)) continue;
      if (e.nextAttemptAt != null && e.nextAttemptAt!.isAfter(now)) continue;
      final OutboxEntry marked = e.copyWith(mayHaveReached: true);
      if (!e.mayHaveReached) {
        doc.entries[i] = marked;
        await _write(kv, doc);
      }
      shared.sending = e.id;
      return marked;
    }
    return null;
  });

  Future<void> _release() => _locked((KeyValueStore kv, _Shared shared) async {
    shared.sending = null;
  });

  /// Reconcile what happened to [entry]'s send with a fresh read, under the
  /// lock — by id AND revision: an entry that changed while its request was
  /// out is kept (and sent again), never removed with the change in it.
  Future<_Settled> _writeBack(
    String owner,
    OutboxEntry entry,
    String? serverId,
    OutboxFailure? failure,
    String? errorText,
    Duration? hint,
  ) => _locked((KeyValueStore kv, _Shared shared) async {
    shared.sending = null;
    if (failure == OutboxFailure.offline ||
        failure == OutboxFailure.unauthorized) {
      return const _Settled(0, 0);
    }
    final _Doc doc = await _read(kv);
    final int i = doc.entries.indexWhere((OutboxEntry e) => e.id == entry.id);
    int sent = 0;
    int dead = 0;
    if (failure == null) {
      if (i >= 0) {
        if (doc.entries[i].rev == entry.rev) {
          doc.entries.removeAt(i);
        }
        // else: merged into while out — keep it; the next run sends it again.
      }
      if (serverId != null && serverId != entry.recordId) {
        doc.aliases[entry.recordId] = serverId;
        for (int j = 0; j < doc.entries.length; j++) {
          final OutboxEntry e = doc.entries[j];
          if (e.owner == owner && e.recordId == entry.recordId) {
            doc.entries[j] = e.copyWith(recordId: serverId);
          }
        }
      }
      sent = 1;
    } else if (i >= 0 && failure == OutboxFailure.busy) {
      final int waits = doc.entries[i].waits + 1;
      Duration wait = _backoff(waits);
      if (hint != null && hint > wait) wait = hint;
      if (wait > maxBackoff) wait = maxBackoff;
      final DateTime until = _now().add(wait);
      doc.entries[i] = doc.entries[i].copyWith(
        waits: waits,
        lastError: errorText,
        nextAttemptAt: until,
        serverWaitUntil: hint != null ? until : null,
        clearServerWait: hint == null,
      );
    } else if (i >= 0) {
      final int attempts = doc.entries[i].attempts + 1;
      final bool isDead =
          failure == OutboxFailure.refused || attempts >= maxAttempts;
      if (isDead) dead = 1;
      final DateTime? until = isDead
          ? null
          : _now().add(_waitAfter(attempts, hint));
      doc.entries[i] = doc.entries[i].copyWith(
        attempts: attempts,
        dead: isDead,
        lastError: errorText,
        nextAttemptAt: until,
        clearNextAttempt: isDead,
        serverWaitUntil: hint != null ? until : null,
        clearServerWait: hint == null || isDead,
      );
    }
    await _write(kv, doc);
    return _Settled(sent, dead);
  });

  /// The wait after the [attempts]th counted failure; see [_retryWait].
  Duration _waitAfter(int attempts, Duration? hint) {
    final Duration backoff = _backoff(attempts);
    final Duration Function(Duration, Duration?)? policy = _retryWait;
    return policy == null ? backoff : policy(backoff, hint);
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

class _Settled {
  const _Settled(this.sent, this.dead);
  final int sent;
  final int dead;
}

class _Doc {
  _Doc(this.entries, this.aliases);

  /// A missing document is an empty queue; an unreadable one is too (its
  /// bytes cannot be sent). A store that does not ANSWER is not this.
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
