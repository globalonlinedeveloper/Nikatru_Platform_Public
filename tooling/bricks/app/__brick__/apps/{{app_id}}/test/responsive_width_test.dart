// ─────────────────────────────────────────────────────────────────────────────
// RESPONSIVE WIDTH — the three screens that had NO width decision at all.
//
// Onboarding was `Padding(symmetric horizontal: 32)`; settings and manage-plan
// were a bare `Scaffold` + `ListView`. None of the three overflowed, none of
// them clipped, and none of them failed a single existing assertion — because
// "the content grew to fill a 1920 px display" is a defect with no exception,
// no red pixel and no error line. It is only visible to a MEASUREMENT, which is
// what this file is.
//
// 🔴 WHY THE ASSERTION IS ON `constraints`, NOT ON `size`.
// A `Column` of centred text SHRINK-WRAPS: at 1280 px unconstrained it reports
// the width of its longest line — about 260 px for the chassis's default
// onboarding copy — so `getSize(...).width <= 720` would PASS with the cap
// deleted, and go on passing until somebody shipped a longer sentence. The
// property under test is what width the content was OFFERED, and that is the
// child's incoming `BoxConstraints.maxWidth`. It is the same number whatever
// the copy says, so this file cannot be quietly disarmed by editing an .arb.
//
// ⚠️ EVERY CASE PINS THE SURFACE — `tester.binding.setSurfaceSize` with an
// `addTearDown(null)`, which is the chassis idiom (see
// `packages/design_system/test/content_pane_test.dart`). flutter_test's default
// surface is 800×600, and 800 resolves to `medium`, i.e. a RAIL — so an
// unpinned width test measures a layout nobody asked about. Never leave a case
// unpinned here.
//
// ⚠️ AND THE DESKTOP CASE FOR A `kMaxBodyWidth` SCREEN IS 1920, NOT 1280.
// The default `ContentPane` cap IS 1280, so `contentWidth <= 1280` measured on
// a 1280 px surface is true whether or not the pane is there — an assertion
// that cannot fail, which this repo treats as worse than no assertion at all.
// The 1280 case below is kept because it is the ordinary desktop window and it
// pins the no-op behaviour; the case that can actually go red is 1920.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:{{app_id.snakeCase()}}/features/firstrun/onboarding_screen.dart';
import 'package:{{app_id.snakeCase()}}/features/monetization/manage_plan_screen.dart';
import 'package:{{app_id.snakeCase()}}/features/settings/settings_screen.dart';
import 'package:{{app_id.snakeCase()}}/l10n/app_localizations.dart';
import 'package:{{app_id.snakeCase()}}/state/providers.dart';

/// In-memory storage seam — `PrefsKeyValueStore` needs a platform channel that
/// does not exist in a widget test. Same shape as `chassis_properties_test`'s.
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

/// The phone, the small tablet and the ordinary desktop window. Named so a
/// failure says WHICH window class was being measured rather than a bare pair
/// of numbers.
const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 900);

/// Wider than every cap in [AppBreakpoints], so a screen capped at
/// [AppBreakpoints.kMaxBodyWidth] has a surface its cap can be distinguished
/// from. See the header.
const Size kWide = Size(1920, 1080);

