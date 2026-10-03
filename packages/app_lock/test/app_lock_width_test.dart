import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_app_lock/nikatru_app_lock.dart';
import 'package:nikatru_core/nikatru_core.dart' show InMemorySecureStore;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppBreakpoints;

// The lock screen's width decision, at every window class: a phone, a
// tablet, a laptop and an ultra-wide desktop. It is a PIN form, so it is held
// to the form cap and never spans the display.
const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 800);
const Size kWide = Size(1920, 1080);

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

Future<void> _pumpAt(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final AppLockController c = AppLockController(
    store: InMemorySecureStore(),
    signOut: () async {},
    random: Random(3),
  );
  await c.enable(pin: '2468', delay: Duration.zero);
  await c.load();
  await tester.pumpWidget(
    MaterialApp(
      home: AppLockGate(
        controller: c,
        strings: _strings,
        child: const Scaffold(body: SizedBox.expand()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final Size size in <Size>[kPhone, kTablet, kDesktop, kWide]) {
    testWidgets('AppLockScreen at ${size.width.toInt()} px: no overflow, '
        'form-capped', (WidgetTester tester) async {
      await _pumpAt(tester, size);
      expect(tester.takeException(), isNull);
      expect(find.byType(AppLockScreen), findsOneWidget);
      final double field = tester
          .getSize(find.byKey(AppLockScreen.unlockKey))
          .width;
      expect(field, lessThanOrEqualTo(AppBreakpoints.form));
      expect(field, lessThanOrEqualTo(size.width));
    });
  }

  // The screen on its own, as a stamped app could mount it outside the gate.
  for (final Size size in <Size>[kPhone, kTablet, kDesktop, kWide]) {
    testWidgets('AppLockScreen alone at ${size.width.toInt()} px', (
      WidgetTester tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final AppLockController c = AppLockController(
        store: InMemorySecureStore(),
        signOut: () async {},
      );
      await tester.pumpWidget(
        MaterialApp(
          home: AppLockScreen(controller: c, strings: _strings),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(
        tester.getSize(find.byKey(AppLockScreen.unlockKey)).width,
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });
  }
}
