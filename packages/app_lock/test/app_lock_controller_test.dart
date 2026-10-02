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
}
