// The app reads chassis keys through lib/l10n/chassis_bridge.g.dart (lane
// i18n-pipeline, ARB hygiene: the app ARB no longer re-declares 172 chassis
// keys). What a screen shows must be exactly the chassis string, in every
// supported locale — the bridge resolves by the app localizations' own locale.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';

void main() {
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
