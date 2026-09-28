import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// A one-key store the cases drive by hand. A read can be HELD until the case
/// lets it land, and either side can be made to fail.
class _Store {
  _Store([this.value]);

  String? value;
  Completer<String?>? held;
  bool readFails = false;
  bool writeFails = false;
  final List<String> writes = <String>[];
}

/// The notifier's side: its state, every value applied to it in order, and
/// how often the unreadable fallback ran.
class _Holder {
  _Holder(this.state);

  int state;
  final List<int> applied = <int>[];
  int unreadable = 0;
}

PersistedValue<_Store, int> _value(_Store store, _Holder h) =>
    PersistedValue<_Store, int>(
      open: () async => store,
      read: (s) async {
        if (s.readFails) throw StateError('unreadable store');
        final Completer<String?>? held = s.held;
        return held == null ? s.value : held.future;
      },
      write: (s, raw) async {
        if (s.writeFails) throw StateError('unwritable store');
        s.writes.add(raw);
        s.value = raw;
      },
      decode: (raw) => raw == null ? 0 : int.parse(raw),
      encode: (v) => '$v',
      apply: (v) {
        h.state = v;
        h.applied.add(v);
      },
      onUnreadable: () => h.unreadable++,
    );

/// [PersistedValue] is the plumbing under the chassis's persisted controllers
/// ([ADR 072] D1.4). Each case below is one of the behaviours those
/// controllers' own comments call load-bearing, proven here once, over plain
/// callbacks, so a regression in the helper is red here and not only in an
/// app's property test.
void main() {
  test('hydrate applies the stored value', () async {
    final _Holder h = _Holder(-1);
    await _value(_Store('7'), h).hydrate();
    expect(h.state, 7);
    expect(h.applied, <int>[7]);
    expect(h.unreadable, 0);
  });

  test('an absent value applies what decode(null) says', () async {
    final _Holder h = _Holder(-1);
    await _value(_Store(), h).hydrate();
    expect(h.state, 0);
    expect(h.applied, <int>[0]);
  });

  test('a choice made before hydration lands is NOT clobbered', () async {
    final _Store store = _Store('7')..held = Completer<String?>();
    final _Holder h = _Holder(-1);
    final PersistedValue<_Store, int> v = _value(store, h);
    final Future<void> hydrating = v.hydrate();
    await v.set(3);
    store.held!.complete('7');
    await hydrating;
    expect(h.state, 3);
    expect(h.applied, <int>[3]);
    expect(store.writes, <String>['3']);
  });

  test('an earlier read applies, and a later choice wins', () async {
    final _Store store = _Store('7')..held = Completer<String?>();
    final _Holder h = _Holder(-1);
    final PersistedValue<_Store, int> v = _value(store, h);
    final Future<void> hydrating = v.hydrate();
    store.held!.complete('7');
    await hydrating;
    await v.set(3);
    expect(h.applied, <int>[7, 3]);
    expect(h.state, 3);
  });

  test('a failing read keeps the default and runs the fallback', () async {
    final _Store store = _Store('7')..readFails = true;
    final _Holder h = _Holder(-1);
    await _value(store, h).hydrate();
    expect(h.state, -1);
    expect(h.applied, isEmpty);
    expect(h.unreadable, 1);
  });

  test('a value decode cannot read is an unreadable store', () async {
    final _Holder h = _Holder(-1);
    await _value(_Store('not a number'), h).hydrate();
    expect(h.state, -1);
    expect(h.applied, isEmpty);
    expect(h.unreadable, 1);
  });

  test('a read that fails AFTER a choice runs no fallback', () async {
    final _Store store = _Store('7')..held = Completer<String?>();
    final _Holder h = _Holder(-1);
    final PersistedValue<_Store, int> v = _value(store, h);
    final Future<void> hydrating = v.hydrate();
    await v.set(3);
    store.held!.completeError(StateError('unreadable store'));
    await hydrating;
    expect(h.state, 3);
    expect(h.unreadable, 0);
  });

  test('set applies in memory before the write lands', () async {
    final _Store store = _Store();
    final _Holder h = _Holder(-1);
    final Future<void> writing = _value(store, h).set(4);
    expect(h.state, 4);
    expect(store.writes, isEmpty);
    await writing;
    expect(store.writes, <String>['4']);
  });

  test('ensureHydrated holds a counter until the read lands', () async {
    final _Store store = _Store('20')..held = Completer<String?>();
    final _Holder h = _Holder(0);
    final PersistedValue<_Store, int> v = _value(store, h);
    v.hydrate();
    final Future<void> counting = v.ensureHydrated().then(
      (_) => v.persist(h.state + 1),
    );
    store.held!.complete('20');
    await counting;
    expect(h.state, 21);
    expect(store.writes, <String>['21']);
  });

  test('persist marks no choice, so a later read still applies', () async {
    final _Store store = _Store();
    final _Holder h = _Holder(0);
    final PersistedValue<_Store, int> v = _value(store, h);
    await v.persist(5);
    store.value = '9';
    await v.hydrate();
    expect(h.state, 9);
    expect(h.applied, <int>[5, 9]);
  });

  test('a failed write keeps the in-memory value', () async {
    final _Store store = _Store('1')..writeFails = true;
    final _Holder h = _Holder(-1);
    await _value(store, h).set(5);
    expect(h.state, 5);
    expect(store.writes, isEmpty);
    expect(store.value, '1');
  });
}
