import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_app_lock/nikatru_app_lock.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show InMemorySecureStore, SecureStore;

class _BrokenStore implements SecureStore {
  @override
  Future<String?> read(String key) => Future<String?>.error(StateError('x'));
  @override
  Future<void> write(String key, String value) async {}
  @override
  Future<void> delete(String key) async {}
  @override
  Future<void> deleteAll() async {}
}

class _FakeBiometric implements BiometricUnlocker {
  _FakeBiometric({this.available = true, this.pass = true});
  final bool available;
  final bool pass;
  int asked = 0;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<bool> authenticate(String reason) async {
    asked++;
    return pass;
  }
}

void main() {
  late DateTime now;
  late InMemorySecureStore store;
  late int signOuts;

  AppLockController build({BiometricUnlocker? biometric}) => AppLockController(
    store: store,
    signOut: () async => signOuts++,
    biometric: biometric,
    clock: () => now,
    random: Random(7),
  );

  setUp(() {
    now = DateTime.utc(2026, 10, 1, 9);
    store = InMemorySecureStore();
    signOuts = 0;
  });

  test('the PIN is stored salted and hashed, never as digits', () async {
    final AppLockController c = build();
    await c.enable(pin: '2468', delay: Duration.zero);
    final String raw = (await store.read(AppLockController.storeKey))!;
    expect(raw, isNot(contains('2468')));
    expect(raw, contains('"hash"'));
  });

  test('a PIN that is not 4–8 digits is refused', () async {
    final AppLockController c = build();
    expect(
      () => c.enable(pin: '12', delay: Duration.zero),
      throwsArgumentError,
    );
    expect(
      () => c.enable(pin: 'abcd', delay: Duration.zero),
      throwsArgumentError,
    );
    expect(c.enabled, isFalse);
  });

  test(
    'RED CONTROL: with the lock on, a resume after the delay locks',
    () async {
      final AppLockController c = build();
      await c.enable(pin: '2468', delay: const Duration(minutes: 1));
      expect(
        c.locked,
        isFalse,
        reason: 'enabling does not lock the holder out',
      );

      c.backgrounded();
      now = now.add(const Duration(seconds: 30));
      c.resumed();
      expect(c.locked, isFalse, reason: 'inside the delay');

      c.backgrounded();
      now = now.add(const Duration(minutes: 1));
      c.resumed();
      expect(c.locked, isTrue);
    },
  );

  test('with the lock off, a resume never locks', () async {
    final AppLockController c = build();
    await c.load();
    c.backgrounded();
    now = now.add(const Duration(hours: 1));
    c.resumed();
    expect(c.locked, isFalse);
  });

  test('a cold start with the lock on starts locked', () async {
    await build().enable(pin: '2468', delay: const Duration(minutes: 5));
    final AppLockController fresh = build();
    await fresh.load();
    expect(fresh.enabled, isTrue);
    expect(fresh.locked, isTrue);
  });

  test('the right PIN unlocks', () async {
    final AppLockController c = build();
    await c.enable(pin: '2468', delay: Duration.zero);
    await c.load();
    expect(await c.submitPin('2468'), PinOutcome.unlocked);
    expect(c.locked, isFalse);
  });

  test('RED CONTROL: five wrong PINs sign out and clear the lock', () async {
    final AppLockController c = build();
    await c.enable(pin: '2468', delay: Duration.zero);
    await c.load();
    for (int i = 1; i < AppLockController.defaultMaxAttempts; i++) {
      expect(await c.submitPin('0000'), PinOutcome.wrong);
      expect(c.attemptsLeft, AppLockController.defaultMaxAttempts - i);
    }
    expect(signOuts, 0);
    expect(await c.submitPin('0000'), PinOutcome.signedOut);
    expect(signOuts, 1);
    expect(c.enabled, isFalse);
    expect(c.locked, isFalse);
    expect(
      await store.read(AppLockController.storeKey),
      isNull,
      reason: 'signing back in must not meet a PIN nobody knows',
    );
  });

  test('a right PIN resets the wrong count', () async {
    final AppLockController c = build();
    await c.enable(pin: '2468', delay: Duration.zero);
    await c.load();
    await c.submitPin('0000');
    await c.submitPin('0000');
    await c.submitPin('2468');
    expect(c.attemptsLeft, AppLockController.defaultMaxAttempts);
  });

  test('a corrupt record is no record, never a lock nobody can open', () async {
    await store.write(AppLockController.storeKey, '{not json');
    final AppLockController c = build();
    await c.load();
    expect(c.enabled, isFalse);
    expect(c.locked, isFalse);
  });

  test('the biometric unlocks only on a pass', () async {
    final _FakeBiometric fail = _FakeBiometric(pass: false);
    final AppLockController c = build(biometric: fail);
    await c.enable(pin: '2468', delay: Duration.zero);
    await c.load();
    expect(await c.unlockWithBiometric('why'), isFalse);
    expect(c.locked, isTrue);

    final AppLockController ok = build(biometric: _FakeBiometric());
    await ok.load();
    expect(await ok.unlockWithBiometric('why'), isTrue);
    expect(ok.locked, isFalse);
  });

  test('an unavailable biometric is never asked', () async {
    final _FakeBiometric none = _FakeBiometric(available: false);
    final AppLockController c = build(biometric: none);
    await c.enable(pin: '2468', delay: Duration.zero);
    await c.load();
    expect(await c.unlockWithBiometric('why'), isFalse);
    expect(none.asked, 0);
  });

  test('a store that cannot be read loads as no lock, never a throw', () async {
    final AppLockController c = AppLockController(
      store: _BrokenStore(),
      signOut: () async {},
    );
    await c.load();
    expect(c.enabled, isFalse);
    expect(c.locked, isFalse);
  });

  group('⏱ 2026-10-02 · review of #1155, finding 2: the attempts outlive the '
      'process', () {
    test('RED CONTROL: 3 wrong, relaunch, 2 wrong -> signed out', () async {
      final AppLockController first = build();
      await first.enable(pin: '2468', delay: Duration.zero);
      await first.load();
      for (int i = 0; i < 3; i++) {
        expect(await first.submitPin('0000'), PinOutcome.wrong);
      }
      // A relaunch: a fresh controller over the same secure store.
      final AppLockController second = build();
      await second.load();
      expect(second.locked, isTrue);
      expect(second.attemptsLeft, 2);
      expect(await second.submitPin('0000'), PinOutcome.wrong);
      expect(await second.submitPin('0000'), PinOutcome.signedOut);
      expect(signOuts, 1);
      expect(second.enabled, isFalse);
    });

    test('the attempt is written before the PIN is compared', () async {
      final AppLockController c = build();
      await c.enable(pin: '2468', delay: Duration.zero);
      await c.load();
      await c.submitPin('0000');
      final String? raw = await store.read(AppLockController.attemptsKey);
      expect(raw, contains('"wrong":1'));
    });

    test('a correct PIN gives the attempts back, across a relaunch', () async {
      final AppLockController first = build();
      await first.enable(pin: '2468', delay: Duration.zero);
      await first.load();
      for (int i = 0; i < 4; i++) {
        await first.submitPin('0000');
      }
      expect(await first.submitPin('2468'), PinOutcome.unlocked);
      expect(await store.read(AppLockController.attemptsKey), isNull);
      final AppLockController second = build();
      await second.load();
      expect(second.attemptsLeft, AppLockController.defaultMaxAttempts);
    });

    test('a count that does not parse reads as the attempts spent', () async {
      final AppLockController first = build();
      await first.enable(pin: '2468', delay: Duration.zero);
      await store.write(AppLockController.attemptsKey, '{not json');
      final AppLockController second = build();
      await second.load();
      expect(second.lockedOut, isTrue);
      expect(await second.submitPin('2468'), PinOutcome.lockedOut);
    });
  });

  group('⏱ 2026-10-02 · review of #1155, finding 6: the lock never silently '
      'discards unsynced writes', () {
    late int unsent;
    late int syncs;
    late List<int> asked;

    AppLockController withQueue() => AppLockController(
      store: store,
      signOut: () async => signOuts++,
      unsyncedChanges: () async {
        syncs++;
        return unsent;
      },
      clock: () => now,
      random: Random(7),
    );

    setUp(() {
      unsent = 3;
      syncs = 0;
      asked = <int>[];
    });

    Future<bool> Function(int) answer(bool yes) => (int n) async {
      asked.add(n);
      return yes;
    };

    test('RED CONTROL: Forgot PIN with unsent writes asks, and "keep" keeps '
        'them and the lock', () async {
      final AppLockController c = withQueue();
      await c.enable(pin: '2468', delay: Duration.zero);
      await c.load();
      expect(await c.forgotPin(confirmDiscard: answer(false)), isFalse);
      expect(syncs, 1, reason: 'a sync is tried first');
      expect(asked, <int>[3]);
      expect(signOuts, 0);
      expect(c.enabled, isTrue);
      expect(c.locked, isTrue);
    });

    test('with no one to ask, nothing unsynced is discarded', () async {
      final AppLockController c = withQueue();
      await c.enable(pin: '2468', delay: Duration.zero);
      await c.load();
      expect(await c.forgotPin(), isFalse);
      expect(signOuts, 0);
    });

    test('agreeing signs out', () async {
      final AppLockController c = withQueue();
      await c.enable(pin: '2468', delay: Duration.zero);
      await c.load();
      expect(await c.forgotPin(confirmDiscard: answer(true)), isTrue);
      expect(signOuts, 1);
      expect(c.enabled, isFalse);
    });

    test('a sync that sent everything signs out without asking', () async {
      unsent = 0;
      final AppLockController c = withQueue();
      await c.enable(pin: '2468', delay: Duration.zero);
      await c.load();
      expect(await c.forgotPin(confirmDiscard: answer(false)), isTrue);
      expect(asked, isEmpty);
      expect(signOuts, 1);
    });

    test('five wrong PINs with unsent writes, kept: locked out, across a '
        'relaunch, and no PIN is checked any more', () async {
      final AppLockController c = withQueue();
      await c.enable(pin: '2468', delay: Duration.zero);
      await c.load();
      PinOutcome last = PinOutcome.wrong;
      for (int i = 0; i < AppLockController.defaultMaxAttempts; i++) {
        last = await c.submitPin('0000', confirmDiscard: answer(false));
      }
      expect(last, PinOutcome.lockedOut);
      expect(signOuts, 0);
      expect(asked, <int>[3]);
      final AppLockController again = withQueue();
      await again.load();
      expect(again.lockedOut, isTrue);
      expect(again.locked, isTrue);
      expect(await again.submitPin('2468'), PinOutcome.lockedOut);
      // Back online later: the sync sends everything and the sign-out runs.
      unsent = 0;
      expect(await again.forgotPin(), isTrue);
      expect(signOuts, 1);
    });
  });

  test(
    '⏱ review of #1155, finding 5: not ready until the store has answered',
    () async {
      final AppLockController c = build();
      expect(c.ready, isFalse);
      await c.load();
      expect(c.ready, isTrue);
    },
  );
}
