// ─────────────────────────────────────────────────────────────────────────────
// THE CC BY ATTRIBUTION CONDITION, AND THE ONE TAP THAT DISCHARGES IT — SUBLY.
//
// 🔴 THE GAP THIS FILE CLOSES. `registerVendoredAssetLicences()` registers the
// CC BY 4.0 notice for the vendored MaterialIcons font, which ships in the
// bundle but arrives from the SDK artifact cache rather than as a Dart package,
// so Flutter's NOTICES collector never sees it. `apps/subly/lib/main.dart` calls
// it — and until this file, NOTHING in the tree asserted that it does.
//
//   · The BRICK is guarded: `tooling/bricks/app/__brick__/apps/{{app_id}}/test/
//     asset_licences_surface_test.dart` is the file this one is ported from, and
//     CI runs it on the stamped probe. Subly is not stamped from that probe.
//   · The REGISTER cannot see it either: `tooling/ci/assert-licence-register.mjs`
//     discharges the `attributionRequired: true` row for `flutter-material-icons`
//     with `existsSync(attributedIn)`, and `attributedIn` is
//     `packages/design_system/lib/src/licences/vendored_asset_licences.dart` —
//     the IMPLEMENTATION, which exists whether or not anybody calls it.
//   · The PACKAGE's own unit test likewise passes with zero callers.
//
// So before this file, deleting one line from `apps/subly/lib/main.dart` put the
// only app in the field in breach of CC BY 4.0 with every guard still green.
// That is not hypothetical: it is exactly what had happened to the brick, fixed
// in PR #470 — implemented, exported and unit-tested in the package while the
// template never called it.
//
// ⚠️ WHY THE FIRST GROUP READS SOURCE INSTEAD OF RUNNING THE BOOT. Subly's
// `main()` initialises telemetry, two notification plugins and (when configured)
// the Supabase SDK before it reaches `runApp`; a widget test cannot run it, and
// a test that called `registerVendoredAssetLicences()` itself and then asserted
// the registry would be asserting about the TEST, not about the app. The
// property that actually matters — "this app's own entry point performs the
// registration, before the first frame" — is a property of `lib/main.dart`, so
// that is what is measured. `flutter test` runs with the package root as its
// working directory, the same idiom `chassis_properties_test.dart` uses for its
// router scan.
//
// ⚠️ THE COMMENT STRIPPING, AND HOW IT DIFFERS FROM THE BRICK'S. In the brick,
// stripping IS the assertion: its call site is introduced by prose that names
// the function twice, so an unstripped `contains` is satisfied by the comment
// alone. Measured in Subly today (2026-09-05), that is NOT true here — the only
// occurrence of the name in `apps/subly/lib/main.dart` is the live call on line
// 32, and the only occurrence of `runApp(` is the real one. The stripping is
// carried over anyway, because the difference is one paragraph away: the call
// site already carries eight lines of prose about it, and the day somebody
// writes the function's name into that paragraph, a raw `contains` silently
// stops being able to fail. It costs nothing to be right in advance.
//
// ⚠️ WHAT WAS ADAPTED FROM THE BRICK, NOT COPIED.
//   · Imports are `package:subly/...`; the brick's are `{{app_id.snakeCase()}}`.
//   · The storage and notification seams come from `test/support/width_harness.dart`
//     rather than a local fake. Subly's settings screen drives its OWN
//     notification fork through `sublyNotificationServiceProvider` — a seam the
//     brick's screen has no equivalent of — so the brick's single
//     `keyValueStoreProvider` override would leave the real plugin-backed
//     service in place and the screen would never reach its layout.
//   · Every brick case is carried over; none was dropped.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subly/features/settings/settings_screen.dart';
import 'package:subly/l10n/app_localizations.dart';

import 'support/width_harness.dart';

/// Remove `//` and `/* */` comments so a mention in prose cannot stand in for a
/// call. String literals are left alone: nothing in `main.dart` puts either of
/// the two names below inside a string, and blanking literals would need a
/// parser to do safely.
String _stripComments(String src) {
  final String noBlocks = src.replaceAll(
    RegExp(r'/\*.*?\*/', dotAll: true),
    ' ',
  );
  return noBlocks
      .split('\n')
      .map((String line) {
        final int i = line.indexOf('//');
        return i == -1 ? line : line.substring(0, i);
      })
      .join('\n');
}

