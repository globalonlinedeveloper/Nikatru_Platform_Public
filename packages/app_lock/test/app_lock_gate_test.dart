import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_app_lock/nikatru_app_lock.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show InMemorySecureStore, SecureStore;

const AppLockStrings _strings = AppLockStrings(
  title: 'Locked',
  pinLabel: 'PIN',
  unlock: 'Unlock',
  useBiometric: 'Use biometrics',
  biometricReason: 'Unlock the app',
  forgotPin: 'Forgot PIN? Sign out',
  wrongPin: _wrong,
  lockedOut: 'Too many wrong PINs. Sign out to continue.',
  unsyncedWarning: _unsynced,
  signOutAnyway: 'Sign out anyway',
  keepChanges: 'Keep my changes',
);

String _wrong(int left) => 'Wrong PIN, $left left';

String _unsynced(int n) => '$n changes not synced will be lost';

void main() {
  late DateTime now;
  late int signOuts;
  late AppLockController controller;

  setUp(() async {
    now = DateTime.utc(2026, 10, 1, 9);
    signOuts = 0;
    controller = AppLockController(
      store: InMemorySecureStore(),
      signOut: () async => signOuts++,
      clock: () => now,
      random: Random(1),
    );
    await controller.enable(pin: '2468', delay: Duration.zero);
  });

  Future<void> pump(WidgetTester tester) => tester.pumpWidget(
    MaterialApp(
      home: AppLockGate(
        controller: controller,
        strings: _strings,
        child: const Scaffold(body: Text('secret list')),
      ),
    ),
  );

  testWidgets('RED CONTROL: a resume with the lock on shows the lock screen', (
    WidgetTester tester,
  ) async {
    await pump(tester);
    expect(find.byType(AppLockScreen), findsNothing);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    now = now.add(const Duration(seconds: 1));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();

    expect(find.byType(AppLockScreen), findsOneWidget);
    expect(find.text('Locked'), findsOneWidget);
  });

  testWidgets('the right PIN on the lock screen opens the app', (
    WidgetTester tester,
  ) async {
    await controller.load();
    await pump(tester);
    expect(find.byType(AppLockScreen), findsOneWidget);

    await tester.enterText(find.byKey(AppLockScreen.pinFieldKey), '2468');
    await tester.tap(find.byKey(AppLockScreen.unlockKey));
    await tester.pumpAndSettle();
    expect(find.byType(AppLockScreen), findsNothing);
    expect(find.text('secret list'), findsOneWidget);
  });

  testWidgets('RED CONTROL: five wrong PINs on the screen sign out', (
    WidgetTester tester,
  ) async {
    await controller.load();
    await pump(tester);
    for (int i = 0; i < AppLockController.defaultMaxAttempts; i++) {
      await tester.enterText(find.byKey(AppLockScreen.pinFieldKey), '0000');
      await tester.tap(find.byKey(AppLockScreen.unlockKey));
      await tester.pumpAndSettle();
    }
    expect(signOuts, 1);
    expect(find.byType(AppLockScreen), findsNothing);
  });

  testWidgets('a wrong PIN says how many attempts are left', (
    WidgetTester tester,
  ) async {
    await controller.load();
    await pump(tester);
    await tester.enterText(find.byKey(AppLockScreen.pinFieldKey), '0000');
    await tester.tap(find.byKey(AppLockScreen.unlockKey));
    await tester.pumpAndSettle();
    expect(find.text('Wrong PIN, 4 left'), findsOneWidget);
  });

  testWidgets('the content under a lock is hidden from semantics', (
    WidgetTester tester,
  ) async {
    await controller.load();
    await pump(tester);
    expect(find.bySemanticsLabel('secret list'), findsNothing);
  });

  testWidgets(
    'RED CONTROL (#1155 finding 4): mounted in MaterialApp.builder, above the '
    'Navigator, a tap on the PIN field raises nothing',
    (WidgetTester tester) async {
      await controller.load();
      await tester.pumpWidget(
        MaterialApp(
          builder: (BuildContext context, Widget? child) => AppLockGate(
            controller: controller,
            strings: _strings,
            child: child!,
          ),
          home: const Scaffold(body: Text('secret list')),
        ),
      );
      await tester.tap(find.byKey(AppLockScreen.pinFieldKey));
      await tester.pump();
      expect(tester.takeException(), isNull);
      await tester.enterText(find.byKey(AppLockScreen.pinFieldKey), '2468');
      await tester.pump();
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(AppLockScreen.unlockKey));
      await tester.pumpAndSettle();
      expect(find.byType(AppLockScreen), findsNothing);
    },
  );

  testWidgets(
    'RED CONTROL (#1155 finding 5): a cold start covers the app until the '
    'store has answered, then shows the lock',
    (WidgetTester tester) async {
      final InMemorySecureStore backing = InMemorySecureStore();
      final AppLockController seed = AppLockController(
        store: backing,
        signOut: () async {},
        random: Random(1),
      );
      await seed.enable(pin: '2468', delay: Duration.zero);
      final _HeldStore held = _HeldStore(backing);
      final AppLockController cold = AppLockController(
        store: held,
        signOut: () async => signOuts++,
        random: Random(1),
      );
      int taps = 0;
      unawaited(cold.load());
      await tester.pumpWidget(
        MaterialApp(
          home: AppLockGate(
            controller: cold,
            strings: _strings,
            child: Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => taps++,
                  child: const Text('secret list'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.byKey(AppLockGate.pendingKey), findsOneWidget);
      expect(find.bySemanticsLabel('secret list'), findsNothing);
      await tester.tap(find.text('secret list'), warnIfMissed: false);
      expect(taps, 0, reason: 'nothing under the cover takes input');

      held.release();
      await tester.pumpAndSettle();
      expect(find.byKey(AppLockGate.pendingKey), findsNothing);
      expect(find.byType(AppLockScreen), findsOneWidget);
    },
  );

  testWidgets(
    'RED CONTROL (#1155 finding 6): Forgot PIN with unsynced writes says how '
    'many will be lost and asks',
    (WidgetTester tester) async {
      int syncs = 0;
      final AppLockController queued = AppLockController(
        store: InMemorySecureStore(),
        signOut: () async => signOuts++,
        unsyncedChanges: () async {
          syncs++;
          return 2;
        },
        random: Random(1),
      );
      await queued.enable(pin: '2468', delay: Duration.zero);
      await queued.load();
      await tester.pumpWidget(
        MaterialApp(
          home: AppLockGate(
            controller: queued,
            strings: _strings,
            child: const Scaffold(body: Text('secret list')),
          ),
        ),
      );
      await tester.tap(find.byKey(AppLockScreen.forgotKey));
      await tester.pumpAndSettle();
      expect(syncs, 1);
      expect(find.text('2 changes not synced will be lost'), findsOneWidget);
      expect(signOuts, 0);

      await tester.tap(find.byKey(AppLockScreen.keepChangesKey));
      await tester.pumpAndSettle();
      expect(signOuts, 0);
      expect(find.byType(AppLockScreen), findsOneWidget);

      await tester.tap(find.byKey(AppLockScreen.forgotKey));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(AppLockScreen.signOutAnywayKey));
      await tester.pumpAndSettle();
      expect(signOuts, 1);
      expect(find.byType(AppLockScreen), findsNothing);
    },
  );
}

/// A store whose reads wait until [release]: the Keychain's first answer.
class _HeldStore implements SecureStore {
  _HeldStore(this._inner);

  final SecureStore _inner;
  final Completer<void> _gate = Completer<void>();

  void release() => _gate.complete();

  @override
  Future<String?> read(String key) async {
    await _gate.future;
    return _inner.read(key);
  }

  @override
  Future<void> write(String key, String value) => _inner.write(key, value);

  @override
  Future<void> delete(String key) => _inner.delete(key);

  @override
  Future<void> deleteAll() => _inner.deleteAll();
}
