// ─────────────────────────────────────────────────────────────────────────────
// a11y_form_sheet_test.dart — the accessibility sweep for the chassis FORM
// SHEET components (train ST-D6): `AppFormSheet`, `AppFormField`,
// `AppSegmentedChoice` and `AppFormActions`, both schemes, resting and with a
// field in error.
//
// Named `a11y_*_test.dart` on purpose: `assert-a11y-coverage.mjs` reads a
// corpus of exactly that shape, and credits a sweep to a surface only when the
// surface is CONSTRUCTED and the guideline CALLED in one `testWidgets` body.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  for (final Brightness b in Brightness.values) {
    for (final bool inError in <bool>[false, true]) {
      testWidgets(
        'AppFormSheet + AppFormField + AppSegmentedChoice + AppFormActions, '
        '${b.name}${inError ? ', a field in error' : ''}',
        (WidgetTester tester) async {
          final SemanticsHandle handle = tester.ensureSemantics();
          await tester.binding.setSurfaceSize(const Size(375, 812));
          addTearDown(() => tester.binding.setSurfaceSize(null));
          await tester.pumpWidget(
            MaterialApp(
              theme: buildAppTheme(
                seed: const Color(0xFF6459F5),
                brightness: b,
              ),
              home: Scaffold(
                body: Align(
                  alignment: Alignment.bottomCenter,
                  child: Builder(
                    builder: (BuildContext context) => AppFormSheet(
                      title: 'Edit subscription',
                      onSubmit: () {},
                      banner: DecisionStrip(
                        kind: StatusKind.warn,
                        message: 'You are offline.',
                      ),
                      actions: AppFormActions(
                        cancelLabel: 'Cancel',
                        onCancel: () {},
                        submitLabel: 'Save changes',
                        onSubmit: () {},
                      ),
                      children: <Widget>[
                        AppFormField(
                          label: 'NAME',
                          child: TextField(
                            style: AppFieldDecoration.valueStyle(context),
                            decoration: AppFieldDecoration.of(
                              context,
                              hint: 'e.g. Hulu',
                              errorText: inError ? 'Enter a name.' : null,
                            ),
                          ),
                        ),
                        AppFormField(
                          label: 'CYCLE',
                          child: AppSegmentedChoice<int>(
                            choices: const <AppChoice<int>>[
                              AppChoice<int>(value: 0, label: 'Monthly'),
                              AppChoice<int>(value: 1, label: 'Yearly'),
                            ],
                            selected: 0,
                            onChanged: (_) {},
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          handle.dispose();
        },
      );
    }
  }
}
