import 'dart:async';

import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show InMemoryKeyValueStore, KeyValueStore;
import 'package:test/test.dart';

// The generic outbox (audit D22). The app-level red control — an add made
// offline is queued and replayed once — is
// apps/subscriptiontracker/test/cached_api_client_test.dart.

PendingWrite _w(String id) => PendingWrite(
  id: id,
  kind: 'thing.create',
  body: <String, dynamic>{'name': id},
  queuedAt: DateTime.utc(2026, 9, 30),
);

void main() {
  late KeyValueStore kv;
  Outbox box({void Function(PendingWrite, ApiException)? onRefused}) => Outbox(
    KeyValueJsonStore(Future<KeyValueStore>.value(kv)),
    onRefused: onRefused,
  );

  setUp(() => kv = InMemoryKeyValueStore());

  test('a queued write survives a restart and is sent once', () async {
    await box().enqueue(_w('a'));
    final List<String> sent = <String>[];
    final Outbox restarted = box();
    final ReplayResult r = await restarted.replay(
      (PendingWrite w) async => sent.add(w.id),
    );
    expect(sent, <String>['a']);
    expect(r.sent, 1);
    expect(await restarted.pending(), isEmpty);
    await restarted.replay((PendingWrite w) async => sent.add(w.id));
    expect(sent, <String>[
      'a',
    ], reason: 'an acknowledged write is never resent');
  });

  test(
    'a run stops at the first unreachable attempt and keeps the order',
    () async {
      final Outbox b = box();
      await b.enqueue(_w('a'));
      await b.enqueue(_w('b'));
      final ReplayResult r = await b.replay(
        (PendingWrite w) async => throw ApiException(0, 'offline'),
      );
      expect(r.remaining, 2);
      expect((await b.pending()).map((PendingWrite w) => w.id), <String>[
        'a',
        'b',
      ]);
    },
  );

  test('a refusal is dropped and reported; a 401 is kept', () async {
    final List<String> refused = <String>[];
    final Outbox b = box(onRefused: (PendingWrite w, _) => refused.add(w.id));
    await b.enqueue(_w('bad'));
    await b.enqueue(_w('good'));
    await b.replay((PendingWrite w) async {
      if (w.id == 'bad') throw ApiException(400, 'invalid_body');
    });
    expect(refused, <String>['bad']);
    expect(await b.pending(), isEmpty);

    await b.enqueue(_w('c'));
    await b.replay((PendingWrite w) async => throw ApiException(401, 'no'));
    expect((await b.pending()).single.id, 'c');
  });

  test('concurrent replays share one run: nothing is sent twice', () async {
    final Outbox b = box();
    await b.enqueue(_w('a'));
    final Completer<void> gate = Completer<void>();
    int sends = 0;
    Future<void> send(PendingWrite w) async {
      sends += 1;
      await gate.future;
    }

    final Future<ReplayResult> one = b.replay(send);
    final Future<ReplayResult> two = b.replay(send);
    gate.complete();
    await Future.wait(<Future<ReplayResult>>[one, two]);
    expect(sends, 1);
  });

  test('clear forgets every waiting write (the sign-out drop)', () async {
    final Outbox b = box();
    await b.enqueue(_w('a'));
    await b.clear();
    expect(await b.pending(), isEmpty);
  });

  test('client ids are random v4 UUIDs', () {
    final String a = Outbox.newClientId();
    expect(
      a,
      matches(
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ),
      ),
    );
    expect(Outbox.newClientId(), isNot(a));
  });
}
