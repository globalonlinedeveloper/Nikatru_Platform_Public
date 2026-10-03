// ─────────────────────────────────────────────────────────────────────────────
// PSEUDO-LOCALE SCREENS — the main screens under en-XA (every string ~40%
// longer and accented) and ar-XB (the same, laid out right to left).
//
// Lane i18n-pipeline. A layout is only ever proven in the languages somebody
// wrote a test for: 1 of the 19 width tests ran a non-English locale, and no
// test ran a right-to-left one. These pseudo locales stress every screen at
// once without a translator — and the next real language (German runs ~1.3x,
// Tamil already 1.27x) lands on screens that have already survived 1.4x.
//
// Each case asserts three things:
//   1. nothing overflows (an overflow is a framework exception, caught here);
//   2. the pseudo text is ON SCREEN — a floor of bracketed strings — so a pump
//      that silently fell back to English cannot pass as "no overflow";
//   3. under ar-XB the screen really is right to left.
// The locale rows come from tooling/i18n/locales.json (`kPseudoLocales`).
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_design_system/testing/pseudo_locale.dart';
import 'package:subscriptiontracker/features/calendar/calendar_screen.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/features/notifications/notifications_screen.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';

import 'support/width_harness.dart';

/// The app's strings, pseudo-localised from app_en.arb.
class _PseudoApp extends PseudoMessages implements AppLocalizations {
  _PseudoApp(super.arb, super.pseudo);
}

Map<String, dynamic> _readArb(String path) =>
    jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;

/// A pseudo string on screen: bracketed, optionally inside RTL marks.
final RegExp _pseudo = RegExp(r'^‏?\[.*\]‏?$', dotAll: true);

/// Every string a Text or RichText on screen paints.
List<String> _paintedStrings(WidgetTester tester) => <String>[
  for (final Text t in tester.widgetList<Text>(find.byType(Text)))
    if (t.data != null)
      t.data!
    else if (t.textSpan != null)
      t.textSpan!.toPlainText(),
];

void main() {
  late Map<String, dynamic> appArb;
  late Map<String, dynamic> chassisArb;
  setUpAll(() {
    appArb = _readArb('lib/l10n/app_en.arb');
    chassisArb = _readArb(
      '../../packages/design_system/lib/src/l10n/chassis_en.arb',
    );
  });

  List<LocalizationsDelegate<dynamic>> delegates(RegisteredLocale row) =>
      <LocalizationsDelegate<dynamic>>[
        PseudoDelegate<AppLocalizations>(() => _PseudoApp(appArb, row)),
        PseudoDelegate<ChassisLocalizations>(
          () => PseudoChassisLocalizations(chassisArb, row),
        ),
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ];

  // (name, screen, the floor of pseudo strings it must paint at 375 px)
  final List<(String, Widget, int)> screens = <(String, Widget, int)>[
    ('Home', const HomeScreen(), 3),
    ('Settings', const SettingsScreen(), 8),
    ('Insights', const InsightsScreen(), 3),
    ('Calendar', const CalendarScreen(), 2),
    ('Notifications', const NotificationsScreen(), 2),
  ];

  test('both pseudo locales are declared in the register', () {
    expect(
      kPseudoLocales.map((RegisteredLocale r) => r.code),
      containsAll(<String>['en-XA', 'ar-XB']),
    );
  });

  for (final RegisteredLocale row in kPseudoLocales) {
    for (final (String name, Widget screen, int floor) in screens) {
      testWidgets('[${row.code}] $name at 375 px: no overflow, pseudo text on '
          'screen${row.rtl ? ', laid out right to left' : ''}', (
        WidgetTester tester,
      ) async {
        // The app reads chassis keys through ChassisBridge, which looks them up
        // by locale; a pseudo locale has no real lookup, so point it at the
        // pseudo chassis for this case.
        ChassisBridge.lookup = (_) =>
            PseudoChassisLocalizations(chassisArb, row);
        addTearDown(() => ChassisBridge.lookup = lookupChassisLocalizations);
        await pumpAt(
          tester,
          kPhone,
          screen,
          locale: row.locale,
          localizationsDelegates: delegates(row),
        );
        expect(
          tester.takeException(),
          isNull,
          reason: '$name overflowed or threw under ${row.code}',
        );

        final List<String> painted = _paintedStrings(tester);
        final int pseudo = painted.where(_pseudo.hasMatch).length;
        expect(
          pseudo,
          greaterThanOrEqualTo(floor),
          reason:
              '$name painted $pseudo pseudo string(s) under ${row.code}; a '
              'floor of $floor proves the pseudo delegates were the ones read',
        );

        final BuildContext ctx = tester.element(find.byWidget(screen));
        expect(
          Directionality.of(ctx),
          row.rtl ? TextDirection.rtl : TextDirection.ltr,
        );
      });
    }
  }
}
