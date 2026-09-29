// D7 (round-2 review, ST-Y1) — THE SETTINGS SWITCH HAD NO VISIBLE OFF STATE.
//
// `_Toggle`'s off track was the literal `Color(0xFFE2E2EA)` in both schemes.
// On the white settings card that measures 1.3:1, and the off track is the ONE
// part that says "this is off" — WCAG 2.2 SC 1.4.11 owes it 3:1. It now reads
// `AppPalette.of(context).control` (ST-D0 D0-2), which is chosen to clear 3:1
// on the palette's surface.
//
// The ground is READ OFF THE TREE — the nearest opaque decoration above each
// switch — not assumed from the palette, so a card that changes colour under
// the switch is measured as it paints.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

import 'support/width_harness.dart';

const Color _sublySeed = Color(0xFF6459F5);

Future<void> _pumpSettings(WidgetTester tester, Brightness b) async {
  await tester.binding.setSurfaceSize(const Size(375, 3000));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    retry: (int retryCount, Object error) => null,
    overrides: defaultWidthOverrides(),
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        theme: buildAppTheme(seed: _sublySeed, brightness: b),
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const SettingsScreen(),
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

/// The colour of the nearest OPAQUE decoration above [of].
Color _groundOf(WidgetTester tester, Finder of) {
  for (final Element e
      in find
          .ancestor(of: of, matching: find.byType(DecoratedBox))
          .evaluate()) {
    final Decoration d = (e.widget as DecoratedBox).decoration;
    if (d is BoxDecoration && d.color != null && d.color!.a == 1) {
      return d.color!;
    }
  }
  return Theme.of(tester.element(of)).scaffoldBackgroundColor;
}

void main() {
  for (final Brightness b in Brightness.values) {
    testWidgets('an OFF settings switch shows its track at >= 3:1 on its card '
        '— ${b.name}', (WidgetTester tester) async {
      await _pumpSettings(tester, b);
      final Finder offSwitches = find.byWidgetPredicate(
        (Widget w) => w is FocusableTap && w.toggled == false,
      );
      // Not vacuous: the defaults leave at least one preference off.
      expect(offSwitches, findsWidgets);
      int measured = 0;
      for (final Element e in offSwitches.evaluate()) {
        final Finder one = find.byWidget(e.widget);
        final AnimatedContainer track = tester.widget<AnimatedContainer>(
          find.descendant(of: one, matching: find.byType(AnimatedContainer)),
        );
        final Color off = (track.decoration! as BoxDecoration).color!;
        final Color ground = _groundOf(tester, one);
        final double r = AppPalette.contrastRatio(off, ground);
        expect(
          r,
          greaterThanOrEqualTo(AppPalette.nonTextMinimum),
          reason: '${b.name}: off track $off on $ground = $r:1',
        );
        measured++;
      }
      expect(measured, greaterThan(0));
    });
  }
}
