import 'dart:async';
import 'dart:convert';

import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show InMemoryKeyValueStore, KeyValueStore, OutboxFailure;
import 'package:test/test.dart';

// The generic read-through cache (audit D28/D19/D24). The app's row-level
// suite (apps/subscriptiontracker/test/cached_api_client_test.dart) still runs
// over it; this file proves the mechanics with no app types at all.

final CacheCodec<List<String>> _codec = CacheCodec<List<String>>(
  encode: (List<String> v) => jsonEncode(v),
  decode: (String raw) {
    final Object? d = jsonDecode(raw);
    return d is List<Object?> ? d.whereType<String>().toList() : null;
  },
);

class _RefusingStore implements KeyValueStore {
  @override
  Future<String?> read(String key) async => null;
  @override
  Future<void> write(String key, String value) async =>
      throw StateError('disk full');
  @override
  Future<void> remove(String key) async {}
  @override
  Future<bool> containsKey(String key) async => false;
}

void main() {
  late KeyValueStore kv;
  late List<bool> staleReports;

  ReadThroughCache cache({Duration after = kRevalidateAfter}) =>
      ReadThroughCache(
        KeyValueJsonStore(Future<KeyValueStore>.value(kv)),
        onStaleChanged: staleReports.add,
        revalidateAfter: after,
      );

  Future<List<String>> offline() async => throw ApiException(0, 'offline');

  setUp(() {
    kv = InMemoryKeyValueStore();
    staleReports = <bool>[];
  });

  test('a fresh read is mirrored and is not stale', () async {
    final ReadThroughCache c = cache();
    expect(await c.read('k', _codec, () async => <String>['a']), <String>['a']);
    expect(c.lastReadWasFromCache, isFalse);
    expect(await c.peek('k', _codec), <String>['a']);
  });

  // D19: a cached answer is MARKED, and the mark is reported as state.
  test('offline, the last list is served and marked stale', () async {
    await cache().read('k', _codec, () async => <String>['a']);
    final ReadThroughCache c = cache();
    expect(await c.read('k', _codec, offline), <String>['a']);
    expect(c.lastReadWasFromCache, isTrue);
    expect(staleReports, <bool>[true]);
    // Proven offline, the retry answers from the copy at once and asks in the
    // background; the answer that lands is kept and announced...
    final List<List<String>> revalidated = <List<String>>[];
    expect(
      await c.read(
        'k',
        _codec,
        () async => <String>['b'],
        onRevalidated: revalidated.add,
      ),
      <String>['a'],
    );
    await Future<void>.delayed(Duration.zero);
    expect(revalidated, <List<String>>[
      <String>['b'],
    ]);
    // ...and the re-read it prompts is live, and unmarked.
    expect(await c.read('k', _codec, () async => <String>['b']), <String>['b']);
    expect(c.lastReadWasFromCache, isFalse);
    expect(staleReports, <bool>[true, false]);
  });

  test('nothing cached + no network: the failure travels', () async {
    await expectLater(
      cache().read('k', _codec, offline),
      throwsA(isA<ApiException>()),
    );
  });

  test('a 401 and a 404 travel even with a copy cached', () async {
    await cache().read('k', _codec, () async => <String>['a']);
    for (final int code in <int>[401, 404]) {
      await expectLater(
        cache().read(
          'k',
          _codec,
          () async => throw ApiException(code, 'refused'),
        ),
        throwsA(isA<ApiException>()),
      );
    }
  });

  // D24: the red control. A network that never answers used to hold the read
  // for the full 15 s connect timeout; with a copy cached it must not.
  test(
    'offline, a read with a copy answers without waiting on the connect timeout',
    () async {
      await cache().read('k', _codec, () async => <String>['a']);
      final Completer<List<String>> never = Completer<List<String>>();
      final ReadThroughCache c = cache(after: const Duration(milliseconds: 50));
      final List<String> got = await c
          .read('k', _codec, () => never.future)
          .timeout(const Duration(seconds: 2));
      expect(got, <String>['a']);
      expect(c.lastReadWasFromCache, isTrue);
    },
  );

  test('once proven offline, the next read answers at once and revalidates '
      'in the background', () async {
    await cache().read('k', _codec, () async => <String>['a']);
    final ReadThroughCache c = cache(after: const Duration(hours: 1));
    await c.read('k', _codec, offline);
    expect(c.knownOffline, isTrue);

    final Completer<List<String>> late = Completer<List<String>>();
    final List<List<String>> revalidated = <List<String>>[];
    final List<String> got = await c
        .read('k', _codec, () => late.future, onRevalidated: revalidated.add)
        .timeout(const Duration(seconds: 2));
    expect(got, <String>['a']);

    late.complete(<String>['a', 'b']);
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(revalidated, <List<String>>[
      <String>['a', 'b'],
    ]);
    expect(await c.peek('k', _codec), <String>['a', 'b']);
    expect(c.knownOffline, isFalse);
  });

  test('a mirror failure is counted and reported, never thrown', () async {
    final List<Object> reported = <Object>[];
    final ReadThroughCache c = ReadThroughCache(
      KeyValueJsonStore(Future<KeyValueStore>.value(_RefusingStore())),
      onWriteFailed: reported.add,
    );
    expect(await c.read('k', _codec, () async => <String>['a']), <String>['a']);
    expect(c.writeFailures, 1);
    expect(reported.single, isA<StoreWriteFailure>());
  });

  test('amend keeps a cached copy in step and leaves no copy alone', () async {
    final ReadThroughCache c = cache();
    await c.amend('k', _codec, (List<String> v) => <String>[...v, 'x']);
    expect(await c.peek('k', _codec), isNull);
    await c.mirror('k', <String>['a'], _codec);
    await c.amend('k', _codec, (List<String> v) => <String>[...v, 'x']);
    expect(await c.peek('k', _codec), <String>['a', 'x']);
  });

  test('forget drops every copy it wrote, and nothing else', () async {
    await kv.write('unrelated', 'kept');
    final ReadThroughCache c = cache();
    await c.read('a', _codec, () async => <String>['1']);
    await c.read('b', _codec, () async => <String>['2']);
    await cache().forget();
    expect(await c.peek('a', _codec), isNull);
    expect(await c.peek('b', _codec), isNull);
    expect(await kv.read(kCacheIndexKey), isNull);
    expect(await kv.read('unrelated'), 'kept');
  });

  // 🔴 REVIEW #1075 FINDING 3 — the red control. A network slower than the
  // probe, with every revalidation prompting a re-read (as the app's list
  // provider does), used to loop: a GET every cycle, stale forever.
  test(
    'a 3 s read produces exactly one GET, and its landing clears the mark',
    () async {
      await cache().read('k', _codec, () async => <String>['a']);
      DateTime clock = DateTime.utc(2026, 9, 30, 8);
      int gets = 0;
      late ReadThroughCache c;
      Future<List<String>> slow() async {
        gets += 1;
        await Future<void>.delayed(const Duration(milliseconds: 150)); // "3 s"
        return <String>['a', 'b'];
      }

      final List<List<String>> shown = <List<String>>[];
      Future<void> readList() async => shown.add(
        await c.read(
          'k',
          _codec,
          slow,
          onRevalidated: (_) => unawaited(readList()), // the app re-reads
        ),
      );
      c = ReadThroughCache(
        KeyValueJsonStore(Future<KeyValueStore>.value(kv)),
        onStaleChanged: staleReports.add,
        revalidateAfter: const Duration(milliseconds: 20), // "2 s"
        now: () => clock,
      );
      await readList();
      await Future<void>.delayed(const Duration(milliseconds: 600));
      expect(gets, 1);
      expect(shown.last, <String>['a', 'b']);
      expect(c.lastReadWasFromCache, isFalse);
      expect(staleReports, <bool>[true, false]);

      // Past the window, a read asks the network again.
      clock = clock.add(const Duration(seconds: 31));
      await c.read('k', _codec, slow);
      expect(gets, 2);
    },
  );

  test('two reads of one key share one request', () async {
    final Completer<List<String>> gate = Completer<List<String>>();
    int gets = 0;
    Future<List<String>> fetch() {
      gets += 1;
      return gate.future;
    }

    final ReadThroughCache c = cache();
    final Future<List<String>> one = c.read('k', _codec, fetch);
    final Future<List<String>> two = c.read('k', _codec, fetch);
    gate.complete(<String>['x']);
    expect(await one, <String>['x']);
    expect(await two, <String>['x']);
    expect(gets, 1);
  });

  // REVIEW #1075 FINDING 12: a live read of one key never clears another's mark.
  test('stale is per key', () async {
    await cache().read('list', _codec, () async => <String>['a']);
    final ReadThroughCache c = cache();
    await c.read('list', _codec, offline);
    await c.read('budget', _codec, () async => <String>['live']);
    expect(c.isStale('list'), isTrue);
    expect(c.isStale('budget'), isFalse);
    expect(c.lastReadWasFromCache, isTrue);
  });

  test('outbox classification: offline, session, retry, refusal', () {
    expect(classifyForOutbox(ApiException(0, 'x')), OutboxFailure.offline);
    expect(
      classifyForOutbox(ApiException(401, 'x')),
      OutboxFailure.unauthorized,
    );
    // 409: the server is still processing the key — wait, never count it.
    expect(classifyForOutbox(ApiException(409, 'x')), OutboxFailure.busy);
    expect(
      retryAfterFor(
        ApiException(409, 'x', retryAfter: const Duration(seconds: 7)),
      ),
      const Duration(seconds: 7),
    );
    for (final int c in <int>[408, 429, 500, 503]) {
      expect(classifyForOutbox(ApiException(c, 'x')), OutboxFailure.transient);
    }
    for (final int c in <int>[400, 404, 422]) {
      expect(classifyForOutbox(ApiException(c, 'x')), OutboxFailure.refused);
    }
    expect(classifyForOutbox(StateError('?')), OutboxFailure.transient);
  });
  // 🔴 REVIEW #1075 ROUND 2, MAJOR 2 — the copy belongs to one account.
  group('the copy belongs to one account', () {
    late String? user;
    ReadThroughCache scopedCache({Duration after = kRevalidateAfter}) =>
        ReadThroughCache(
          KeyValueJsonStore(Future<KeyValueStore>.value(kv)),
          owner: () => user,
          revalidateAfter: after,
        );

    setUp(() => user = 'user-a');

    test('a list read still in flight at sign-out writes nothing', () async {
      final ReadThroughCache c = scopedCache();
      final Completer<List<String>> gate = Completer<List<String>>();
      final Future<List<String>> read = c.read('k', _codec, () => gate.future);
      await Future<void>.delayed(Duration.zero);
      await c.forget(); // the sign-out drop
      gate.complete(<String>["a's row"]);
      await read;
      expect(await c.peek('k', _codec), isNull);
      expect(await kv.read('k.u.user-a'), isNull);
    });

    test("the next user never sees the previous user's rows — copy, fresh "
        'window or joined request', () async {
      final ReadThroughCache c = scopedCache(
        after: const Duration(milliseconds: 20),
      );
      // A's copy, then a slow revalidation that opens A's fresh window.
      await c.read('k', _codec, () async => <String>["a's row"]);
      await c.read('k', _codec, () async {
        await Future<void>.delayed(const Duration(milliseconds: 60));
        return <String>["a's row", "a's second"];
      });
      await Future<void>.delayed(const Duration(milliseconds: 100));

      user = 'user-b'; // the next account, on the same device
      await expectLater(
        c.read('k', _codec, () async => throw ApiException(0, 'offline')),
        throwsA(isA<ApiException>()),
        reason: 'B has no copy: the failure travels, A is never served',
      );

      // A request of A's still out when B reads is never joined.
      user = 'user-a';
      final Completer<List<String>> aGate = Completer<List<String>>();
      final Future<List<String>> aRead = c.read(
        'k',
        _codec,
        () => aGate.future,
      );
      await Future<void>.delayed(Duration.zero);
      user = 'user-b';
      final List<String> b = await c.read(
        'k',
        _codec,
        () async => <String>["b's row"],
      );
      expect(b, <String>["b's row"]);
      aGate.complete(<String>["a's row"]);
      await aRead;
    });

    test('the copies are stored per account', () async {
      final ReadThroughCache c = scopedCache();
      await c.read('k', _codec, () async => <String>['a']);
      user = 'user-b';
      await c.read('k', _codec, () async => <String>['b']);
      expect(await kv.read('k.u.user-a'), isNotNull);
      expect(await kv.read('k.u.user-b'), isNotNull);
      expect(await kv.read('k'), isNull);
      await c.forget();
      expect(await kv.read('k.u.user-a'), isNull);
      expect(await kv.read('k.u.user-b'), isNull);
    });
  });

  // REVIEW ROUND 2, MINOR d: an undecodable answer is a refusal of the entry.
  test('an undecodable answer is never "offline"', () {
    final ApiException bad = ApiException(
      0,
      'Malformed response',
      malformed: true,
    );
    expect(bad.isOffline, isFalse);
    expect(classifyForOutbox(bad), OutboxFailure.refused);
  });

  // 🔴 REVIEW #1075 ROUND 3, MINOR c — a sign-out that lands while the copy is
  // being written: the write is re-checked AFTER it lands, and taken back.
  test('a cache write racing a sign-out is taken back', () async {
    final _GatedStore gated = _GatedStore();
    final ReadThroughCache c = ReadThroughCache(
      KeyValueJsonStore(Future<KeyValueStore>.value(gated)),
      owner: () => 'user-a',
    );
    gated.gateKey = 'k.u.user-a';
    final Future<List<String>> read = c.read(
      'k',
      _codec,
      () async => <String>['a'],
    );
    await gated.reached.future; // the copy's write is in progress
    await c.forget(); // the sign-out lands mid-write
    gated.release.complete();
    await read;
    expect(await gated.read('k.u.user-a'), isNull, reason: 'no residue');
  });
}

/// A store whose write of [gateKey] waits for [release].
class _GatedStore extends InMemoryKeyValueStore {
  String? gateKey;
  final Completer<void> reached = Completer<void>();
  final Completer<void> release = Completer<void>();
  @override
  Future<void> write(String key, String value) async {
    if (key == gateKey && !reached.isCompleted) {
      reached.complete();
      await release.future;
    }
    await super.write(key, value);
  }
}
