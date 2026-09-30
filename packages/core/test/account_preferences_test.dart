import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ST-N6 (D11) — preferences follow the account, per key, server-ordered.
/// Every scenario in the #1080 review, each a red control. The server here
/// implements the route's rule: a row's version is bumped only by an accepted
/// write, and a change based on an older version than the row's is a conflict.
class _Server implements AccountPreferencesTransport {
  final Map<String, PreferenceValue> rows = <String, PreferenceValue>{};
  int patches = 0;
  int reads = 0;

  /// 0 = no answer (offline); anything else is that HTTP status.
  int? failWith;

  /// A status only PATCH answers with (reads succeed) — a Worker that serves
  /// GET and fails the write.
  int? patchFailWith;

  /// When set, the next read/patch waits for it — a slow server.
  Completer<void>? holdRead;
  Completer<void>? holdPatch;

  /// A read answers what the server held when it was ASKED, as a real one does.
  @override
  Future<Map<String, PreferenceValue>> read() async {
    reads++;
    if (failWith != null) throw AccountPreferencesFailure(failWith!);
    final Map<String, PreferenceValue> snapshot =
        Map<String, PreferenceValue>.of(rows);
    final Completer<void>? hold = holdRead;
    holdRead = null;
    if (hold != null) await hold.future;
    return snapshot;
  }

  @override
  Future<PreferencesPatchResult> patch(
    Map<String, PreferenceChange> changes,
  ) async {
    final Completer<void>? hold = holdPatch;
    holdPatch = null;
    if (hold != null) await hold.future;
    if (failWith != null) throw AccountPreferencesFailure(failWith!);
    if (patchFailWith != null) throw AccountPreferencesFailure(patchFailWith!);
    patches++;
    final Set<String> conflicts = <String>{};
    changes.forEach((String key, PreferenceChange ch) {
      final int held = rows[key]?.version ?? 0;
      if (held > ch.baseVersion) {
        conflicts.add(key);
      } else {
        rows[key] = PreferenceValue(ch.value, held + 1);
      }
    });
    return PreferencesPatchResult(
      current: <String, PreferenceValue>{
        for (final String k in changes.keys) k: rows[k]!,
      },
      conflicts: conflicts,
    );
  }

  /// Another device's accepted write.
  void elsewhere(String key, Object? value) =>
      rows[key] = PreferenceValue(value, (rows[key]?.version ?? 0) + 1);

  Map<String, Object?> get values => <String, Object?>{
    for (final MapEntry<String, PreferenceValue> e in rows.entries)
      e.key: e.value.value,
  };
}

class _MemStore implements KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// One device: its own store (so its outbox and versions persist across
/// [restart]), the values it shows, and the signed-in user.
class _Device {
  _Device(this.server, {this.user = 'me'}) {
    restart();
  }

  final _Server server;
  final _MemStore store = _MemStore();
  final Map<String, Object?> shown = <String, Object?>{};
  final List<String> refused = <String>[];
  String? user;
  late AccountPreferencesSync sync;

  /// A new process (or a rebuilt provider) over the SAME device store.
  void restart() => sync = AccountPreferencesSync(
    transport: () => server,
    outbox: DurableOutbox(
      Future<KeyValueStore>.value(store),
      key: kPreferencesOutboxKey,
      baseBackoff: Duration.zero,
    ),
    store: Future<KeyValueStore>.value(store),
    currentUser: () => user,
    apply: (Map<String, Object?> v) async => shown.addAll(v),
    onRefused: refused.add,
  );

  /// The user sets [key] here: shown at once, then synced.
  Future<void> set(String key, Object? value) async {
    shown[key] = value;
    await sync.changed(key, value);
    await settle();
  }

