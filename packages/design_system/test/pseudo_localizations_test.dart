// ─────────────────────────────────────────────────────────────────────────────
// pseudo_localizations_test.dart — the register's pseudo-locales (en-XA:
// accented, +40%; ar-XB: right-to-left) as `package:nikatru_design_system/
// testing.dart` provides them to every app's widget tests.
//
// The catalogue is the REAL chassis_en.arb answered through noSuchMethod, so
// these cases prove the three things a pseudo-locale test silently depends on:
// the delegate is reached (strings come back bracketed), ICU still formats
// (plural `=1`, select arms, placeholders in declared order), and ar-XB really
// lays out right-to-left.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_design_system/testing.dart';

final PseudoLocale kXA = kPseudoLocales.firstWhere(
  (PseudoLocale p) => p.countryCode == 'XA',
);
final PseudoLocale kXB = kPseudoLocales.firstWhere(
  (PseudoLocale p) => p.countryCode == 'XB',
);

Map<String, dynamic> _chassisArb() {
  final File f = File('lib/src/l10n/chassis_en.arb');
  expect(f.existsSync(), isTrue, reason: 'run from packages/design_system');
  return jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
}

void main() {
  test(
    'the register carries both pseudo-locales, one of them right-to-left',
    () {
      expect(kXA.locale, const Locale('en', 'XA'));
      expect(kXB.locale, const Locale('ar', 'XB'));
      expect(kXA.direction, TextDirection.ltr);
      expect(kXB.direction, TextDirection.rtl);
      expect(kXA.expansion, greaterThanOrEqualTo(0.3));
      expect(pseudoLocaleOf(const Locale('en')), isNull);
      expect(pseudoLocaleOf(const Locale('ta')), isNull);
    },
  );

  test('pseudoText is accented, bracketed and at least `expansion` longer', () {
    const String s = 'Settings';
    final String p = pseudoText(s, kXA);
    expect(p, startsWith('$kPseudoOpenŠéţţîñĝš'));
    expect(p, endsWith(kPseudoClose));
    expect(p.length, greaterThanOrEqualTo((s.length * 1.4).ceil()));
    final String r = pseudoText(s, kXB);
    expect(r, startsWith('\u202B'));
    expect(r, endsWith('\u202C'));
  });

  test('formatIcu: placeholders, plural =1/other with #, select arms', () {
    expect(
      formatIcu('Welcome to {appName}', <String, Object?>{'appName': 'X'}),
      'Welcome to X',
    );
    const String plural =
        '{count, plural, =1{in 1 minute.} other{in {count} minutes.}}';
    expect(formatIcu(plural, <String, Object?>{'count': 1}), 'in 1 minute.');
    expect(formatIcu(plural, <String, Object?>{'count': 5}), 'in 5 minutes.');
    expect(
      formatIcu('{n, plural, one{# item} other{# items}}', <String, Object?>{
        'n': 3,
      }),
      '3 items',
    );
    const String select =
        '{count}-{unit, select, week{week} month{month} other{day}}';
    expect(
      formatIcu(select, <String, Object?>{'count': 7, 'unit': 'week'}),
      '7-week',
    );
    expect(
      formatIcu(select, <String, Object?>{'count': 3, 'unit': 'zz'}),
      '3-day',
    );
  });

  test('the REAL chassis catalogue answers through noSuchMethod, typed', () {
    final ChassisLocalizations l = PseudoChassisLocalizations(
      _chassisArb(),
      kXA,
    );
    expect(l.localeName, 'en');
    expect(l.settingsTitle, pseudoText('Settings', kXA));
    expect(l.welcomeTo('Probe'), contains('Þŕöƀé'));
    expect(l.authRetryAfterMinutes(1), contains('1 ɱîñûţé.'));
    expect(l.authRetryAfterMinutes(4), contains('4 ɱîñûţéš.'));
    // Positional arguments map to the DECLARED placeholders, in order.
    expect(l.paywallTermWithTrial('month', 7, 'day'), contains('7-ðáý'));
    expect(l.paywallTermWithTrial('month', 7, 'day'), contains('ɱöñţĥ'));
  });

  testWidgets('ar-XB lays a screen out RIGHT-TO-LEFT; en-XA left-to-right', (
    WidgetTester tester,
  ) async {
    final Map<String, dynamic> arb = _chassisArb();
    for (final PseudoLocale p in kPseudoLocales) {
      late TextDirection seen;
      await tester.pumpWidget(
        MaterialApp(
          locale: p.locale,
          supportedLocales: <Locale>[
            for (final PseudoLocale q in kPseudoLocales) q.locale,
            ...ChassisLocalizations.supportedLocales,
          ],
          localizationsDelegates: <LocalizationsDelegate<dynamic>>[
            PseudoLocalizationsDelegate<ChassisLocalizations>(
              (PseudoLocale q) => PseudoChassisLocalizations(arb, q),
            ),
            ...GlobalMaterialLocalizations.delegates,
          ],
          home: Builder(
            builder: (BuildContext context) {
              seen = Directionality.of(context);
              return Scaffold(body: Text(context.chassisL10n.settingsTitle));
            },
          ),
        ),
      );
      expect(seen, p.direction, reason: p.name);
      expect(find.textContaining(kPseudoOpen), findsOneWidget, reason: p.name);
    }
  });
}
