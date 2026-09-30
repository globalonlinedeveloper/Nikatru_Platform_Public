// ─────────────────────────────────────────────────────────────────────────────
// a11y_auth_frame_test.dart — the accessibility sweep for the shared auth
// frame (train ST-D10): the frame with its brand, a Show / Hide field, the
// checklist, the "or" rule and an inline answer, compact and at the wide split,
// in both schemes.
//
// Named `a11y_*_test.dart` on purpose: `assert-a11y-coverage.mjs` credits a
// sweep to a surface only when the surface is CONSTRUCTED and the guideline
// CALLED in one `testWidgets` body.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  const AuthBrand brand = AuthBrand(mark: 'S', name: 'Subscriptions');
  for (final Brightness b in Brightness.values) {
    for (final double width in <double>[375, 1440]) {
      testWidgets('AuthFrame, ${b.name}, $width', (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await tester.binding.setSurfaceSize(Size(width, 1000));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(
          MaterialApp(
            theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
            home: AuthFrame(
              title: 'Create your account',
              subtitle: 'Start tracking every subscription.',
              brand: brand,
              panel: const AuthBrandPanel(
                brand: brand,
                headline: 'Never be charged by surprise.',
                body: 'Every renewal, trial and price rise, as one account.',
                footnote: 'No bank login',
              ),
              children: <Widget>[
                AuthField(
                  label: 'Password',
                  controller: TextEditingController(text: 'hunter22'),
                  keyboardType: TextInputType.text,
                  obscure: true,
                  reveal: const AuthRevealLabels(
                    show: 'Show',
                    hide: 'Hide',
                    showName: 'Show password',
                    hideName: 'Hide password',
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                const AuthPasswordChecklist(
                  rules: <AuthRule>[
                    AuthRule(
                      label: 'At least 8 characters',
                      state: AuthRuleState.met,
                    ),
                    AuthRule(
                      label: 'Not found in known data breaches',
                      state: AuthRuleState.failed,
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                const AuthMessage(
                  message: 'This password has appeared in a data breach.',
                  kind: StatusKind.danger,
                ),
                const SizedBox(height: AppSpacing.md),
                FilledButton(onPressed: () {}, child: const Text('Create')),
                const SizedBox(height: AppSpacing.md),
                const AuthOrDivider(label: 'or'),
                const SizedBox(height: AppSpacing.md),
                const AuthMessage(message: 'We sent the link again.'),
              ],
            ),
          ),
        );
        await tester.pump();
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });
    }
  }
}
