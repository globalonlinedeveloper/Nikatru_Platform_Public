import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:subscriptiontracker/features/monetization/manage_plan_screen.dart';

/// refund-finish (MF-7) — the adapter half: the recorded revocation reason
/// picks its chassis sentence by its index in the generated contract list,
/// and only when the plan's state agrees with it.
void main() {
  late ChassisLocalizations l10n;
  setUpAll(() async {
    l10n = await ChassisLocalizations.delegate.load(const Locale('en'));
  });

  test(
    'every contract reason has its own sentence, in the state it describes',
    () {
      final List<String> sentences = revocationReasonSentences(l10n);
      for (int i = 0; i < kRevocationReasons.length; i++) {
        final EntitlementRevocationReason r = kRevocationReasons[i];
        expect(
          endedReasonText(l10n, r.reason, isPro: r.restoresAccess),
          sentences[i],
          reason: r.reason,
        );
        // The state contradicts the reason: say nothing.
        expect(
          endedReasonText(l10n, r.reason, isPro: !r.restoresAccess),
          isNull,
        );
      }
    },
  );

  test('a refund reads as a refund, never as another reason', () {
    expect(
      endedReasonText(l10n, 'refund_approved', isPro: false),
      'Your plan ended because the payment was refunded.',
    );
  });

  test('no reason, or a code the contract does not declare, says nothing', () {
    expect(endedReasonText(l10n, null, isPro: false), isNull);
    expect(endedReasonText(l10n, 'some_new_reason', isPro: false), isNull);
  });
}
