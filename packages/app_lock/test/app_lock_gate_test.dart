import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_app_lock/nikatru_app_lock.dart';
import 'package:nikatru_core/nikatru_core.dart' show InMemorySecureStore;

const AppLockStrings _strings = AppLockStrings(
  title: 'Locked',
  pinLabel: 'PIN',
  unlock: 'Unlock',
  useBiometric: 'Use biometrics',
  biometricReason: 'Unlock the app',
  forgotPin: 'Forgot PIN? Sign out',
  wrongPin: _wrong,
);

String _wrong(int left) => 'Wrong PIN, $left left';

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
}
