// ─────────────────────────────────────────────────────────────────────────────
// T20 · XP-06 — Hindi, the third locale: the app speaks it, money groups in
// lakhs and crores, dates follow it, the picker offers it, and Home holds it at
// 200 % text on a narrow phone.
//
// 🔴 THE RED CONTROL is two-handed: `l10n_parity_test.dart` (and the chassis
// one) now range over every translation and assert the three locale files
// exist, and the Home case below asserts the Hindi words on screen with no
// overflow. Before this train there was no `app_hi.arb`, so `hi` resolved to
// English and every case here failed.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/st_polish_harness.dart';

void main() {
  test('hi is a supported locale of the app AND of the chassis', () {
    expect(
      AppLocalizations.supportedLocales.map((Locale l) => l.languageCode),
      contains('hi'),
    );
    expect(
      ChassisLocalizations.supportedLocales.map((Locale l) => l.languageCode),
      contains('hi'),
    );
    expect(
      GlobalMaterialLocalizations.delegate.isSupported(const Locale('hi')),
      isTrue,
      reason: 'Material itself must speak Hindi, or its own chrome is English',
    );
  });

  testWidgets('money groups in lakhs and crores, and dates are written in '
      'Hindi, under the Hindi locale', (WidgetTester tester) async {
    await pumpPolish(tester, const SizedBox(), locale: const Locale('hi'));
    final AppLocalizations l10n = l10nOf(tester);
    expect(l10n.localeName, 'hi');
    final core.MoneyFormatter money = core.MoneyFormatter(l10n.localeName);
    expect(
      money.format(const core.Money(1234567800, 'INR')),
      contains('1,23,45,678'),
      reason: 'Indian grouping: 1,23,45,678, never 12,345,678',
    );
    final DateTime d = DateTime(2026, 10, 14);
    expect(
      DateFormat.yMMMd(l10n.localeName).format(d),
      isNot(DateFormat.yMMMd('en').format(d)),
      reason: 'a Hindi date is not the English one',
    );
  });

  testWidgets('🔴 Home in Hindi at 200 % on a 360 px phone: Hindi on screen, '
      'no English left over, nothing overflows', (WidgetTester tester) async {
    await pumpPolish(
      tester,
      const HomeScreen(),
      locale: const Locale('hi'),
      textScale: 2,
      size: const Size(360, 3200),
    );
    final AppLocalizations hi = l10nOf(tester);
    final AppLocalizations en = lookupAppLocalizations(const Locale('en'));
    expect(find.text(hi.allSubscriptions), findsOneWidget);
    expect(find.text(en.allSubscriptions), findsNothing);
    expect(find.text(hi.upcomingRenewals), findsOneWidget);
    expect(
      tester.takeException(),
      isNull,
      reason: 'a RenderFlex overflow is thrown as an exception here',
    );
  });

  testWidgets('the language picker offers हिन्दी and choosing it switches the '
      'app to Hindi', (WidgetTester tester) async {
    final ProviderContainer c = await pumpPolish(
      tester,
      const SettingsScreen(),
      size: const Size(800, 3000),
    );
    final Finder hindi = find.text('हिन्दी');
    expect(hindi, findsOneWidget);
    await tester.ensureVisible(hindi);
    await tester.tap(hindi);
    await settle(tester);
    expect(c.read(localeProvider), const Locale('hi'));
  });
}
