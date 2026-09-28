// ─────────────────────────────────────────────────────────────────────────────
// THE ADD / EDIT SHEET, PIXEL FOR PIXEL — train ST-D6.
//
// Both screens the sheet is — ADD (empty, with the POPULAR shortcuts) and EDIT
// (populated from a row) — photographed at one window per class (compact,
// medium, expanded, large; the sizes ST-D0's foundation goldens use), in light
// and in dark. Sixteen goldens under `test/goldens/`.
//
// The add form's default renewal date is "one cycle from today", so the sheet
// is given a FIXED clock here (`SubscriptionFormSheet.now`); without it the
// golden would change every day.
//
// Regenerate, after a DELIBERATE visual change only, from the repo root:
//   flutter test --update-goldens apps/subscriptiontracker/test/add_edit_golden_test.dart
// and review every PNG in the diff before committing it: a golden that is
// regenerated to make a red test green asserts nothing.
//
// ⚠️ LINUX ONLY — the renderer statement `foundation_golden_test.dart` makes:
// the goldens are drawn with the test font on the CI runners' platform, and
// glyph anti-aliasing differs on macOS and Windows by a few pixels.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

import 'support/width_harness.dart';

const Color kSublySeed = Color(0xFF6459F5);

DateTime _today() => DateTime(2026, 9, 28);

Subscription _row() => Subscription(
  id: 'sub-1',
  name: 'Netflix',
  category: 'Streaming',
  price: const Money(1549, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2026, 10, 12),
);

Future<void> _pump(
  WidgetTester tester,
  Size size,
  Brightness brightness, {
  required bool edit,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: defaultWidthOverrides(),
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: kSublySeed, brightness: brightness),
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => Center(
              child: TextButton(
                onPressed: () => showAppFormSheet<void>(
                  context,
                  builder: (_) => SubscriptionFormSheet(
                    editing: edit ? _row() : null,
                    now: _today,
                  ),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  const Map<String, Size> classes = <String, Size>{
    'compact': Size(390, 844),
    'medium': Size(700, 1000),
    'expanded': Size(1024, 900),
    'large': Size(1440, 900),
  };

  test('each photographed size is the class it is named for', () {
    expect(windowClassFor(classes['compact']!.width), WindowClass.compact);
    expect(windowClassFor(classes['medium']!.width), WindowClass.medium);
    expect(windowClassFor(classes['expanded']!.width), WindowClass.expanded);
    expect(windowClassFor(classes['large']!.width), WindowClass.large);
  });

  for (final String screen in <String>['add', 'edit']) {
    for (final MapEntry<String, Size> c in classes.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('$screen sheet · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          await _pump(tester, c.value, b, edit: screen == 'edit');
          expect(tester.takeException(), isNull);
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/${screen}_sheet_${c.key}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  }
}
