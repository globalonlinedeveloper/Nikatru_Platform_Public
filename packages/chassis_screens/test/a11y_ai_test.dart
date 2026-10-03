import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/ai/ai_disclosure.dart';

import 'support/a11y_harness.dart';
import 'support/width_harness.dart';

/// A11Y — THE AI SURFACES (train-st-ai-customer-pays, T17; EU AI Act Art. 50).
///
/// `AiDisclosureDialog` (shown before the first AI call) and `AiOutputLabel`
/// (on every AI output, with its report action) arrived together on
/// 2026-10-02 and are swept here in the same change. See `a11y_auth_test.dart`'s
/// header for what each case asserts and why; the subject counts were measured
/// off this rig the day they landed.
void main() {
  group('a11y: ai-disclosure-dialog', () {
    for (final (Size size, Brightness b, String tag)
        in <(Size, Brightness, String)>[
          (kPhone, Brightness.light, 'light, kPhone'),
          (kDesktop, Brightness.dark, 'dark, kDesktop'),
        ]) {
      testWidgets(tag, (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        try {
          await pumpForA11y(
            tester,
            size,
            Scaffold(
              body: AiDisclosureDialog(
                processor: 'Anthropic',
                onOpenPrivacy: () {},
              ),
            ),
            brightness: b,
          );
          expectSweepHadSubjects(
            tester,
            'ai-disclosure-dialog ($tag)',
            tappable: 3,
            labelled: 5,
          );
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
        } finally {
          handle.dispose();
        }
      }, variant: kTapTargetPlatforms);
    }
  });

  group('a11y: ai-output-label', () {
    for (final (Size size, Brightness b, String tag)
        in <(Size, Brightness, String)>[
          (kTablet, Brightness.light, 'light, kTablet'),
          (kPhone, Brightness.dark, 'dark, kPhone'),
        ]) {
      testWidgets(tag, (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        try {
          await pumpForA11y(
            tester,
            size,
            Scaffold(
              body: Column(
                children: <Widget>[
                  AiOutputLabel(kind: AiOutputKind.candidate, onReport: () {}),
                  AiOutputLabel(kind: AiOutputKind.suggestion, onReport: () {}),
                ],
              ),
            ),
            brightness: b,
          );
          expectSweepHadSubjects(
            tester,
            'ai-output-label ($tag)',
            tappable: 2,
            labelled: 2,
          );
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
        } finally {
          handle.dispose();
        }
      }, variant: kTapTargetPlatforms);
    }
  });
}
