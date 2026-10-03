// The app reads chassis keys through lib/l10n/chassis_bridge.g.dart (lane
// i18n-pipeline, ARB hygiene: the app ARB no longer re-declares 172 chassis
// keys). What a screen shows must be exactly the chassis string, in every
// supported locale — the bridge resolves by the app localizations' own locale.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/l10n/app_localizations_en.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';

void main() {
  // ⏱ 2026-10-03 · club-nits-b (#1161 nit 7b). RED before: the second subtag
  // of `localeName` was always read as a country, so `zh_Hant` asked the
  // chassis for country `Hant`.
  group('the bridge reads localeName subtags as gen-l10n writes them', () {
    Locale? asked;
    setUp(() {
      asked = null;
      ChassisBridge.lookup = (Locale locale) {
        asked = locale;
        return lookupChassisLocalizations(const Locale('en'));
      };
    });
    tearDown(() => ChassisBridge.lookup = lookupChassisLocalizations);

    void reads(String name, {String? script, String? country}) {
      test('$name -> script $script, country $country', () {
        AppLocalizationsEn(name).signIn;
        expect(asked?.languageCode, name.split('_').first);
        expect(asked?.scriptCode, script);
        expect(asked?.countryCode, country);
      });
    }

    reads('zh_Hant', script: 'Hant');
    reads('pt_BR', country: 'BR');
    reads('zh_Hant_TW', script: 'Hant', country: 'TW');
    reads('ta');
  });

  for (final RegisteredLocale row in kSupportedLocales) {
    test(
      '[${row.code}] a bridged key is the chassis string in that locale',
      () {
        final AppLocalizations app = lookupAppLocalizations(row.locale);
        final ChassisLocalizations chassis = lookupChassisLocalizations(
          row.locale,
        );
        expect(app.signIn, chassis.signIn);
        expect(app.legalAcceptTerms, chassis.legalAcceptTerms);
        expect(app.consentTitle('X'), chassis.consentTitle('X'));
        expect(app.authRetryAfterMinutes(5), chassis.authRetryAfterMinutes(5));
        if (row.code != kSourceLocaleCode) {
          // Not the English fallback: the translation is what arrives.
          expect(
            app.signIn,
            isNot(lookupChassisLocalizations(const Locale('en')).signIn),
          );
        }
      },
    );
  }
}
