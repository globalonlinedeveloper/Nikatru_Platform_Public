import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ST-N6 (D11) — preferences follow the account. One fake server, and a
/// "device" is a local map plus the sync that joins it to that server.
class _Server implements AccountPreferencesTransport {
  Map<String, Object?>? stored;
  bool offline = false;
  int writes = 0;

  @override
  Future<Result<Map<String, Object?>?>> read() async => offline
      ? const Result<Map<String, Object?>?>.err(Failure('offline'))
      : Result<Map<String, Object?>?>.ok(stored);

  @override
  Future<Result<void>> write(Map<String, Object?> preferences) async {
    if (offline) return const Result<void>.err(Failure('offline'));
    writes++;
    stored = Map<String, Object?>.of(preferences);
    return const Result<void>.ok(null);
  }
}

class _Device {
  _Device(_Server server, Map<String, Object?> initial)
    : local = Map<String, Object?>.of(initial) {
    sync = AccountPreferencesSync(
      transport: server,
      snapshot: () => Map<String, Object?>.of(local),
      apply: (Map<String, Object?> account) async {
        local
          ..clear()
          ..addAll(account);
        // Applying trips the app's listeners, exactly as a real one does.
        await sync.onLocalChange();
      },
    );
  }

  final Map<String, Object?> local;
  late final AccountPreferencesSync sync;

  Future<void> change(String key, Object? value) {
    local[key] = value;
    return sync.onLocalChange();
  }
}

void main() {
  _halfApplied();
  test('written on device A, hydrated on device B after sign-in', () async {
    final _Server server = _Server();
    final _Device a = _Device(server, <String, Object?>{'theme': 'system'});
    await a.sync.onSignedIn(); // the account has none: A seeds it
    await a.change('theme', 'dark');
    await a.change('currencyCode', 'EUR');

    final _Device b = _Device(server, <String, Object?>{'theme': 'system'});
    await b.sync.onSignedIn();
    expect(b.local, <String, Object?>{'theme': 'dark', 'currencyCode': 'EUR'});
  });

  test('applying the account copy writes nothing back', () async {
    final _Server server = _Server()
      ..stored = <String, Object?>{'theme': 'dark'};
    final _Device b = _Device(server, <String, Object?>{'theme': 'light'});
    await b.sync.onSignedIn();
    expect(server.writes, 0);
    expect(b.local['theme'], 'dark');
  });

  test('nothing is written before the account copy is known', () async {
    final _Server server = _Server()
      ..stored = <String, Object?>{'theme': 'dark'};
    final _Device b = _Device(server, <String, Object?>{'theme': 'light'});
    await b.change('theme', 'system'); // signed out, or not read yet
    expect(server.writes, 0);
  });

  test(
    'a change made offline is written at the next sign-in, not overwritten',
    () async {
      final _Server server = _Server()
        ..stored = <String, Object?>{'theme': 'dark'};
      final _Device a = _Device(server, <String, Object?>{});
      await a.sync.onSignedIn();
      server.offline = true;
      await a.change('theme', 'light');
      server.offline = false;
      await a.sync.onSignedIn(); // e.g. the app came back to the front
      expect(server.stored, <String, Object?>{'theme': 'light'});
      expect(a.local['theme'], 'light');
    },
  );

  test(
    'a failed read leaves the device on its cache and writes nothing',
    () async {
      final _Server server = _Server()..offline = true;
      final _Device a = _Device(server, <String, Object?>{'theme': 'light'});
      await a.sync.onSignedIn();
      await a.change('theme', 'dark');
      expect(a.sync.isSynced, isFalse);
      expect(server.writes, 0);
    },
  );

  test('the seed waits for the device store to load', () async {
    final _Server server = _Server();
    final Completer<void> loaded = Completer<void>();
    final Map<String, Object?> local = <String, Object?>{'theme': 'system'};
    final AccountPreferencesSync sync = AccountPreferencesSync(
      transport: server,
      snapshot: () => Map<String, Object?>.of(local),
      apply: (_) async {},
      localReady: () => loaded.future,
    );
    final Future<void> signingIn = sync.onSignedIn();
    local['theme'] = 'dark'; // the disk read lands
    loaded.complete();
    await signingIn;
    expect(server.stored, <String, Object?>{'theme': 'dark'});
  });

  test('key order is not a difference', () {
    expect(
      AccountPreferencesSync.canonicalJson(<String, Object?>{'b': 1, 'a': 2}),
      AccountPreferencesSync.canonicalJson(<String, Object?>{'a': 2, 'b': 1}),
    );
  });
}

void _halfApplied() {
  test(
    'an account copy applied one key at a time is never pushed half-way',
    () async {
      final _Server server = _Server()
        ..stored = <String, Object?>{'theme': 'dark', 'currencyCode': 'EUR'};
      final Map<String, Object?> local = <String, Object?>{
        'theme': 'light',
        'currencyCode': 'USD',
      };
      late final AccountPreferencesSync sync;
      sync = AccountPreferencesSync(
        transport: server,
        snapshot: () => Map<String, Object?>.of(local),
        apply: (Map<String, Object?> account) async {
          for (final MapEntry<String, Object?> e in account.entries) {
            local[e.key] = e.value;
            await sync.onLocalChange(); // each step trips a listener
          }
        },
      );
      await sync.onSignedIn();
      expect(server.writes, 0);
      expect(local, <String, Object?>{'theme': 'dark', 'currencyCode': 'EUR'});
    },
  );
}
