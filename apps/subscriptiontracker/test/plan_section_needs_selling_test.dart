// ─────────────────────────────────────────────────────────────────────────────
// ST-U2 (audit C44/D17) — Settings does not offer to manage a plan nobody can
// buy. With `paywall.enabled` false the "Subscription" section and "Manage
// subscription" showed to every signed-in user, over a product that does not
// exist; a Pro user keeps them, because cancelling must stay reachable (ROSCA).
//
// MUTATION PROOF: drop the `sellingEnabledProvider || isPro` clause from the
// section's `if` in settings_screen.dart and the first case goes red.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';
import 'support/width_harness.dart';

Future<void> _pump(WidgetTester tester, {required bool selling}) async {
  final MockAuthRepository auth = MockAuthRepository();
  await auth.signInWithEmail(email: 'alex@example.com', password: 'hunter22');
  await pumpAt(
    tester,
    const Size(800, 4000),
    const SettingsScreen(),
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(auth),
      sellingEnabledProvider.overrideWithValue(selling),
    ],
  );
}

void main() {
  testWidgets('nothing sold: no "Manage subscription" row', (
    WidgetTester tester,
  ) async {
    await _pump(tester, selling: false);
    expect(find.text('Manage plan'), findsNothing);
  });

  testWidgets('selling: the row is there, beside the upgrade path', (
    WidgetTester tester,
  ) async {
    await _pump(tester, selling: true);
    expect(find.text('Manage plan'), findsOneWidget);
  });
}