void main() {
  ProviderContainer container() => ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((_) async => _MemStore()),
    ],
  );

  /// One screen, on its own `MaterialApp`. No router: none of these three
  /// properties is about navigation, and a router would drag the redirect
  /// guards in with it.
  Widget host(ProviderContainer c, Widget screen) => UncontrolledProviderScope(
    container: c,
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: screen,
    ),
  );

  Future<void> pumpAt(WidgetTester tester, Size size, Widget screen) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final ProviderContainer c = container();
    addTearDown(c.dispose);
    await tester.pumpWidget(host(c, screen));
    // Several provider futures resolve in sequence; `pumpAndSettle` would be a
    // lie about why we are waiting.
    for (int i = 0; i < 12; i++) {
      await tester.pump();
    }
  }

  /// The width the widget found by [of] was OFFERED — its incoming
  /// `BoxConstraints.maxWidth`. See the header for why this and not `getSize`.
  double offeredWidth(WidgetTester tester, Finder of) {
    final RenderBox box = tester.renderObject<RenderBox>(of);
    return (box.constraints).maxWidth;
  }

  /// The screen's own content box, found THROUGH the pane rather than by a
  /// global type search — so a second `ListView` appearing elsewhere on the
  /// screen cannot silently become the thing being measured.
  ///
  /// ⚠️ THE `findsWidgets` CHECK IS THE ERROR MESSAGE, not an extra assertion.
  /// Scoping through `ContentPane` means the whole-pane-deleted case reaches
  /// `.first` on an empty iterable and dies with `Bad state: No element` — red,
  /// correctly, but pointing at `Iterable.first` in the framework rather than
  /// at the screen. Verified against the real tree: stripping the pane out of
  /// the onboarding screen produced exactly that. This turns the commonest
  /// regression into a sentence that names it.
  Finder inPane(Type contentType) {
    expect(
      find.byType(ContentPane),
      findsWidgets,
      reason:
          'this screen has no ContentPane at all, so there is no width cap to '
          'measure — it was removed rather than mis-set',
    );
    return find
        .descendant(
          of: find.byType(ContentPane),
          matching: find.byType(contentType),
        )
        .first;
  }

  // ── ONBOARDING · ContentPane.reading (720) ─────────────────────────────────
  //
  // The cap that can fail at 1280 without any help: 720 < 1280, so the ordinary
  // desktop window is already a distinguishing surface for this screen.
  group('onboarding is capped at reading width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const OnboardingScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        375 - 64,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed — 375 less the 32/32 gutters that were already there',
      );
      expect(
        tester.takeException(),
        isNull,
        reason: 'the carousel must lay out clean on the narrowest phone',
      );
    });

    // ⚠️ 768 IS ALREADY PAST THE CAP, and that asymmetry with the two
    // `ListView` screens below is the substance of choosing `.reading` here
    // rather than the default. 720 < 768, so a small tablet is the FIRST of
    // these three widths at which this screen stops growing — prose runs out of
    // useful line length long before a page runs out of useful width. Writing
    // `768 - 64` here (as the phone case writes `375 - 64`) is the mistake this
    // comment exists to stop the next reader from re-making.
    testWidgets('at 768 the reading cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const OnboardingScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        AppBreakpoints.reading - 64,
        reason:
            'a tablet is wider than 720, so the pane is doing its job here '
            'already — the 32/32 gutters then come out of the cap, not out of '
            'the surface',
      );
    });

    testWidgets('at 1280 the body is capped at AppBreakpoints.reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const OnboardingScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        lessThanOrEqualTo(AppBreakpoints.reading),
        reason:
            'unconstrained this ran 1216 px lines — roughly 200 characters, '
            'against the 45–75 the eye can track. AppBreakpoints.reading is '
            'the constant that says "this is prose"',
      );
      expect(AppBreakpoints.reading, 720);
    });
  });

  // ── SETTINGS · ContentPane (kMaxBodyWidth, 1280) ───────────────────────────
  group('settings is capped at the body width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const SettingsScreen());
      expect(offeredWidth(tester, inPane(ListView)), 375);
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 768 the cap is still a no-op', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const SettingsScreen());
      expect(offeredWidth(tester, inPane(ListView)), 768);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth),
      );
    });

    // 🔴 THE CASE THAT CAN ACTUALLY GO RED — see the file header.
    testWidgets('at 1920 the list stops at AppBreakpoints.kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'without the pane every ListTile here stretches the full display: '
            'the leading icon at one edge, the trailing chevron at the other, '
            'and the eye travelling between them for every row',
      );
    });
  });

  // ── MANAGE PLAN · ContentPane (kMaxBodyWidth, 1280) ───────────────────────
  group('manage-plan is capped at the body width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const ManagePlanScreen());
      expect(offeredWidth(tester, inPane(ListView)), 375);
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 768 the cap is still a no-op', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const ManagePlanScreen());
      expect(offeredWidth(tester, inPane(ListView)), 768);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const ManagePlanScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth),
      );
    });

    testWidgets('at 1920 the list stops at AppBreakpoints.kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const ManagePlanScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'the screen whose entire job is "cancelling must be no harder than '
            'subscribing" had its cancel row spread across the whole display',
      );
    });
  });
}
