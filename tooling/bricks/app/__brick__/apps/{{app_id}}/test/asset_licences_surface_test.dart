// ─────────────────────────────────────────────────────────────────────────────
// THE CC BY ATTRIBUTION CONDITION, AND THE ONE TAP THAT DISCHARGES IT.
//
// 🔴 THE DEFECT THIS FILE IS BORN AGAINST. `registerVendoredAssetLicences()`
// has lived in `packages/design_system` — implemented, exported and unit
// tested — since [pipeline K-10]. The BRICK never called it. So the one
// shipping app was compliant and every app this factory stamps shipped the
// vendored CC BY 4.0 Material Icons font with its attribution condition UNMET,
// which is not untidiness: an unmet CC BY condition means the licence does not
// apply to the copy you distributed. It is a breach at the first store
// submission, and nothing in the tree could see it — the package's own tests
// pass whether or not anybody calls the function.
//
// ⚠️ WHY THE FIRST GROUP READS SOURCE INSTEAD OF RUNNING THE BOOT. `main()`
// initialises telemetry, the notification plugin and (when configured) the
// Supabase SDK before it reaches `runApp`; a widget test cannot run it, and a
// test that called `registerVendoredAssetLicences()` itself and then asserted
// the registry would be asserting about the TEST, not about the app. The
// property that actually matters — "the app's own entry point performs the
// registration, before the first frame" — is a property of `lib/main.dart`, so
// that is what is measured. Reading it off disk works in a stamped app exactly
// as it does here: `flutter test` runs with the package root as its working
// directory (same idiom as `chassis_properties_test.dart`'s router scan).
//
// ⚠️ AND THE COMMENT STRIPPING IS THE ASSERTION, not hygiene. The call site in
// `main.dart` is introduced by a paragraph of prose that names the function
// twice. A raw `contains` is satisfied by the prose alone — delete the live
// line, keep the comment, and an unstripped version of this file still prints
// green. That is the prose-grep false green this repository has a scar about.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:{{app_id.snakeCase()}}/features/settings/settings_screen.dart';
import 'package:{{app_id.snakeCase()}}/l10n/app_localizations.dart';
import 'package:{{app_id.snakeCase()}}/state/providers.dart';

/// In-memory storage seam — `PrefsKeyValueStore` needs a platform channel that
/// does not exist in a widget test. Same shape as `responsive_width_test`'s.
class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

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
            'every stamped app distributes a CC BY 4.0 asset with its '
            'attribution condition unmet — and an unmet condition means the '
            'licence does not apply. The shared implementation already exists '
            'in packages/design_system; only the call was missing.',
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
    /// The REAL settings screen, pumped TALL: settings is a `ListView`, and the
    /// licences row sits at the very bottom, so on the default 800×600 surface
    /// it has no element at all and `findsOneWidget` would fail for a reason
    /// that has nothing to do with the row existing.
    Future<void> pumpSettings(WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(1200, 4000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => _MemStore()),
        ],
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
      // a lie about why we are waiting.
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
            'The About dialog below it reaches the same page through the '
            'framework\'s own button — two taps, behind a dialog — which is '
            'why this row is not redundant with it.',
      );
    });
  });
}