void main() {
  group('the boot half — the registration the licence condition needs', () {
    late String source;

    setUpAll(() {
      final File f = File('lib/main.dart');
      if (!f.existsSync()) {
        fail(
          'lib/main.dart not found from ${Directory.current.path} — every '
          'assertion in this group would range over an empty string and pass '
          'for the wrong reason',
        );
      }
      source = _stripComments(f.readAsStringSync());
    });

    test('main.dart calls registerVendoredAssetLicences()', () {
      expect(
        source.contains('registerVendoredAssetLicences()'),
        isTrue,
        reason:
            'the vendored MaterialIcons font ships in the bundle but is '
            'invisible to Flutter\'s NOTICES collector, so without this call '
            'Subly distributes a CC BY 4.0 asset with its attribution '
            'condition unmet — and an unmet condition means the licence does '
            'not apply to the copy that was distributed. The shared '
            'implementation already exists in packages/design_system, and its '
            'own unit test passes with nobody calling it; only the call site '
            'is load-bearing, and only this case measures it.',
      );
    });

    test('it happens BEFORE runApp, not after the first frame', () {
      final int register = source.indexOf('registerVendoredAssetLicences()');
      final int run = source.indexOf('runApp(');
      // PRECONDITION, and the reason this is not a tautology: if `runApp(`
      // could not be found the comparison below would be `n < -1`, i.e. always
      // false — red for the wrong reason — or, with the operands the other way
      // round, always true. Name it instead.
      expect(
        run,
        greaterThan(-1),
        reason:
            'no runApp( in lib/main.dart — the ordering assertion below has '
            'nothing to order against',
      );
      expect(
        register,
        greaterThan(-1),
        reason:
            'covered by the case above; repeated so this one cannot pass '
            'on an absent call',
      );
      expect(
        register,
        lessThan(run),
        reason:
            'LicenseRegistry is read LAZILY by LicensePage. A registration '
            'that lands after a user has already opened the licences screen '
            'shows them an incomplete list, which is the same breach with an '
            'extra step.',
      );
    });
  });

  group('the settings half — one tap to the notices', () {
    /// The REAL settings screen, pumped TALL: settings is a `ListView` and the
    /// licences card sits below the support card at the very bottom, so on the
    /// default 800×600 surface it has no element at all and `findsOneWidget`
    /// would fail for a reason that has nothing to do with the row existing.
    ///
    /// The overrides are [defaultWidthOverrides] — the two platform-channel
    /// seams (storage, notifications) that any test hosting this screen needs.
    /// Nothing else is faked: the licences row reads no state.
    Future<void> pumpSettings(WidgetTester tester) async {
      await setSurface(tester, const Size(1200, 4000));
      final ProviderContainer c = ProviderContainer(
        overrides: defaultWidthOverrides(),
      );
      addTearDown(c.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: SettingsScreen(),
          ),
        ),
      );
      // Several provider futures resolve in sequence; `pumpAndSettle` would be
      // a lie about why we are waiting, and a bare `pump()` advances no timers
      // — which is what keeps this loop honest about what it is waiting for.
      for (int i = 0; i < 12; i++) {
        await tester.pump();
      }
    }

    testWidgets('the row is on the screen and its label is localized', (
      WidgetTester tester,
    ) async {
      await pumpSettings(tester);
      final BuildContext ctx = tester.element(find.byType(SettingsScreen));
      final AppLocalizations l10n = AppLocalizations.of(ctx);
      expect(
        find.text(l10n.openSourceLicences),
        findsOneWidget,
        reason:
            'the label is read through AppLocalizations rather than matched as '
            'an English literal, so this case also proves the arb key exists '
            'in both locales instead of only in the tree the author speaks',
      );
    });

    testWidgets('tapping it opens the licences page — one tap, not two', (
      WidgetTester tester,
    ) async {
      await pumpSettings(tester);
      final BuildContext ctx = tester.element(find.byType(SettingsScreen));
      final AppLocalizations l10n = AppLocalizations.of(ctx);

      // PRECONDITION: nothing is showing yet, so the expectation after the tap
      // cannot be satisfied by a page that was already there.
      expect(find.byType(LicensePage), findsNothing);

      await tester.tap(find.text(l10n.openSourceLicences));
      await tester.pumpAndSettle();

      expect(
        find.byType(LicensePage),
        findsOneWidget,
        reason:
            'a row that navigates nowhere looks exactly like a working one. '
            'The About tile beside it reaches the same page through the '
            'framework\'s own "View licenses" button — two taps, behind a '
            'dialog — which is why this row is not redundant with it.',
      );
    });
  });
}
