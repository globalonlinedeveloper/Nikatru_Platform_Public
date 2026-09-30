import 'dart:async';
import 'dart:convert';

import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show InMemoryKeyValueStore, KeyValueStore;
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
}
