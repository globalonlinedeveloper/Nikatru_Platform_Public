import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// refund-finish (MF-7) — the plan screen says WHY access ended and WHEN.
///
///   · 🔴 PARITY AND ORDER: `revocationReasonSentences` has one sentence per
///     reason the entitlement contract declares
///     (`contracts/entitlement/contract.json`, the source `nikatru_purchases`'
///     generated `kRevocationReasons` is written from), in the contract's
///     order, in EVERY chassis locale — a new reason with no sentence, or a
///     reordering, fails here (the adapter picks a sentence by the reason's
///     index in the generated list);
///   · one case per reason: its sentence is on the status card, with the date
///     when the plan is not active.
void main() {
  final List<String> contractReasons = () {
    // `flutter test` runs from this package's directory.
    final File f = File('../../contracts/entitlement/contract.json');
    final Map<String, dynamic> j =
        jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
    return <String>[
      for (final Object? r in j['revocationReasons'] as List<Object?>)
        (r! as Map<String, dynamic>)['reason'] as String,
    ];
  }();

  // Test code may name the contract's codes; the chassis' lib code may not.
  const Map<String, String> english = <String, String>{
    'refund_approved': 'Your plan ended because the payment was refunded.',
    'chargeback': 'Your plan ended because the payment was disputed with your bank.',
    'chargeback_reversed':
        'Your plan was restored: the payment dispute was resolved.',
    'subscription_expired': 'Your plan ended when its paid period ran out.',
    'trial_expired': 'Your free trial has ended.',
    'payment_failed_final':
        'Your plan ended because the next payment could not be taken.',
    'cancelled_at_period_end':
        'Your plan was cancelled and ended at the end of its paid period.',
    'subscription_paused': 'Your plan is paused.',
  };

  testWidgets('🔴 one sentence per contract reason, in its order, in every locale',
      (WidgetTester tester) async {
    for (final Locale locale in ChassisLocalizations.supportedLocales) {
      final ChassisLocalizations l10n =
          await ChassisLocalizations.delegate.load(locale);
      final List<String> sentences = revocationReasonSentences(l10n);
      expect(sentences, hasLength(contractReasons.length), reason: '$locale');
      for (final String s in sentences) {
        expect(s.trim(), isNotEmpty, reason: '$locale');
      }
      if (locale.languageCode == 'en') {
        for (int i = 0; i < contractReasons.length; i++) {
          expect(
            sentences[i],
            english[contractReasons[i]],
            reason: 'position $i is ${contractReasons[i]}',
          );
        }
      } else {
        // A translation, not the English left in place.
        final List<String> en = revocationReasonSentences(
          await ChassisLocalizations.delegate.load(const Locale('en')),
        );
        for (int i = 0; i < sentences.length; i++) {
          expect(sentences[i], isNot(en[i]), reason: '$locale ${contractReasons[i]}');
        }
      }
    }
  });

  Widget view(String? text, {bool isPro = false, DateTime? endedOn}) =>
      ManagePlanView(
        title: 'Manage plan',
        isPro: isPro,
        planStatusLabel: isPro ? 'Your plan is active' : 'No active plan',
        restoreHint: 'Restore',
        cancelLabel: 'Cancel plan',
        busy: false,
        onBack: () {},
        onRestore: () {},
        onCancel: () {},
        endedReasonText: text,
        endedOn: endedOn,
      );

  for (final MapEntry<String, String> e in english.entries) {
    testWidgets('the status card says why: ${e.key}', (WidgetTester tester) async {
      final bool restores = e.key == 'chargeback_reversed';
      await pumpChassis(
        tester,
        restores ? kTablet : kPhone,
        view(e.value, isPro: restores, endedOn: DateTime.utc(2026, 9, 30)),
      );
      expect(
        find.descendant(
          of: find.byKey(ManagePlanView.statusCard),
          matching: find.text(e.value),
        ),
        findsOneWidget,
      );
      // When it ended: only while the plan is not active.
      expect(find.text('On Sep 30, 2026'), restores ? findsNothing : findsOneWidget);
    });
  }

  testWidgets('no reason, no sentence and no date', (WidgetTester tester) async {
    await pumpChassis(
      tester,
      kDesktop,
      view(null, endedOn: DateTime.utc(2026, 9, 30)),
    );
    expect(find.textContaining('Your plan ended'), findsNothing);
    expect(find.text('On Sep 30, 2026'), findsNothing);
  });
}
