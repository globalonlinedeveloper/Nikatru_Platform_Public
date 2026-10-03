import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:subscriptiontracker/features/shared/chassis_adapters.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

/// refund-finish (MF-7) — the adapter half: the plan card's detail line says
/// WHY access ended and WHEN, from the recorded revocation reason, picked by
/// its index in the generated contract list — and only when the plan's state
/// agrees with it.
void main() {
  core.Entitlements ent(String? reason, {bool active = false}) =>
      core.Entitlements(
        appId: 'subscriptiontracker',
        isPro: active,
        items: <core.Entitlement>[
          core.Entitlement(
            entitlement: 'pro',
            productId: 'pro_monthly',
            store: 'PADDLE',
            isActive: active,
            expiresAt: DateTime.utc(2026, 9, 30),
            revocationReason: reason,
          ),
        ],
      );

  Future<void> check(
    WidgetTester tester,
    void Function(BuildContext, AppLocalizations) body,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          AppLocalizations.delegate,
          ...ChassisLocalizations.localizationsDelegates,
        ],
        supportedLocales: ChassisLocalizations.supportedLocales,
        home: Builder(
          builder: (BuildContext context) {
            body(context, AppLocalizations.of(context));
            return const SizedBox();
          },
        ),
      ),
    );
  }

  testWidgets('every contract reason says its own sentence, in its state', (
    WidgetTester tester,
  ) async {
    await check(tester, (BuildContext context, AppLocalizations l10n) {
      final List<String> sentences = revocationReasonSentences(
        context.chassisL10n,
      );
      for (int i = 0; i < kRevocationReasons.length; i++) {
        final EntitlementRevocationReason r = kRevocationReasons[i];
        final String line = planDetailOf(
          context,
          l10n,
          ent(r.reason, active: r.restoresAccess),
          isPro: r.restoresAccess,
        );
        expect(line, startsWith(sentences[i]), reason: r.reason);
        // The state contradicts the reason: the plain line.
        expect(
          planDetailOf(context, l10n, ent(r.reason), isPro: !r.restoresAccess),
          !r.restoresAccess ? l10n.planActiveDetail : l10n.planInactiveDetail,
          reason: r.reason,
        );
      }
    });
  });

  testWidgets('a refund says which and when', (WidgetTester tester) async {
    await check(tester, (BuildContext context, AppLocalizations l10n) {
      expect(
        planDetailOf(context, l10n, ent('refund_approved'), isPro: false),
        'Your plan ended because the payment was refunded. On Sep 30, 2026',
      );
    });
  });

  testWidgets('no reason, or an undeclared code, keeps the plain line', (
    WidgetTester tester,
  ) async {
    await check(tester, (BuildContext context, AppLocalizations l10n) {
      expect(
        planDetailOf(context, l10n, ent(null), isPro: false),
        l10n.planInactiveDetail,
      );
      expect(
        planDetailOf(context, l10n, ent('some_new_reason'), isPro: false),
        l10n.planInactiveDetail,
      );
      expect(
        planDetailOf(context, l10n, null, isPro: true),
        l10n.planActiveDetail,
      );
    });
  });
}
