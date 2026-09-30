import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:{{app_id.snakeCase()}}/state/providers.dart';

// ⏱ 2026-09-30 · audit D28 (ST-N5) — THE STAMPED PROOF THAT A NEW APP IS
// OFFLINE FOR REAL. Until today the cache existed only in
// apps/subscriptiontracker, so a fresh stamp served nothing without a network.
// These run on EVERY stamp (client-only and needs_backend alike): the adapter
// is chassis, and a needs_backend app is the one with rows to lose.

final CacheCodec<List<String>> _rows = CacheCodec<List<String>>(
  encode: (List<String> v) => jsonEncode(v),
  decode: (String raw) {
    final Object? d = jsonDecode(raw);
    return d is List<Object?> ? d.whereType<String>().toList() : null;
  },
);

class _RefusingStore implements core.KeyValueStore {
  @override
  Future<bool> containsKey(String key) async => false;
  @override
  Future<String?> read(String key) async => null;
  @override
  Future<void> remove(String key) async {}
  @override
  Future<void> write(String key, String value) async =>
      throw StateError('disk full');
}

ProviderContainer _container(core.KeyValueStore kv) {
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((Ref ref) async => kv),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a stamped app serves its last list offline, marked stale', () async {
    final core.InMemoryKeyValueStore kv = core.InMemoryKeyValueStore();
    final ProviderContainer online = _container(kv);
    expect(
      await online
          .read(readThroughCacheProvider)
          .read('rows', _rows, () async => <String>['a', 'b']),
      <String>['a', 'b'],
    );

    // A new launch, same device, no network.
    final ProviderContainer offline = _container(kv);
    final List<String> shown = await offline
        .read(readThroughCacheProvider)
        .read(
          'rows',
          _rows,
          () async => throw ApiException(0, 'Network error'),
        );
    expect(shown, <String>['a', 'b']);
    expect(offline.read(staleReadProvider), isTrue);
  });

  test('a write made offline waits in the outbox across a restart', () async {
    final core.InMemoryKeyValueStore kv = core.InMemoryKeyValueStore();
    await _container(kv)
        .read(outboxProvider)
        .enqueue(
          PendingWrite(
            id: Outbox.newClientId(),
            kind: 'row.create',
            body: <String, dynamic>{'name': 'x'},
            queuedAt: DateTime.utc(2026, 9, 30),
          ),
        );
    final Outbox restarted = _container(kv).read(outboxProvider);
    final List<String> sent = <String>[];
    await restarted.replay((PendingWrite w) async => sent.add(w.id));
    expect(sent, hasLength(1));
    expect(await restarted.pending(), isEmpty);
  });

  test('a failed cache write reaches the crash sink', () async {
    final List<FlutterErrorDetails> sink = <FlutterErrorDetails>[];
    final FlutterExceptionHandler? before = FlutterError.onError;
    FlutterError.onError = sink.add;
    addTearDown(() => FlutterError.onError = before);
    await _container(_RefusingStore())
        .read(readThroughCacheProvider)
        .read('rows', _rows, () async => <String>['a']);
    expect(sink, hasLength(1));
    expect(sink.single.library, 'offline_cache');
  });
}