  Future<void> settle() async {
    for (int i = 0; i < 20; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }
}

void main() {
  test('written on device A, it hydrates on device B after sign-in', () async {
    final _Server server = _Server();
    final _Device a = _Device(server);
    await a.set('themeMode', 'dark');
    await a.set('currencyCode', 'EUR');

    final _Device b = _Device(server);
    await b.sync.sync();
    expect(b.shown, <String, Object?>{
      'themeMode': 'dark',
      'currencyCode': 'EUR',
    });
  });

  test(
    '🔴 finding 4: a device with untouched defaults sends NOTHING',
    () async {
      final _Server server = _Server()..elsewhere('reminderLeadDays', 7);
      final _Device fresh = _Device(server);
      await fresh.sync.sync();
      expect(server.patches, 0);
      expect(server.values, <String, Object?>{'reminderLeadDays': 7});
      expect(fresh.shown['reminderLeadDays'], 7);
    },
  );

  test(
    '🔴 finding 1A: a stale device sends only its own key; the other device keeps its change',
    () async {
      final _Server server = _Server();
      final _Device a = _Device(server);
      await a.set('currencyCode', 'USD');
      server.failWith = 0; // A goes offline
      await a.set('themeMode', 'dark');
      server.failWith = null;
      server.elsewhere('currencyCode', 'EUR'); // device B, meanwhile
      await a.sync.sync(); // A comes back to the front
      expect(server.values, <String, Object?>{
        'currencyCode': 'EUR',
        'themeMode': 'dark',
      });
      expect(a.shown, <String, Object?>{
        'currencyCode': 'EUR',
        'themeMode': 'dark',
      });
    },
  );

  test(
    '🔴 finding 1B: the same key changed elsewhere first is a conflict the server wins, and A shows it',
    () async {
      final _Server server = _Server();
      final _Device a = _Device(server);
      await a.set('currencyCode', 'USD'); // v1, A holds v1
      server.elsewhere('currencyCode', 'EUR'); // v2 from device B
      await a.set('currencyCode', 'GBP'); // based on v1: stale
      expect(server.values['currencyCode'], 'EUR');
      expect(a.shown['currencyCode'], 'EUR');
    },
  );

  test(
    '🔴 finding 2a: changed before the first read ever succeeded — not overwritten, sent',
    () async {
      // The account holds a theme; the currency was never set anywhere.
      final _Server server = _Server()..elsewhere('themeMode', 'light');
      final _Device a = _Device(server);
      server.failWith = 0;
      await a.sync.sync(); // cold start offline: the read fails
      await a.set('currencyCode', 'EUR');
      server.failWith = null;
      await a.sync.sync(); // back online, back to the front
      // The first successful read applies the account's keys and leaves the
      // dirty one alone; the change is sent, not dropped.
      expect(a.shown, <String, Object?>{
        'themeMode': 'light',
        'currencyCode': 'EUR',
      });
      expect(server.values['currencyCode'], 'EUR');
      // And where the account DID hold the key, the server's rule decides —
      // a change based on nothing is older than the row: the row wins.
      server.elsewhere('locale', 'en');
      final _Device b = _Device(server);
      server.failWith = 0;
      await b.set('locale', 'ta');
      server.failWith = null;
      await b.sync.sync();
      expect(server.values['locale'], 'en');
      expect(b.shown['locale'], 'en');
    },
  );

  test(
    '🔴 finding 2b/2c: a change survives a restart (or a rebuilt provider) and is sent',
    () async {
      final _Server server = _Server()..elsewhere('themeMode', 'light');
      final _Device a = _Device(server);
      await a.sync.sync();
      server.failWith = 0;
      await a.set('themeMode', 'dark');
      a.sync.dispose();
      a.restart(); // the OS killed the app, or Retry rebuilt the provider
      server.failWith = null;
      await a.sync.sync();
      expect(a.shown['themeMode'], 'dark');
      expect(server.values['themeMode'], 'dark');
    },
  );

  test(
    '🔴 finding 2: after a restart, a read never overwrites a key still waiting to be sent',
    () async {
      final _Server server = _Server()..elsewhere('themeMode', 'light');
      final _Device a = _Device(server);
      await a.sync.sync();
      server.failWith = 0;
      await a.set('themeMode', 'dark');
      a.sync.dispose();
      a.restart(); // no memory of the change survives — only the store
      server.failWith = null;
      server.patchFailWith = 503; // reads work, the write keeps failing
      await a.sync.sync();
      expect(a.shown['themeMode'], 'dark');
      server.patchFailWith = null;
      await a.sync.sync();
      expect(server.values['themeMode'], 'dark');
    },
  );

  test(
    '🔴 finding 3: a toggle during the focus re-read keeps the new value',
    () async {
      final _Server server = _Server()..elsewhere('themeMode', 'light');
      final _Device a = _Device(server);
      await a.sync.sync();
      final Completer<void> readGate = Completer<void>();
      server.holdRead = readGate; // the re-read is slow
      final Future<void> reread = a.sync.sync(); // window focused
      await a.settle();
      await a.set(
        'themeMode',
        'dark',
      ); // the same click toggles; its PATCH lands
      readGate.complete(); // the read, asked before the toggle, answers "light"
      await reread;
      await a.settle();
      expect(a.shown['themeMode'], 'dark');
      expect(server.values['themeMode'], 'dark');
    },
  );

  test(
    '🔴 finding 3: a toggle during a re-read whose PATCH is still out keeps the new value',
    () async {
      final _Server server = _Server()..elsewhere('themeMode', 'light');
      final _Device a = _Device(server);
      await a.sync.sync();
      final Completer<void> readGate = Completer<void>();
      server.holdRead = readGate;
      final Completer<void> patchGate = Completer<void>();
      server.holdPatch = patchGate;
      final Future<void> reread = a.sync.sync();
      await a.settle();
      await a.set('themeMode', 'dark'); // PATCH held: the key is still dirty
      readGate.complete();
      await reread;
      expect(a.shown['themeMode'], 'dark');
      patchGate.complete();
      await a.settle();
      expect(server.values['themeMode'], 'dark');
      expect(a.shown['themeMode'], 'dark');
    },
  );

  test(
    '🔴 finding 3: two quick changes land in order, the second based on the first',
    () async {
      final _Server server = _Server();
      final _Device a = _Device(server);
      final Completer<void> patchGate = Completer<void>();
      server.holdPatch = patchGate; // the first PATCH is slow
      a.shown['reminderLeadDays'] = 3;
      await a.sync.changed('reminderLeadDays', 3);
      await a.settle();
      a.shown['reminderLeadDays'] = 7;
      await a.sync.changed('reminderLeadDays', 7);
      await a.settle();
      expect(
        server.patches,
        0,
        reason: 'one PATCH in flight, the second waits',
      );
      patchGate.complete();
      await a.settle();
      expect(server.patches, 2);
      expect(server.values['reminderLeadDays'], 7);
      expect(server.rows['reminderLeadDays']!.version, 2);
      expect(a.shown['reminderLeadDays'], 7);
    },
  );

  test(
    "🔴 finding 5: user A's in-flight read never writes into user B",
    () async {
      final _Server server = _Server()..elsewhere('currencyCode', 'USD');
      final _Device d = _Device(server, user: 'a');
      final Completer<void> readGate = Completer<void>();
      server.holdRead = readGate;
      final Future<void> aRead = d.sync.sync();
      await d.settle();
      await d.sync.forget('a'); // A signs out …
      d.user = 'b'; // … and B signs in on the same device
      readGate.complete(); // A's read answers now
      await aRead;
      expect(d.shown, isEmpty);
      expect(d.store.data.keys.where((String k) => k.contains('.b')), isEmpty);
    },
  );

  test(
    "🔴 finding 5: a change queued by A is never sent under B, and sign-out forgets it",
    () async {
      final _Server server = _Server();
      final _Device d = _Device(server, user: 'a');
      server.failWith = 0;
      await d.set('currencyCode', 'EUR');
      await d.sync.forget('a');
      d.user = 'b';
      server.failWith = null;
      await d.sync.sync();
      expect(server.patches, 0);
      expect(server.values, isEmpty);
    },
  );

  test(
    '🔴 finding 6: a permanent 400 drops that change once, says so, and the read goes on',
    () async {
      final _Server server = _Server()..elsewhere('locale', 'en');
      final _Device a = _Device(server);
      server.failWith = 400;
      await a.set('locale', 'xx-bad');
      server.failWith = null;
      await a.sync.sync();
      expect(a.refused, <String>['locale'], reason: 'surfaced once');
      expect(
        a.shown['locale'],
        'en',
        reason: 'the account value is read again',
      );
      final int patchesBefore = server.patches;
      await a.sync.sync();
      await a.sync.sync();
      expect(server.patches, patchesBefore, reason: 'never re-sent: no loop');
      expect(a.refused, hasLength(1));
    },
  );

  test(
    'a 413 is permanent too; a 404 (a Worker before the route) waits instead',
    () async {
      expect(
        classifyPreferencesFailure(const AccountPreferencesFailure(413)),
        OutboxFailure.refused,
      );
      expect(
        classifyPreferencesFailure(const AccountPreferencesFailure(404)),
        OutboxFailure.transient,
      );
      expect(
        classifyPreferencesFailure(const AccountPreferencesFailure(0)),
        OutboxFailure.offline,
      );
      expect(
        classifyPreferencesFailure(const AccountPreferencesFailure(401)),
        OutboxFailure.unauthorized,
      );
    },
  );

  test('signed out, a change stays local and is never sent', () async {
    final _Server server = _Server();
    final _Device d = _Device(server, user: null);
    await d.set('themeMode', 'dark');
    d.user = 'me';
    await d.sync.sync();
    expect(server.patches, 0);
  });

  test(
    'an already signed-in device picks up another device’s change on the next sync',
    () async {
      final _Server server = _Server();
      final _Device a = _Device(server);
      final _Device b = _Device(server);
      await b.sync.sync();
      await a.set('switch.weekly', true);
      await b.sync.sync(); // B comes back to the front
      expect(b.shown['switch.weekly'], true);
    },
  );
}
