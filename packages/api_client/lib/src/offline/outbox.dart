import 'dart:async';
import 'dart:convert';
import 'dart:math';

import '../rest_client.dart' show ApiException;
import 'json_store.dart';

// ═════════════════════════════════════════════════════════════════════════════
// WRITES MADE OFFLINE ARE KEPT AND SENT LATER — ONCE (audit D22, ST-N5).
//
// 🔴 WHAT WAS BROKEN. The read-through cache served the last list offline, but
// an ADD made offline failed ("could not add") and the user had to type it all
// again later — while the listing said "Works offline". A write the user made
// is now kept on the device, in order, and replayed when the server answers.
//
// 🔴 IDEMPOTENT BY CLIENT ID, AND THAT IS THE WHOLE SAFETY ARGUMENT. Every
// queued write carries an [PendingWrite.id] minted on the device, sent as the
// `Idempotency-Key` header. A replay whose first attempt DID commit — the
// response was lost, the classic timeout — is answered with the row it already
// made instead of a second one (AB-O2-02, the server half). Without that key an
// outbox is a duplicate generator, which is why the server change lands first.
//
// ⚠️ REPLAY IS SINGLE-FLIGHT AND IN ORDER. Two callers asking to replay share
// one run, so a list read and a write racing after reconnect cannot both send
// the same entry. The run stops at the first TRANSPORT or SERVER failure and
// keeps the rest for the next reconnect; a write the server REFUSES (a 4xx
// other than 401/408/429) is dropped and reported through `onRefused`, because
// replaying a refusal forever blocks every write behind it.
//
// ⚠️ THE OUTBOX BELONGS TO ONE ACCOUNT. It is dropped on sign-out with the
// cache (every app's `userStateDrops`): a write queued by one user must never
// be replayed under the next user's session.
// ═════════════════════════════════════════════════════════════════════════════

/// The key the outbox is stored under unless a caller names another.
const String kOutboxKey = 'nikatru.outbox';

/// One write waiting for the server.
class PendingWrite {
  const PendingWrite({
    required this.id,
    required this.kind,
    required this.body,
    required this.queuedAt,
  });

  /// Rebuild a stored entry; null when [json] is not one.
  static PendingWrite? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final Object? id = json['id'];
    final Object? kind = json['kind'];
    final Object? body = json['body'];
    final Object? at = json['queued_at'];
    if (id is! String || kind is! String || body is! Map<String, dynamic>) {
      return null;
    }
    return PendingWrite(
      id: id,
      kind: kind,
      body: body,
      queuedAt: DateTime.tryParse(at is String ? at : '') ?? DateTime.now(),
    );
  }

  /// The client-minted id — the `Idempotency-Key` every attempt sends.
  final String id;

  /// What the write is, in the app's own words (e.g. `subscription.create`).
  final String kind;

  /// The request body, as JSON.
  final Map<String, dynamic> body;

  /// When the user made it.
  final DateTime queuedAt;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'kind': kind,
    'body': body,
    'queued_at': queuedAt.toUtc().toIso8601String(),
  };
}

/// What one [Outbox.replay] run did.
class ReplayResult {
  const ReplayResult({
    required this.sent,
    required this.refused,
    required this.remaining,
  });

  /// Entries the server accepted (or had already accepted) — gone from the box.
  final int sent;

  /// Entries the server refused — dropped and reported.
  final int refused;

  /// Entries still waiting, because the run stopped at an unreachable server.
  final int remaining;
}

/// Writes waiting for the server, persisted on the device. See the header.
class Outbox {
  Outbox(
    this._store, {
    this.key = kOutboxKey,
    void Function(PendingWrite write, ApiException refusal)? onRefused,
  }) : _onRefused = onRefused ?? _ignore;

  final KeyValueJsonStore _store;
  final void Function(PendingWrite write, ApiException refusal) _onRefused;

  /// The store key the queue lives under.
  final String key;

  static void _ignore(PendingWrite _, ApiException _) {}

  static final Random _random = Random.secure();

  /// A fresh client id: a random (version 4) UUID.
  static String newClientId() {
    final List<int> b = List<int>.generate(16, (_) => _random.nextInt(256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    final String h = b
        .map((int x) => x.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
        '${h.substring(16, 20)}-${h.substring(20)}';
  }

  static final CacheCodec<List<PendingWrite>> _codec =
      CacheCodec<List<PendingWrite>>(
        encode: (List<PendingWrite> ws) =>
            jsonEncode(ws.map((PendingWrite w) => w.toJson()).toList()),
        decode: (String raw) {
          final Object? decoded;
          try {
            decoded = jsonDecode(raw);
          } on FormatException {
            return null;
          }
          if (decoded is! List<Object?>) return null;
          return decoded.map(PendingWrite.fromJson).nonNulls.toList();
        },
      );

  /// The writes still waiting, oldest first.
  Future<List<PendingWrite>> pending() async =>
      await _store.read(key, _codec) ?? <PendingWrite>[];

  /// Keep [write] for replay. Throws [StoreWriteFailure] when the device will
  /// not keep it — the caller must then tell the user the write was NOT saved.
  Future<void> enqueue(PendingWrite write) async {
    final List<PendingWrite> now = await pending();
    await _store.write(key, <PendingWrite>[...now, write], _codec);
  }

  Future<ReplayResult>? _inFlight;

  /// Send every waiting write through [send], oldest first. See the header for
  /// when a run stops and when an entry is dropped. Concurrent callers share
  /// the run already in flight.
  Future<ReplayResult> replay(Future<void> Function(PendingWrite write) send) =>
      _inFlight ??= _replay(send).whenComplete(() => _inFlight = null);

  Future<ReplayResult> _replay(
    Future<void> Function(PendingWrite write) send,
  ) async {
    final List<PendingWrite> queue = await pending();
    int sent = 0;
    int refused = 0;
    while (queue.isNotEmpty) {
      final PendingWrite head = queue.first;
      try {
        await send(head);
        sent += 1;
      } on ApiException catch (e) {
        if (!_isRefusal(e)) break;
        refused += 1;
        _onRefused(head, e);
      } catch (_) {
        break; // not classified: never assumed to be the server's refusal
      }
      queue.removeAt(0);
      await _store.write(key, queue, _codec);
    }
    return ReplayResult(sent: sent, refused: refused, remaining: queue.length);
  }

  static bool _isRefusal(ApiException e) =>
      e.statusCode >= 400 &&
      e.statusCode < 500 &&
      e.statusCode != 401 &&
      e.statusCode != 408 &&
      e.statusCode != 429;

  /// Forget every waiting write — the sign-out drop.
  Future<void> clear() => _store.remove(<String>[key]);
}
