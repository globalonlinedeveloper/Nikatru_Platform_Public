// ─────────────────────────────────────────────────────────────────────────────
// a11y_app_lock_test.dart — the accessibility sweep for the lock (T16, XP-03).
//
// Named `a11y_*_test.dart` on purpose: `assert-a11y-coverage.mjs` credits a
// sweep to a surface only when the surface is CONSTRUCTED and the guideline
// CALLED in one `testWidgets` body. The lock screen is the one screen a locked
// person cannot get past, so it is swept in both schemes, with the biometric
// door shown.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_app_lock/nikatru_app_lock.dart';
import 'package:nikatru_core/nikatru_core.dart' show InMemorySecureStore;
import 'package:nikatru_design_system/nikatru_design_system.dart';

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

class _Bio implements BiometricUnlocker {
  @override
  Future<bool> isAvailable() async => true;
  @override
  Future<bool> authenticate(String reason) async => false;
}

Future<AppLockController> _locked() async {
  final AppLockController c = AppLockController(
    store: InMemorySecureStore(),
    signOut: () async {},
    biometric: _Bio(),
  );
  await c.enable(pin: '2468', delay: Duration.zero);
  await c.load();
  return c;
}

void main() {
  for (final Brightness b in Brightness.values) {
    testWidgets('AppLockGate over a locked app, ${b.name}', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.binding.setSurfaceSize(const Size(375, 812));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final AppLockController c = await _locked();
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
          home: AppLockGate(
            controller: c,
            strings: _strings,
            child: const Scaffold(body: Text('hidden')),
          ),
        ),
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('AppLockScreen alone, ${b.name}', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.binding.setSurfaceSize(const Size(375, 812));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final AppLockController c = await _locked();
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
          home: AppLockScreen(controller: c, strings: _strings),
        ),
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  }
}
