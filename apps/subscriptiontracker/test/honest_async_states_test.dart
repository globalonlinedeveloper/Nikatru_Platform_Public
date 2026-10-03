// ─────────────────────────────────────────────────────────────────────────────
// ST-U7 — HONEST ASYNC STATES: "STILL ASKING" AND "COULD NOT ASK" ARE NEVER
// RENDERED AS AN ANSWER.
//
// The audit (Private/research/session-2026-09-23/full-review-r2/
// product-audit-st.md §7.2) measured four places that did:
//   · B16 — payment history: loading AND failure printed "No payments yet."
//   · C42 — manage plan: "You do not have an active subscription" while the
//     entitlement was loading or could not be fetched.
//   · C38 — paywall: "Purchases are not available here." while a store rail
//     was still being asked for its plans.
//   · D20 — the list client had no 401 handler, so a session revoked elsewhere
//     said "check your connection" forever instead of reaching sign-in.
//
// RED CONTROLS: go back to `snap.data ?? const []`, `valueOrNull ?? false`, the
// unconditional unavailable sentence, or drop `onUnauthorized:` — each case
// below is red on its own.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisLocalizations;
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/features/monetization/manage_plan_screen.dart';
import 'package:subscriptiontracker/features/monetization/paywall_screen.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

/// A store rail that has been asked and has not answered yet.
class _SlowStoreRail extends ChangeNotifier
    implements PurchaseRail, LoadsOfferings {
  final Completer<void> answer = Completer<void>();

  @override
  PurchaseRailKind get railKind => PurchaseRailKind.playBilling;

  @override
  List<Offering> get offerings => const <Offering>[];

  @override
  bool get canStartCheckout => false;

  @override
  Listenable get offeringsChanged => this;

  @override
  Future<void> refreshOfferings() => answer.future;

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async =>
      const CheckoutRefused(CheckoutRefusal.notSignedIn, detail: 'no buy');

  @override
  Future<CancellationOutcome> requestCancellation() async =>
      CancellationOutcome.noActivePlan;
}

void main() {
  group('B16 · payment history', () {
    testWidgets('loading is not "No payments yet."', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const SubscriptionDetailScreen(id: '1'),
        overrides: <Override>[
          paymentHistoryProvider.overrideWith(
            (Ref ref, String id) => Completer<List<PaymentRecord>>().future,
          ),
        ],
      );
      final AppLocalizations l10n = await _en();
      // ⏱ 2026-10-01 · DE-11: the details list sits above the history now, so
      // at kPhone the card is below the fold of a lazy list until scrolled to.
      await tester.scrollUntilVisible(
        find.byKey(const Key('payment-history-loading')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.byKey(const Key('payment-history-loading')), findsOneWidget);
      expect(find.text(l10n.noPaymentsYet), findsNothing);
    });

    testWidgets('failure is not "No payments yet.", and offers Retry', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const SubscriptionDetailScreen(id: '1'),
        overrides: <Override>[
          paymentHistoryProvider.overrideWith(
            (Ref ref, String id) async => throw StateError('down'),
          ),
        ],
      );
      final AppLocalizations l10n = await _en();
      await tester.scrollUntilVisible(
        find.byKey(const Key('payment-history-failed')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.byKey(const Key('payment-history-failed')), findsOneWidget);
      expect(find.text(l10n.paymentHistoryFailed), findsOneWidget);
      expect(find.text(l10n.noPaymentsYet), findsNothing);
    });
  });

  group('C42 · manage plan', () {
    testWidgets('loading does not say "no active subscription"', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const ManagePlanScreen(),
        overrides: <Override>[
          entitlementsProvider.overrideWith(
            (Ref ref) => Completer<core.Entitlements>().future,
          ),
        ],
      );
      final AppLocalizations l10n = await _en();
      expect(
        find.byKey(const Key('manage-plan-status-loading')),
        findsOneWidget,
      );
      expect(find.text(l10n.planInactive), findsNothing);
    });

    testWidgets('a failed check says so, with Retry', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const ManagePlanScreen(),
        overrides: <Override>[
          entitlementsProvider.overrideWith(
            (Ref ref) async => throw StateError('down'),
          ),
        ],
      );
      final AppLocalizations l10n = await _en();
      expect(
        find.byKey(const Key('manage-plan-status-failed')),
        findsOneWidget,
      );
      // ⏱ ST-D9: the failure is the chassis ManagePlanView's own sentence
      // (one catalogue for every stamped app), still under C42's key.
      final ChassisLocalizations chassis = await ChassisLocalizations.delegate
          .load(const Locale('en'));
      expect(find.text(chassis.managePlanLoadFailed), findsOneWidget);
      expect(find.text(l10n.planInactive), findsNothing);
    });
  });

  testWidgets('C38 · a store still being asked is not "not available"', (
    WidgetTester tester,
  ) async {
    final _SlowStoreRail rail = _SlowStoreRail();
    addTearDown(rail.dispose);
    await pumpAt(
      tester,
      kPhone,
      const PaywallScreen(),
      overrides: <Override>[
        sellingEnabledProvider.overrideWithValue(true),
        purchaseRailProvider.overrideWithValue(rail),
      ],
    );
    final AppLocalizations l10n = await _en();
    expect(find.byKey(const Key('paywall-offerings-loading')), findsOneWidget);
    expect(find.text(l10n.paywallUnavailable), findsNothing);

    // The store answers with nothing: NOW "not available" is the truth.
    rail.answer.complete();
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('paywall-offerings-loading')), findsNothing);
    expect(find.text(l10n.paywallUnavailable), findsOneWidget);
  });

  test('D20 · the list client routes a 401 through the session check', () {
    // `AppConfig.isApiConfigured` is a compile-time define, so no flutter
    // test reaches the configured branch of `apiClientProvider`; the wiring is
    // asserted on the source, and the decision it calls
    // (`signOutOnlyIfSessionIsGone`) is driven by its own tests.
    final String src = File(
      'lib/state/providers/subscriptions.dart',
    ).readAsStringSync();
    final int client = src.indexOf('DioApiClient(');
    expect(client, greaterThan(0));
    final String call = src.substring(client, src.indexOf('store,', client));
    expect(
      call,
      contains('onUnauthorized:'),
      reason:
          'a 401 on the list must reach sign-in, not "check your connection"',
    );
    expect(call, contains('signOutOnlyIfSessionIsGone('));
  });
}
