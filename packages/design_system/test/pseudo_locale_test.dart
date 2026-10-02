// The pseudo-locale engine (lib/testing/pseudo_locale.dart) and the RTL
// mirroring it exists to expose. Lane i18n-pipeline.
//
// The engine is what every app's pseudo-locale screen test stands on, so it is
// proven here against the REAL chassis ARB: if it rendered placeholders wrong,
// or a plural arm the generated class would not pick, every screen test built
// on it would measure a string no locale produces.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_design_system/src/widgets/destructive_confirm_dialog.dart';
import 'package:nikatru_design_system/src/widgets/destructive_outcome_notice.dart';
import 'package:nikatru_design_system/testing/pseudo_locale.dart';

void main() {
  late Map<String, dynamic> arb;
  setUpAll(() {
    arb =
        jsonDecode(File('lib/src/l10n/chassis_en.arb').readAsStringSync())
            as Map<String, dynamic>;
  });

  group('the register declares the two pseudo locales', () {
    test('en-XA is left to right, ar-XB right to left, and neither ships', () {
      expect(pseudoRow('en-XA').rtl, isFalse);
      expect(pseudoRow('ar-XB').rtl, isTrue);
      expect(pseudoLocale('ar-XB'), const Locale('ar', 'XB'));
      for (final RegisteredLocale r in kPseudoLocales) {
        expect(r.supported, isFalse, reason: '${r.code} would reach a picker');
        expect(kSupportedLocaleCodes, isNot(contains(r.code)));
      }
    });
  });

  group(
    'PseudoChassisLocalizations answers the generated class from the ARB',
    () {
      late ChassisLocalizations l;
      setUp(() => l = PseudoChassisLocalizations(arb, pseudoRow('en-XA')));

      test('a getter is accented, bracketed and about 40% longer', () {
        final String s = l.signInTitle;
        expect(s, startsWith('[Šîĝñ îñ '));
        expect(s, endsWith(']'));
        expect(
          s.length,
          greaterThanOrEqualTo((arb['signInTitle'] as String).length * 1.4),
        );
      });

      test('a plural picks the arm gen-l10n would, with the value in it', () {
        expect(l.authRetryAfterMinutes(1), contains('1 ɱîñûţé.'));
        expect(l.authRetryAfterMinutes(5), contains('5 ɱîñûţéš.'));
      });

      test('a select and plain placeholders keep declared order', () {
        final String s = l.paywallTermWithTrial('month', 7, 'week');
        expect(
          s,
          contains('month'),
          reason: 'a placeholder value is not accented',
        );
        expect(s, contains('7-ŵééķ'));
      });

      test(
        'an unknown member is still an error, not a silent empty string',
        () {
          expect(
            () => (l as dynamic).noSuchKeyAnywhere,
            throwsNoSuchMethodError,
          );
        },
      );

      test('ar-XB wraps each string in right-to-left marks', () {
        final ChassisLocalizations rtl = PseudoChassisLocalizations(
          arb,
          pseudoRow('ar-XB'),
        );
        expect(rtl.signInTitle, startsWith('‏['));
      });
    },
  );

  group('RTL: a directional layout mirrors under ar-XB', () {
    Future<double> dismissX(WidgetTester tester, String code) async {
      await tester.pumpWidget(
        MaterialApp(
          locale: pseudoLocale(code),
          supportedLocales: <Locale>[pseudoLocale(code)],
          localizationsDelegates: <LocalizationsDelegate<dynamic>>[
            PseudoDelegate<ChassisLocalizations>(
              () => PseudoChassisLocalizations(arb, pseudoRow(code)),
            ),
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: Scaffold(
            body: DestructiveOutcomeNotice(
              report: const DestructiveActionReport(
                message: 'Done.',
                succeeded: true,
              ),
              dismissLabel: 'Dismiss',
              onDismiss: () {},
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      return tester.getCenter(find.byType(TextButton)).dx;
    }

    testWidgets('the dismiss button sits at the END: right in en-XA, left in '
        'ar-XB', (WidgetTester tester) async {
      final double ltr = await dismissX(tester, 'en-XA');
      final double rtl = await dismissX(tester, 'ar-XB');
      final double mid =
          tester.view.physicalSize.width / tester.view.devicePixelRatio / 2;
      expect(ltr, greaterThan(mid));
      expect(
        rtl,
        lessThan(mid),
        reason: 'Alignment.centerRight would not move',
      );
    });
  });
}
