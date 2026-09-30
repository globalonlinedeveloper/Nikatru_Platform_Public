import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

// The shared durable outbox (lead ruling on #1075, 2026-09-30). One test per
// property the ruling names; the review finding each closes is in the name.

class _Fail implements Exception {
  _Fail(this.kind);
  final OutboxFailure kind;
  @override
  String toString() => '_Fail(${kind.name})';
}

OutboxFailure _classify(Object e) =>
    e is _Fail ? e.kind : OutboxFailure.transient;

void main() {
  late InMemoryKeyValueStore kv;
  late DateTime now;
  DurableOutbox box() => DurableOutbox(
    Future<KeyValueStore>.value(kv),
    now: () => now,
    maxAttempts: 3,
  );

  Future<OutboxEnqueueResult> add(
    DurableOutbox b,
    String owner,
    String record, {
    OutboxOp op = OutboxOp.create,
    Map<String, dynamic> body = const <String, dynamic>{},
  }) => b.enqueue(
    owner: owner,
    recordId: record,
    op: op,
    kind: 'thing',
    body: body,
  );

  setUp(() {
    kv = InMemoryKeyValueStore();
    now = DateTime.utc(2026, 9, 30, 8);
  });

  group('user-scoped (finding 1)', () {
    test("user A's queued write is never sent under user B", () async {
      await add(box(), 'user-a', 'r1');
      final List<String> sent = <String>[];
      await box().replay(
        owner: 'user-b',
        currentOwner: () => 'user-b',
        send: (OutboxEntry e) async {
          sent.add(e.owner);
          return null;
        },
      );
      expect(sent, isEmpty);
      expect(
        await box().pending(owner: 'user-a'),
        hasLength(1),
        reason: "kept for its owner's return (a forced 401 keeps it)",
      );
      await box().replay(
        owner: 'user-a',
        currentOwner: () => 'user-a',
        send: (OutboxEntry e) async {
          sent.add(e.owner);
          return null;
        },
      );
      expect(sent, <String>['user-a']);
    });

    test(
      'a sign-out during a replay stops it: nothing more is sent or kept',
      () async {
        final DurableOutbox b = box();
        await add(b, 'user-a', 'x');
        await add(b, 'user-a', 'y');
        final Completer<void> gate = Completer<void>();
        final List<String> sent = <String>[];
        String? session = 'user-a';
        final Future<OutboxReplayResult> run = b.replay(
          owner: 'user-a',
          currentOwner: () => session,
          send: (OutboxEntry e) async {
            sent.add(e.recordId);
            await gate.future;
            return null;
          },
        );
        await Future<void>.delayed(Duration.zero);
        // Settings → Log out: the session ends and the owner's queue is dropped.
        session = null;
        await b.discardOwner('user-a');
        gate.complete();
        final OutboxReplayResult r = await run;
        expect(r.aborted, isTrue);
        expect(sent, <String>['x'], reason: 'y is never sent');
        expect(
          await b.entries(),
          isEmpty,
          reason: 'no snapshot is written back',
        );
      },
    );

    test('an owner change mid-run aborts before the next send', () async {
      final DurableOutbox b = box();
      await add(b, 'user-a', 'x');
      await add(b, 'user-a', 'y');
      String session = 'user-a';
      final List<String> sent = <String>[];
      await b.replay(
        owner: 'user-a',
        currentOwner: () => session,
        send: (OutboxEntry e) async {
          sent.add(e.recordId);
          session = 'user-b'; // account switch while x was out
          return null;
        },
      );
      expect(sent, <String>['x']);
      expect((await b.pending(owner: 'user-a')).single.recordId, 'y');
    });
  });

  group('persisted and serialised (finding 2)', () {
    test('an add queued during a replay survives the replay', () async {
      final DurableOutbox b = box();
      await add(b, 'u', 'x');
      final Completer<void> gate = Completer<void>();
      final Future<OutboxReplayResult> run = b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: (OutboxEntry e) async {
          if (e.recordId == 'x') await gate.future;
          throw _Fail(OutboxFailure.offline); // anything after x stays queued
        },
      );
      await Future<void>.delayed(Duration.zero);
      // A SECOND instance over the same store, as at startup.
      await add(box(), 'u', 'b');
      gate.complete();
      await run;
      final List<String> left = (await box().pending())
          .map((OutboxEntry e) => e.recordId)
          .toList();
      expect(left, containsAll(<String>['x', 'b']));
    });

    test(
      'an acknowledged entry is removed by id and survives a restart',
      () async {
        await add(box(), 'u', 'x');
        await add(box(), 'u', 'y');
        await box().replay(
          owner: 'u',
          currentOwner: () => 'u',
          send: (OutboxEntry e) async =>
              e.recordId == 'x' ? null : throw _Fail(OutboxFailure.offline),
          classify: _classify,
        );
        expect((await box().pending()).single.recordId, 'y');
      },
    );

    test('two instances replaying at once send each entry once', () async {
      await add(box(), 'u', 'x');
      int sends = 0;
      final Completer<void> gate = Completer<void>();
      Future<String?> send(OutboxEntry e) async {
        sends += 1;
        await gate.future;
        return null;
      }

      final Future<OutboxReplayResult> one = box().replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: send,
      );
      final Future<OutboxReplayResult> two = box().replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: send,
      );
      await Future<void>.delayed(Duration.zero);
      gate.complete();
      await Future.wait(<Future<OutboxReplayResult>>[one, two]);
      expect(sends, 1);
    });
  });

  group('bounded (finding 7)', () {
    test('transient failures back off, then become a dead letter', () async {
      final DurableOutbox b = box();
      await add(b, 'u', 'x');
      Future<String?> fail(OutboxEntry e) async =>
          throw _Fail(OutboxFailure.transient);
      await b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: fail,
        classify: _classify,
      );
      OutboxEntry e = (await b.entries()).single;
      expect(e.attempts, 1);
      expect(e.nextAttemptAt, now.add(const Duration(seconds: 2)));

      int sends = 0;
      await b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: (OutboxEntry e) async {
          sends += 1;
          return null;
        },
      );
      expect(sends, 0, reason: 'not before its backoff');

      for (int i = 0; i < 2; i++) {
        now = now.add(const Duration(minutes: 10));
        await b.replay(
          owner: 'u',
          currentOwner: () => 'u',
          send: fail,
          classify: _classify,
        );
      }
      e = (await b.entries()).single;
      expect(e.dead, isTrue);
      expect(e.attempts, 3);
      expect(await b.deadLetters(owner: 'u'), hasLength(1));

      await b.retry(e.id);
      expect((await b.pending()).single.attempts, 0);
      await b.discard(e.id);
      expect(await b.entries(), isEmpty);
    });

    test('a refusal is a dead letter at once; offline costs nothing', () async {
      final DurableOutbox b = box();
      await add(b, 'u', 'x');
      await b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: (_) async => throw _Fail(OutboxFailure.offline),
        classify: _classify,
      );
      expect((await b.entries()).single.attempts, 0);
      await b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: (_) async => throw _Fail(OutboxFailure.refused),
        classify: _classify,
      );
      expect((await b.entries()).single.dead, isTrue);
    });

    test('one stuck record never blocks another', () async {
      final DurableOutbox b = box();
      await add(b, 'u', 'stuck');
      await add(b, 'u', 'fine');
      final List<String> sent = <String>[];
      await b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: (OutboxEntry e) async {
          if (e.recordId == 'stuck') throw _Fail(OutboxFailure.transient);
          sent.add(e.recordId);
          return null;
        },
        classify: _classify,
      );
      expect(sent, <String>['fine']);
      expect((await b.pending()).single.recordId, 'stuck');
    });
  });

  group('ordered and coalesced per record (finding 4)', () {
    test(
      'a delete of a never-synced create cancels both and sends nothing',
      () async {
        final DurableOutbox b = box();
        await add(b, 'u', 'k', body: <String, dynamic>{'name': 'Gym'});
        await add(
          b,
          'u',
          'k',
          op: OutboxOp.update,
          body: <String, dynamic>{'name': 'Gym+'},
        );
        final OutboxEnqueueResult r = await add(
          b,
          'u',
          'k',
          op: OutboxOp.delete,
        );
        expect(r.cancelled, isTrue);
        expect(await b.entries(), isEmpty);
      },
    );

    test('an edit of a never-synced row edits the queued create', () async {
      final DurableOutbox b = box();
      await add(
        b,
        'u',
        'k',
        body: <String, dynamic>{'name': 'Gym', 'price': 1},
      );
      await add(
        b,
        'u',
        'k',
        op: OutboxOp.update,
        body: <String, dynamic>{'price': 2},
      );
      final List<OutboxEntry> es = await b.entries();
      expect(es, hasLength(1));
      expect(es.single.op, OutboxOp.create);
      expect(es.single.body, <String, dynamic>{'name': 'Gym', 'price': 2});
    });

    test('a create that was attempted is not cancelled: the delete follows it '
        'to the server id', () async {
      final DurableOutbox b = box();
      await add(b, 'u', 'k');
      // The first attempt timed out: it may have committed.
      await b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: (_) async => throw _Fail(OutboxFailure.transient),
        classify: _classify,
      );
      final OutboxEnqueueResult r = await add(b, 'u', 'k', op: OutboxOp.delete);
      expect(r.cancelled, isFalse);
      now = now.add(const Duration(minutes: 10));
      final List<String> sent = <String>[];
      await b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: (OutboxEntry e) async {
          sent.add('${e.op.name} ${e.recordId}');
          return e.op == OutboxOp.create ? 'srv-1' : null;
        },
      );
      expect(sent, <String>['create k', 'delete srv-1']);
      expect(await b.resolve('k'), 'srv-1');
    });

    test('later ops on a record wait for its earlier one', () async {
      final DurableOutbox b = box();
      await add(
        b,
        'u',
        'r',
        op: OutboxOp.update,
        body: <String, dynamic>{'a': 1},
      );
      await add(b, 'u', 'r', op: OutboxOp.delete);
      final List<String> sent = <String>[];
      await b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: (OutboxEntry e) async {
          sent.add(e.op.name);
          return null;
        },
      );
      expect(sent, <String>['delete'], reason: 'update+delete coalesce');
    });
  });

  test('clear forgets everything', () async {
    await add(box(), 'u', 'x');
    await box().clear();
    expect(await box().entries(), isEmpty);
  });

  test('client ids are random v4 UUIDs', () {
    expect(
      newOutboxId(),
      matches(
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ),
      ),
    );
  });
  // ── REVIEW 2 (2026-09-30) ─────────────────────────────────────────────────
  group('what the server may have seen (review 2, major 1)', () {
    // A lost response is an "offline" failure: it costs no attempt, so
    // attempts == 0 said "never reached" of a create the server HAD committed.
    Future<void> loseResponse(DurableOutbox b) => b.replay(
      owner: 'u',
      currentOwner: () => 'u',
      send: (_) async => throw _Fail(OutboxFailure.offline),
      classify: _classify,
    );

    test('a lost add response, then a delete: the delete is SENT, behind the '
        'create, to the server id', () async {
      final DurableOutbox b = box();
      await add(b, 'u', 'k', body: <String, dynamic>{'name': 'Gym'});
      await loseResponse(b);
      expect((await b.entries()).single.attempts, 0);
      expect((await b.entries()).single.mayHaveReached, isTrue);

      final OutboxEnqueueResult r = await add(b, 'u', 'k', op: OutboxOp.delete);
      expect(r.cancelled, isFalse, reason: 'never cancelled on the device');
      final List<String> sent = <String>[];
      await b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: (OutboxEntry e) async {
          sent.add('${e.op.name} ${e.recordId}');
          return e.op == OutboxOp.create ? 'srv-1' : null;
        },
      );
      expect(sent, <String>['create k', 'delete srv-1']);
    });

    test('a lost add response, then an edit: the create keeps its body and '
        'the edit follows it as an update', () async {
      final DurableOutbox b = box();
      await add(b, 'u', 'k', body: <String, dynamic>{'name': 'Gym'});
      await loseResponse(b);
      await add(
        b,
        'u',
        'k',
        op: OutboxOp.update,
        body: <String, dynamic>{'name': 'Gym (annual)'},
      );
      final List<OutboxEntry> es = await b.entries();
      expect(es.map((OutboxEntry e) => e.op), <OutboxOp>[
        OutboxOp.create,
        OutboxOp.update,
      ]);
      expect(es.first.body, <String, dynamic>{
        'name': 'Gym',
      }, reason: 'the key is replayed with the body it was first sent with');
    });

    test('a first attempt made by the caller counts as dispatched', () async {
      final DurableOutbox b = box();
      await b.enqueue(
        owner: 'u',
        recordId: 'k',
        op: OutboxOp.create,
        kind: 'thing',
        mayHaveReached: true,
      );
      expect((await add(b, 'u', 'k', op: OutboxOp.delete)).cancelled, isFalse);
    });
  });

  group('reconciled by id and revision (review 2, minor a)', () {
    test('a change queued while its entry is being sent survives', () async {
      final DurableOutbox b = box();
      await add(
        b,
        'u',
        'r',
        op: OutboxOp.update,
        body: <String, dynamic>{'a': 1},
      );
      final List<Map<String, dynamic>> bodies = <Map<String, dynamic>>[];
      await b.replay(
        owner: 'u',
        currentOwner: () => 'u',
        send: (OutboxEntry e) async {
          bodies.add(e.body);
          if (bodies.length == 1) {
            // The user edits again between "sent" and "recorded".
            unawaited(
              add(
                b,
                'u',
                'r',
                op: OutboxOp.update,
                body: <String, dynamic>{'a': 2},
              ),
            );
            await Future<void>.delayed(Duration.zero);
          }
          return null;
        },
      );
      final List<OutboxEntry> left = await b.pending();
      if (left.isNotEmpty) {
        expect(left.single.body['a'], 2, reason: 'the second edit is kept');
      } else {
        expect(bodies.last['a'], 2, reason: 'or already sent in the same run');
      }
    });
  });

  group('a failed read never wipes the queue (review 2, minor e)', () {
    test(
      'an unreadable store aborts the mutation and keeps what is stored',
      () async {
        final _FlakyStore flaky = _FlakyStore();
        final DurableOutbox b = DurableOutbox(
          Future<KeyValueStore>.value(flaky),
        );
        await add(b, 'u', 'x');
        flaky.failReads = 99;
        await expectLater(add(b, 'u', 'y'), throwsA(isA<OutboxStoreFailure>()));
        await expectLater(
          b.discardOwner('u'),
          throwsA(isA<OutboxStoreFailure>()),
        );
        final OutboxReplayResult r = await b.replay(
          owner: 'u',
          currentOwner: () => 'u',
          send: (_) async => null,
        );
        expect(r.storeError, isA<OutboxStoreFailure>());
        flaky.failReads = 0;
        expect(
          (await b.entries()).single.recordId,
          'x',
          reason: 'nothing wiped',
        );
      },
    );

    test('a read that fails once is retried', () async {
      final _FlakyStore flaky = _FlakyStore();
      final DurableOutbox b = DurableOutbox(Future<KeyValueStore>.value(flaky));
      await add(b, 'u', 'x');
      flaky.failReads = 1;
      await add(b, 'u', 'y');
      expect(await b.entries(), hasLength(2));
    });
  });
}

class _FlakyStore extends InMemoryKeyValueStore {
  int failReads = 0;
  @override
  Future<String?> read(String key) async {
    if (failReads > 0) {
      failReads -= 1;
      throw StateError('storage unavailable');
    }
    return super.read(key);
  }
}
