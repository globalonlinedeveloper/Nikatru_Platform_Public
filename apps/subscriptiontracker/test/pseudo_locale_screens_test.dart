// ─────────────────────────────────────────────────────────────────────────────
// pseudo_locale_screens_test.dart — the main screens under the locale
// register's PSEUDO-LOCALES (tooling/i18n/locales.json `pseudo`).
//
//   en-XA  every string accented and ~40% longer than English: a layout that
//          only fits English (a fixed width, a Row with no Flexible) overflows
//          here before a real German, Tamil or Malayalam string finds it.
//   ar-XB  the same strings laid out RIGHT-TO-LEFT: the smoke test that the
//          screens build, scroll and paint mirrored with no exception — the
//          runtime half of assert-locale-register L8, which holds the source to
//          directional layout calls.
//
// Each case also proves its own premise: the screen's strings came from the
// pseudo catalogue (bracketed text is on screen), and ar-XB really resolved
// right-to-left. Without both, "no overflow" would be a statement about
// English.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_design_system/testing.dart';
import 'package:subscriptiontracker/features/calendar/calendar_screen.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/features/notifications/notifications_screen.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';

import 'support/pseudo_harness.dart';
import 'support/width_harness.dart';

/// The narrowest phone class the app supports, where an expanded label is most
/// likely to clip.
const Size kNarrowPhone = Size(360, 800);

final Map<String, Widget Function()> kMainScreens = <String, Widget Function()>{
  'home': () => const HomeScreen(),
  'insights': () => const InsightsScreen(),
  'calendar': () => const CalendarScreen(),
  'notifications': () => const NotificationsScreen(),
  'settings': () => const SettingsScreen(),
};

void main() {
  testWidgets('a chassis key read through the app\'s l10n is pseudo too', (
    WidgetTester tester,
  ) async {
    await pumpPseudo(tester, kPseudoLocales.first, const SettingsScreen());
    // `settingsTitle` is a CHASSIS key the app ARB no longer redeclares; the
    // forwarding extension must answer it from the pseudo catalogue, not from
    // English ChassisLocalizations.
    expect(find.textContaining('Šéţţîñĝš', findRichText: true), findsWidgets);
    expect(find.text('Settings'), findsNothing);
  });

  test('the register declares both pseudo-locales this file sweeps', () {
    expect(
      kPseudoLocales.map((PseudoLocale p) => p.locale),
      containsAll(<Locale>[const Locale('en', 'XA'), const Locale('ar', 'XB')]),
    );
  });

  for (final PseudoLocale pseudo in kPseudoLocales) {
    for (final MapEntry<String, Widget Function()> screen
        in kMainScreens.entries) {
      for (final Size size in <Size>[kNarrowPhone, kTablet]) {
        testWidgets('[${pseudo.locale.toLanguageTag()}] ${screen.key} at '
            '${size.width.toInt()}x${size.height.toInt()} — pseudo strings, '
            'the right direction, no overflow', (WidgetTester tester) async {
          final TextDirection direction = await pumpPseudo(
            tester,
            pseudo,
            screen.value(),
            size: size,
          );
          // FIRST: an overflow is an exception, and a later expect would
          // swallow the diagnosis.
          expect(tester.takeException(), isNull);
          expect(direction, pseudo.direction);
          expect(
            find.textContaining(kPseudoOpen, findRichText: true),
            findsWidgets,
            reason:
                'no pseudo string on screen: the catalogue was not reached, '
                'so this case measured English',
          );
        });
      }
    }
  }

  testWidgets('[en-XA] home at 360 and text 1.3 — no overflow', (
    WidgetTester tester,
  ) async {
    await pumpPseudo(
      tester,
      kPseudoLocales.first,
      const HomeScreen(),
      size: kNarrowPhone,
      textScale: 1.3,
    );
    expect(tester.takeException(), isNull);
  });
}
