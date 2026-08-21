// ─────────────────────────────────────────────────────────────────────────────
// P4·L1 — THE SHARED PRIMITIVES: RowCard's brightness, and the l10n of the two
// shared strings that reach every screen.
//
// `features/shared/` is the one directory in this app where a single line is
// wrong on three screens at once. Three separate properties are pinned here
// because all three live in that directory, and each is falsifiable on its own:
//
//   1. ROWCARD IN BOTH BRIGHTNESSES — GROUND *AND* TITLE. RowCard is
//      `cardDecoration`'s deferred sibling — same file, same defect, explicitly
//      named in W0's report as NOT fixed there. The pair reads exactly like
//      `dark_card_surface_test.dart`: the LIGHT half is a PIN against the
//      LITERAL `AppColors.surface` (asserting against `scheme.surface` would let
//      the natural regression — "tidying" the light branch to a scheme slot —
//      pass, because both sides of the comparison would move together), and the
//      DARK half is the FALSIFIER.
//      🔴 THE TITLE HALF WAS MISSING UNTIL 2026-08-21 and that gap had already
//      been paid for: every assertion here was about the GROUND, so the row
//      shipped `AppColors.ink` on `surfaceContainerHighest` — near-black prose
//      on the app's commonest control — with this group green throughout. A fix
//      that is one word wide needs an assertion, or the revert is silent.
//
//   5. ROWCARD IS POINTER-AWARE: a tighter row and a hover state on desktop.
//      Neither is keyed off a width. Density comes from `theme.visualDensity`,
//      which `ThemeData` derives from the platform, and the FIRST case in that
//      group asserts that derivation directly — `buildAppTheme` configures
//      neither `platform` nor `visualDensity`, so that default is the only thing
//      holding the seam open and nothing else in the suite would notice it
//      closing. Hover comes from hover itself, the one signal that reports the
//      pointer rather than the platform.
//
//   2. `DueInfo.localized` RETURNS ARB STRINGS. Asserted in EN *and* TA. The
//      English half alone would be tautological: `l10n.dueToday` is "Due today",
//      which is byte-identical to the hardcoded literal `DueInfo.of` still
//      returns, so an implementation that never touched the arb would pass it.
//      Tamil is what makes the assertion able to fail.
//
//   3. `PoweredByNikatru` RENDERS THE LOCALIZED LINE. Same reasoning, and Tamil
//      is even sharper here: `poweredByLine` reads "{company} வழங்கும் {app}" —
//      the two names SWAP PLACES. A concatenation of an interpolated "by" cannot
//      produce that string in any order.
//
//   4. P4·TEXT — THE OTHER THREE LIGHT-ONLY PRIMITIVES: `SectionHeader`,
//      `SoftButton`, `GradientButton`. Same pair shape as RowCard above: each
//      group is a LIGHT pin against the LITERAL tokens plus a DARK falsifier,
//      and each of the three is independently falsifiable (reverting one
//      widget's dark branch reddens only its own group — verified 2026-08-09).
//      The seam underneath `SectionHeader` is `AppText.of(context)`, pinned
//      separately at package level in
//      `packages/design_system/test/app_text_test.dart`.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/core/app_config.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/features/shared/due.dart';
import 'package:subly/features/shared/widgets.dart';
import 'package:subly/l10n/app_localizations.dart';

/// The seed `app.dart` passes to BOTH `theme:` and `darkTheme:`. Kept as a
/// literal (as in `dark_card_surface_test.dart`) so a change to the app's seed
/// surfaces as a failure to explain rather than a test that silently follows it.
const Color kSublySeed = Color(0xFF6459F5);

/// A subscription whose renewal is [days] away from [now].
Subscription _dueIn(int days, DateTime now) => Subscription(
  id: 's1',
  name: 'Netflix',
  category: 'Streaming',
  price: 649,
  cycle: BillingCycle.monthly,
  nextRenewal: now.add(Duration(days: days)),
);

/// Everything a mounted [RowCard] actually resolves, read off the widgets that
/// carry it rather than off the arguments it was handed:
///   · [decoration] — the outer Container (shadow in light / border in dark);
///   · [material]   — the fill. It has to be the Material so the InkWell splash
///                    clips to it, and it is where the hover wash lands too;
///   · [padding]    — the inset that carries the desktop density;
///   · [title]      — the style the title [Text] RENDERS with. Nothing read this
///                    until 2026-08-21, which is how the row spent the dark pass
///                    painting `AppColors.ink` on a dark card with every other
///                    assertion in this group green.
typedef _Row = ({
  BoxDecoration decoration,
  Material material,
  EdgeInsets padding,
  TextStyle title,
});

/// Mounts a bare [RowCard] under [mode]. [onTap] is needed by the hover cases —
/// an inert row deliberately does not respond to a pointer, so a hover test
/// against the default would pass for the wrong reason.
Future<_Row> _pumpRow(
  WidgetTester tester,
  ThemeMode mode, {
  VoidCallback? onTap,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: kSublySeed),
      darkTheme: buildAppTheme(seed: kSublySeed, brightness: Brightness.dark),
      themeMode: mode,
      home: Scaffold(
        body: Center(child: RowCard(title: 'Netflix', onTap: onTap)),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return _readRow(tester);
}

/// [_Row] for whatever [RowCard] is currently mounted — split out of [_pumpRow]
/// so the hover cases can re-read the SAME element after the pointer moves,
/// rather than pumping a second widget and comparing two different rows.
_Row _readRow(WidgetTester tester) {
  final Container container = tester.widget<Container>(
    find
        .descendant(of: find.byType(RowCard), matching: find.byType(Container))
        .first,
  );
  final Material material = tester.widget<Material>(
    find
        .descendant(of: find.byType(RowCard), matching: find.byType(Material))
        .first,
  );
  // ⚠️ The density inset is found by walking UP from the title, not by taking
  // the first Padding under RowCard: `Material` inserts an EdgeInsets.zero
  // Padding of its own above the InkWell (measured 2026-08-21 — the naive
  // descendant finder returned EdgeInsets.zero and reported the tightening as
  // total). `find.ancestor` orders from the closest ancestor outwards, and
  // nothing sits between the title and the row's own Padding.
  final Padding padding = tester.widget<Padding>(
    find.ancestor(of: find.text('Netflix'), matching: find.byType(Padding)).first,
  );
  final Text title = tester.widget<Text>(
    find.descendant(of: find.byType(RowCard), matching: find.byType(Text)).first,
  );
  return (
    decoration: container.decoration! as BoxDecoration,
    material: material,
    padding: padding.padding as EdgeInsets,
    title: title.style!,
  );
}

/// Runs [body] with `defaultTargetPlatform` pinned to [platform] — the same
/// thing a real desktop or mobile build reports — and resets it before the test
/// ends.
///
/// ⚠️ NOT `addTearDown`, which is the obvious spelling and does not work:
/// `flutter_test` runs `debugAssertAllFoundationVarsUnset` inside
/// `_verifyInvariants` BEFORE the tear-downs fire, so a reset parked in a
/// tear-down fails every test that sets the override with "The value of a
/// foundation debug variable was changed by the test" (measured 2026-08-21).
/// `finally` is what puts the reset inside the body.
Future<void> _onPlatform(TargetPlatform platform, AsyncCallback body) async {
  debugDefaultTargetPlatformOverride = platform;
  try {
    await body();
  } finally {
    debugDefaultTargetPlatformOverride = null;
  }
}

/// Parks a MOUSE pointer over the centre of the mounted [RowCard].
///
/// ⚠️ `kind: PointerDeviceKind.mouse` is the whole point, not boilerplate:
/// hover is the one signal that reports the POINTER rather than the platform,
/// and a touch pointer must not produce it. `addPointer` first at a location
/// outside the row, so `moveTo` is a real enter event rather than a pointer that
/// materialises already inside.
Future<void> _hover(WidgetTester tester) async {
  final TestGesture gesture = await tester.createGesture(
    kind: PointerDeviceKind.mouse,
  );
  await gesture.addPointer(location: Offset.zero);
  addTearDown(gesture.removePointer);
  await gesture.moveTo(tester.getCenter(find.byType(RowCard)));
  await tester.pumpAndSettle();
}

/// Mounts [PoweredByNikatru] with the real delegates in [locale].
Future<void> _pumpFooter(WidgetTester tester, Locale locale) async {
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: buildAppTheme(seed: kSublySeed),
      home: const Scaffold(body: Center(child: PoweredByNikatru())),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  final ColorScheme dark = buildAppTheme(
    seed: kSublySeed,
    brightness: Brightness.dark,
  ).colorScheme;

  // ───────────────────────────────────────────────────────────────────────────
  group('RowCard is theme-aware', () {
    testWidgets('LIGHT is pixel-identical to the pre-dark row', (
      WidgetTester tester,
    ) async {
      final _Row row = await _pumpRow(tester, ThemeMode.light);

      expect(
        row.material.color,
        AppColors.surface,
        reason:
            'The light row MUST stay the literal AppColors.surface. This is the '
            'frozen legacy app the owner eyeballs; RowCard is on home (2 sites) '
            'and scan, so a swap to scheme.surface repaints the dashboard.',
      );
      expect(
        row.decoration.boxShadow,
        kCardShadow,
        reason: 'Light keeps the original two-layer shadow, unchanged.',
      );
      expect(
        row.decoration.border,
        isNull,
        reason:
            'Light gains NOTHING from the dark work — a border here would be a '
            'visible 1px inset on every row.',
      );
    });

    testWidgets('DARK derives its fill from the scheme, not the token', (
      WidgetTester tester,
    ) async {
      final _Row row = await _pumpRow(tester, ThemeMode.dark);

      expect(
        row.material.color,
        isNot(AppColors.surface),
        reason:
            'THE DEFECT THIS INCREMENT FIXES: a white row on a dark scaffold. '
            'Reverting the Material to the unconditional AppColors.surface '
            'turns this red.',
      );
      expect(
        row.material.color,
        dark.surfaceContainerHighest,
        reason:
            'The dark row uses the same scheme slot as cardDecoration — the '
            'lightest container step, widest separation from the scaffold.',
      );
    });

    testWidgets('DARK carries an edge affordance instead of the shadow', (
      WidgetTester tester,
    ) async {
      final _Row row = await _pumpRow(tester, ThemeMode.dark);

      // kCardShadow is two BLACK alphas (0x0A141420, 0x24141420). On a dark
      // scaffold they paint nothing a user can see, so the row would have no
      // boundary at all — the border is required, not decorative.
      expect(
        row.decoration.boxShadow,
        isNull,
        reason:
            'The black-alpha shadow is DROPPED in dark, not dimmed for show.',
      );
      expect(
        row.decoration.border,
        isNotNull,
        reason: 'Without a border the dark row has NO boundary.',
      );
      expect(
        (row.decoration.border! as Border).top.color,
        dark.outlineVariant,
        reason:
            "The hairline is the scheme's own divider slot, not an invented "
            'colour.',
      );
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 🔴 THE TITLE, WHICH NOTHING IN THIS FILE READ UNTIL 2026-08-21. Every
    // assertion above is about the GROUND — fill, shadow, border — so the row
    // could paint, and for a while did paint, `AppColors.ink` (#141420) on
    // `surfaceContainerHighest` with this whole group green. The fix (routing
    // the title through `AppText.of(context)`) is one word and can be reverted
    // by one word; these two cases are what makes that revert loud.
    //
    // Same pair shape as everything else here: LIGHT pins the LITERAL token so
    // that "tidying" it to a scheme slot goes red instead of repainting the
    // build the owner eyeballs, DARK is the falsifier.
    // ─────────────────────────────────────────────────────────────────────────
    testWidgets('LIGHT paints the title the literal AppColors.ink', (
      WidgetTester tester,
    ) async {
      final _Row row = await _pumpRow(tester, ThemeMode.light);

      expect(
        row.title.color,
        AppColors.ink,
        reason:
            'In light, AppText.of returns the const objects THEMSELVES '
            '(identical(…body, AppText.body) is pinned in '
            'packages/design_system/test/app_text_test.dart), so the title is '
            'byte-identical to the pre-dark row. Asserting the literal — not '
            'AppText.of(light).body.color — is what makes a swap to a scheme '
            'slot fail here instead of following itself.',
      );
      // Still AppText.body underneath with the call-site copyWith on top, not a
      // TextStyle rebuilt by hand: a rebuild would silently drop the family.
      expect(row.title.fontFamily, 'Manrope');
      expect(row.title.fontWeight, FontWeight.w700);
      expect(row.title.fontSize, 15);
    });

    testWidgets('DARK resolves the title through the AppText seam', (
      WidgetTester tester,
    ) async {
      final _Row row = await _pumpRow(tester, ThemeMode.dark);

      expect(
        row.title.color,
        isNot(AppColors.ink),
        reason:
            'THE REGRESSION THIS PINS: #141420 prose on a dark card. RowCard is '
            "the app's commonest control — every subscription row on home and "
            'scan — so reverting the title to the const AppText.body puts '
            'near-black text on every row in the app. This is the assertion '
            'that turns red when it does.',
      );
      expect(
        row.title.color,
        dark.onSurface,
        reason:
            "The seam maps the ink styles onto the scheme's prose slot, the "
            'same one SectionHeader resolves to below.',
      );
      // copyWith, not a rebuild — weight and size must survive the dark branch.
      expect(row.title.fontFamily, 'Manrope');
      expect(row.title.fontWeight, FontWeight.w700);
      expect(row.title.fontSize, 15);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🖥 THE DESKTOP ROW. RowCard is sized for a thumb, and the signal that says
  // otherwise is deliberately NOT a width: a phone in landscape is 900px and
  // still wants the thumb row, a half-screen desktop window is 700px and still
  // wants the mouse row, so an AppBreakpoints test would be wrong in BOTH
  // directions. The signal is `theme.visualDensity`, which ThemeData already
  // derives from the platform.
  //
  // 🔴 THE FIRST CASE IS THE ONE THAT MATTERS, and it is here because this repo
  // has shipped four seams that reported healthy with no open path. It proves
  // the density arrives WITHOUT anyone configuring it — `buildAppTheme` sets
  // neither `platform` nor `visualDensity`, so if Flutter ever stopped defaulting
  // `visualDensity` from the platform, the desktop row would silently go back to
  // thumb height and every other assertion below would still pass.
  // ───────────────────────────────────────────────────────────────────────────
  group('RowCard is pointer-aware', () {
    testWidgets('a DESKTOP build already carries compact density, unconfigured', (
      WidgetTester tester,
    ) async {
      await _onPlatform(TargetPlatform.macOS, () async {
        expect(
          buildAppTheme(seed: kSublySeed).visualDensity,
          VisualDensity.compact,
          reason:
              'ThemeData defaults visualDensity to '
              'defaultDensityForPlatform(platform) (theme_data.dart:412), which '
              'is compact on macOS/Windows/Linux. buildAppTheme passes neither, '
              'so the seam RowCard reads is open on the desktop targets with no '
              'app change. If this goes red the desktop row is DEAD, not just '
              'less tight, and nothing else in the suite would say so.',
        );
      });
    });

    testWidgets('a MOBILE build stays at standard density', (
      WidgetTester tester,
    ) async {
      await _onPlatform(TargetPlatform.android, () async {
        expect(
          buildAppTheme(seed: kSublySeed).visualDensity,
          VisualDensity.standard,
          reason:
              'THE OTHER HALF: the tightening must not reach a phone. A row '
              'sized for a thumb is not a defect on Android.',
        );
      });
    });

    testWidgets('DESKTOP tightens the row vertically and ONLY vertically', (
      WidgetTester tester,
    ) async {
      await _onPlatform(TargetPlatform.macOS, () async {
        final _Row row = await _pumpRow(tester, ThemeMode.light);

        // compact is (-2, -2) and baseSizeAdjustment is density × 4 logical px
        // (theme_data.dart:3225, :3307-3314), so dy is -8 — a TOTAL adjustment,
        // hence -4 per edge against the default padding of 14.
        expect(
          row.padding.top,
          10,
          reason:
              "The number is the framework's own arithmetic, not a taste value: "
              "14 + (-8 / 2). Home's 44px GlyphTile row goes 72 → 64.",
        );
        expect(row.padding.bottom, 10);
        expect(
          row.padding.left,
          14,
          reason:
              "HORIZONTAL IS UNCHANGED ON PURPOSE. It sets this row's text "
              'rhythm against the cardDecoration cards beside it on home and '
              'insights, which are not RowCards and do not tighten — moving it '
              "leaves a mixed screen's left edge ragged on desktop and flush on "
              'mobile. Material reads density the same way for chips '
              '(theme_data.dart:3159).',
        );
        expect(row.padding.right, 14);
      });
    });

    testWidgets('MOBILE keeps the full thumb-sized inset on all four edges', (
      WidgetTester tester,
    ) async {
      await _onPlatform(TargetPlatform.android, () async {
        final _Row row = await _pumpRow(tester, ThemeMode.light);

        expect(
          row.padding,
          const EdgeInsets.all(14),
          reason:
              'THE FALSIFIER FOR THE DENSITY WORK: an unconditional tightening '
              '— or one keyed off a width that a landscape phone also satisfies '
              '— shrinks the touch target on the device this app mostly runs on.',
        );
      });
    });

    testWidgets('HOVER lifts the fill by the theme\'s own hover token', (
      WidgetTester tester,
    ) async {
      final _Row rest = await _pumpRow(
        tester,
        ThemeMode.light,
        onTap: () {},
      );
      expect(rest.material.color, AppColors.surface, reason: 'the rest state');

      await _hover(tester);
      final _Row hovered = _readRow(tester);

      // The wash is ThemeData.hoverColor (black at 0.04 in light — the default
      // at theme_data.dart:468, untouched by buildAppTheme), composited onto the
      // resting fill. Asserting the composite rather than "some other colour"
      // is what stops a future hand-picked alpha from passing.
      expect(
        hovered.material.color,
        Color.alphaBlend(
          buildAppTheme(seed: kSublySeed).hoverColor,
          AppColors.surface,
        ),
        reason:
            'RowCard composites the framework hover token onto Material.color '
            'so the state is readable here at all. Deleting the composite (and '
            'leaving hover to the ink layer) turns this red.',
      );
      expect(hovered.material.color, isNot(AppColors.surface));
    });

    testWidgets('HOVER steps the dark hairline outlineVariant → outline', (
      WidgetTester tester,
    ) async {
      final _Row rest = await _pumpRow(tester, ThemeMode.dark, onTap: () {});
      expect((rest.decoration.border! as Border).top.color, dark.outlineVariant);

      await _hover(tester);
      final _Row hovered = _readRow(tester);

      expect(
        (hovered.decoration.border! as Border).top.color,
        dark.outline,
        reason:
            "The two divider weights are both the scheme's own, so nothing is "
            'invented — and it is a colour change on a border that already '
            'exists at rest, so the row does not move under the cursor. (Light '
            'gets the wash only: Border.all insets its child, so adding one on '
            'hover would shift the title 1px as the pointer arrived.)',
      );
      expect(hovered.material.color, isNot(dark.surfaceContainerHighest));
    });

    testWidgets('an INERT row does not react to the pointer', (
      WidgetTester tester,
    ) async {
      // RowCard is used inertly — a plain list row with nothing behind it. The
      // same reason `Semantics(button:)` is conditional: a row that does nothing
      // when clicked must not advertise that it can be.
      final _Row rest = await _pumpRow(tester, ThemeMode.dark);
      await _hover(tester);
      final _Row hovered = _readRow(tester);

      expect(hovered.material.color, rest.material.color);
      expect(
        (hovered.decoration.border! as Border).top.color,
        dark.outlineVariant,
      );
    });

    testWidgets('a row that STOPS being tappable while hovered drops the hover', (
      WidgetTester tester,
    ) async {
      await _pumpRow(tester, ThemeMode.dark, onTap: () {});
      await _hover(tester);
      expect(
        _readRow(tester).material.color,
        isNot(dark.surfaceContainerHighest),
        reason: 'precondition: the row is lit',
      );

      // Same pointer, same position, same State object — only the callback goes
      // away. `InkWell` cannot help here: the pointer never left, so no
      // `onHover(false)` is ever sent, and `onHover` is null on the new widget
      // anyway. Without the `widget.onTap != null` re-check in `build` the row
      // stays lit while no longer being a control at all.
      //
      // 🔴 THIS CASE EXISTS BECAUSE THE MUTATION SAID IT HAD TO. Deleting the
      // re-check on its own changed NO test outcome (measured 2026-08-21) —
      // InkWell already declines to fire `onHover` while disabled, so the
      // conditional wiring beside it is belt-and-braces. This is the one path
      // where the re-check is load-bearing rather than decorative, so it is the
      // one that keeps it out of the dead-code pile.
      await _pumpRow(tester, ThemeMode.dark);
      expect(_readRow(tester).material.color, dark.surfaceContainerHighest);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('DueInfo.localized reads the arb', () {
    // `now` is fixed and mid-month so no Duration arithmetic crosses a boundary
    // that DateTime(y, m, d) truncation would round differently.
    final DateTime now = DateTime(2026, 6, 15, 9, 30);

    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] today / tomorrow / N days come from l10n', (
        WidgetTester tester,
      ) async {
        // The exact load path `Localizations` itself takes.
        final AppLocalizations l10n = await AppLocalizations.delegate.load(
          Locale(code),
        );

        expect(
          DueInfo.localized(l10n, _dueIn(0, now), now).label,
          l10n.dueToday,
          reason:
              'Due-today must be the arb string. In [$code] that is '
              '"${l10n.dueToday}" — an implementation that kept the hardcoded '
              '"Due today" passes [en] and fails [ta].',
        );
        expect(
          DueInfo.localized(l10n, _dueIn(1, now), now).label,
          l10n.renewsTomorrow,
          reason: 'The d == 1 branch is renewsTomorrow, NOT dueInDays(1).',
        );
        expect(
          DueInfo.localized(l10n, _dueIn(2, now), now).label,
          l10n.dueInDays(2),
          reason: 'The near branch (d <= 5) interpolates the count.',
        );
        expect(
          DueInfo.localized(l10n, _dueIn(30, now), now).label,
          l10n.dueInDays(30),
          reason: 'The far branch uses the same key, only the colour differs.',
        );

        // The three labels must be mutually distinct in every locale — a
        // translation that collapsed two of them would make the branch
        // unobservable, and the assertions above would still pass.
        final Set<String> labels = <String>{
          l10n.dueToday,
          l10n.renewsTomorrow,
          l10n.dueInDays(2),
        };
        expect(
          labels,
          hasLength(3),
          reason: 'Locale $code collapsed a branch.',
        );
      });
    }

    testWidgets('the plural key actually pluralizes (the shipped bug)', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );

      // 🔴 This pins the ARB VALUES, not DueInfo. Both live branches of
      // `DueInfo.of` read `In $d days`, so before `dueInDays` became a plural
      // key a one-day horizon anywhere in the app rendered "In 1 days".
      // English needed the plural before Tamil did. DueInfo.localized itself
      // never reaches the =1 arm (d == 1 returns renewsTomorrow first), so if
      // the arm is ever deleted as "unreachable", this is what says otherwise.
      expect(en.dueInDays(1), 'In 1 day');
      expect(en.dueInDays(2), 'In 2 days');
      expect(en.dueInDays(1), isNot(en.dueInDays(2)));
    });

    testWidgets('localized keeps of()\'s thresholds and colours', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );

      // `of` is retained until the three call sites migrate, which means the
      // two factories coexist and can DRIFT. The urgency colour is the part a
      // reader would not notice drifting, so it is asserted across the whole
      // range rather than at one point.
      for (int d = -3; d <= 40; d++) {
        final Subscription s = _dueIn(d, now);
        expect(
          DueInfo.localized(en, s, now).color,
          DueInfo.of(s, now).color,
          reason: 'Colour drift between of() and localized() at d = $d.',
        );
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('PoweredByNikatru renders the localized line', () {
    testWidgets('[en] the publisher line and the three short links', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await _pumpFooter(tester, const Locale('en'));

      expect(
        find.text(en.poweredByLine(AppConfig.appName, AppConfig.companyName)),
        findsOneWidget,
      );
      expect(find.text(en.linkPrivacyShort), findsOneWidget);
      expect(find.text(en.linkTermsShort), findsOneWidget);
      expect(find.text(en.linkRefundShort), findsOneWidget);
    });

    testWidgets('[ta] the placeholders SWAP ORDER — a concatenation cannot', (
      WidgetTester tester,
    ) async {
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );
      await _pumpFooter(tester, const Locale('ta'));

      // "{company} வழங்கும் {app}" — company first. This is the whole reason
      // poweredByLine is a placeholder key rather than a translated "by".
      expect(
        find.text(ta.poweredByLine(AppConfig.appName, AppConfig.companyName)),
        findsOneWidget,
        reason:
            'The Tamil line puts the company FIRST. No interpolation of '
            "'\$appName by \$companyName' can produce it.",
      );
      expect(
        find.text('${AppConfig.appName} by ${AppConfig.companyName}'),
        findsNothing,
        reason:
            'THE FALSIFIER: the pre-l10n hardcoded string must not survive '
            'into a Tamil build.',
      );

      expect(find.text(ta.linkPrivacyShort), findsOneWidget);
      expect(find.text(ta.linkTermsShort), findsOneWidget);
      expect(find.text(ta.linkRefundShort), findsOneWidget);
      expect(
        find.text('Privacy'),
        findsNothing,
        reason: 'Same falsifier for the footer links.',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P4·TEXT — the three primitives that were still light-only after W0/L1.
  //
  // Each group is one widget, so a revert of one dark branch reddens exactly
  // one group and names itself. The LIGHT halves assert LITERAL tokens
  // (`AppColors.ink` / `.surface` / `.line` / `.brandGradient`, `kBrandGlow`),
  // never scheme slots: asserting against the scheme would let the natural
  // regression — "tidying" a light branch to `scheme.*` — pass, because both
  // sides of the comparison would move together.
  // ───────────────────────────────────────────────────────────────────────────
  group('SectionHeader is theme-aware', () {
    testWidgets('LIGHT is byte-identical to the pre-dark heading', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(tester, ThemeMode.light, const SectionHeader('By date'));
      final TextStyle s = _headerStyle(tester);

      expect(
        s.color,
        AppColors.ink,
        reason:
            'The light heading MUST stay the literal AppColors.ink. It is on '
            'calendar, budget and twice on home — the screens the owner '
            'eyeballs.',
      );
      // Still AppText.title underneath, not a style rebuilt by hand: these three
      // are what `AppText.title` carries and a fresh TextStyle would drop them.
      expect(s.fontFamily, 'Space Grotesk');
      expect(s.fontWeight, FontWeight.w700);
      expect(s.letterSpacing, -0.4);
      expect(s.fontSize, 17, reason: 'The call-site copyWith is unchanged.');
    });

    testWidgets('DARK resolves the heading through the AppText seam', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(tester, ThemeMode.dark, const SectionHeader('By date'));
      final TextStyle s = _headerStyle(tester);

      expect(
        s.color,
        isNot(AppColors.ink),
        reason:
            'THE ROOT CAUSE THIS INCREMENT FIXES: 0xFF141420 prose on a dark '
            'scaffold. Reverting SectionHeader to the const AppText.title '
            'turns this red.',
      );
      expect(
        s.color,
        dark.onSurface,
        reason: 'The seam maps the ink styles onto the scheme\'s prose slot.',
      );
      // copyWith, not a rebuild — the size and the tracking must survive dark.
      expect(s.fontSize, 17);
      expect(s.letterSpacing, -0.4);
      expect(s.fontFamily, 'Space Grotesk');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('SoftButton is theme-aware', () {
    testWidgets('LIGHT is byte-identical to the pre-dark pill', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(
        tester,
        ThemeMode.light,
        const SoftButton(label: 'Keep it'),
      );
      final _Soft s = _softStyle(tester);

      expect(s.background, AppColors.surface, reason: 'literal, pinned');
      expect(s.side, AppColors.line, reason: 'literal, pinned');
      expect(s.foreground, AppColors.ink, reason: 'the old const default');
      expect(s.labelColor, AppColors.ink);
    });

    testWidgets('DARK takes the RowCard slots instead of the white pill', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(
        tester,
        ThemeMode.dark,
        const SoftButton(label: 'Keep it'),
      );
      final _Soft s = _softStyle(tester);

      expect(
        s.background,
        isNot(AppColors.surface),
        reason:
            'THE DEFECT THIS INCREMENT FIXES: a white pill on a dark sheet — '
            '"Keep it", "Continue with Apple", the consent answers. Reverting '
            'the backgroundColor to the unconditional AppColors.surface turns '
            'this red.',
      );
      expect(
        s.background,
        dark.surfaceContainerHighest,
        reason:
            'The same slot cardDecoration and RowCard use, so the three read '
            'as one surface family.',
      );
      expect(
        s.side,
        isNot(AppColors.line),
        reason:
            'AppColors.line (0xFFECECF2) is a hairline tuned to sit ON white. '
            'Left alone it is the brightest thing on a dark sheet.',
      );
      expect(s.side, dark.outlineVariant);
      expect(s.foreground, isNot(AppColors.ink));
      expect(s.foreground, dark.onSurface);
      expect(
        s.labelColor,
        dark.onSurface,
        reason:
            'The Text carries its own style, so the foregroundColor alone is '
            'not enough — both have to move or the label stays near-black.',
      );
    });

    testWidgets('an EXPLICIT color is honoured verbatim in both brightnesses', (
      WidgetTester tester,
    ) async {
      // `settings_screen.dart:671` passes `color: AppColors.danger` for the
      // delete-account row. A caller that names a colour is choosing an accent,
      // not asking for the default prose colour, so the brightness branch must
      // not overrule it — otherwise this widget's own dark fix would flatten a
      // deliberate accent.
      //
      // (This case was justified by `consent_prompt.dart passes AppColors.accent
      // for "Allow"` until 2026-08-10, when that widget was deleted. The
      // justification was RE-POINTED rather than the case deleted: the caller it
      // named is gone, the behaviour it protects is not.)
      for (final ThemeMode mode in <ThemeMode>[
        ThemeMode.light,
        ThemeMode.dark,
      ]) {
        await _pumpUnder(
          tester,
          mode,
          const SoftButton(label: 'Allow', color: AppColors.accent),
        );
        final _Soft s = _softStyle(tester);
        expect(s.foreground, AppColors.accent, reason: 'mode: $mode');
        expect(s.labelColor, AppColors.accent, reason: 'mode: $mode');
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('GradientButton is theme-aware', () {
    testWidgets('LIGHT keeps the brand gradient AND the accent glow', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(
        tester,
        ThemeMode.light,
        const GradientButton(label: 'Sign in'),
      );
      final _Grad g = _gradientStyle(tester);

      expect(g.decoration.gradient, AppColors.brandGradient);
      expect(
        g.decoration.boxShadow,
        kBrandGlow,
        reason: 'Light keeps the original one-layer accent glow, unchanged.',
      );
      expect(g.labelColor, Colors.white);
    });

    testWidgets('DARK drops the light-tuned accent glow', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(
        tester,
        ThemeMode.dark,
        const GradientButton(label: 'Sign in'),
      );
      final _Grad g = _gradientStyle(tester);

      expect(
        g.decoration.boxShadow,
        isNull,
        reason:
            'kBrandGlow is the ACCENT at 50%. Over the near-white page it is a '
            'soft lift; over scheme.surface in dark the same constant resolves '
            'to #3B3687 (measured) — a hard purple bloom. This is kCardShadow\'s '
            'defect read the other way round: a fixed-alpha shadow tuned to one '
            'background misbehaves on the other. Restoring the unconditional '
            'boxShadow turns this red.',
      );
    });

    testWidgets('DARK does NOT repaint the fill or the label', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(
        tester,
        ThemeMode.dark,
        const GradientButton(label: 'Sign in'),
      );
      final _Grad g = _gradientStyle(tester);

      // 🔒 Deliberate NON-change, asserted so nobody "finishes the job" later.
      // brandGradient + white is already this app's treatment on its dark
      // surfaces (onboarding CTA, both heroes, the FAB, the calendar today-pill)
      // and contrast holds at both gradient ends for a 15px w700 label. Swapping
      // dark to the theme's derived gradient would force scheme.onPrimary for
      // the label and leave this one CTA diverging from every other brand
      // surface — a repaint with no defect behind it.
      expect(g.decoration.gradient, AppColors.brandGradient);
      expect(g.labelColor, Colors.white);
    });
  });
}

// ─── P4·TEXT helpers ─────────────────────────────────────────────────────────

/// Mounts [child] under Subly's REAL theme pair — the same `buildAppTheme(seed:)`
/// calls `app.dart` makes — at [mode].
///
/// ⚠️ `pumpAndSettle`, not `pump`: MaterialApp wraps its child in an
/// `AnimatedTheme`, so a second `pumpWidget` in one test still reports the FIRST
/// theme at t=0 and a light→dark switch reads as a broken widget.
Future<void> _pumpUnder(
  WidgetTester tester,
  ThemeMode mode,
  Widget child,
) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: kSublySeed),
      darkTheme: buildAppTheme(seed: kSublySeed, brightness: Brightness.dark),
      themeMode: mode,
      home: Scaffold(body: Center(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

/// The style the single [Text] inside a mounted [SectionHeader] actually renders
/// with — the thing a user sees, not the style the widget was handed.
TextStyle _headerStyle(WidgetTester tester) => tester
    .widget<Text>(
      find.descendant(
        of: find.byType(SectionHeader),
        matching: find.byType(Text),
      ),
    )
    .style!;

typedef _Soft = ({
  Color background,
  Color foreground,
  Color side,
  Color labelColor,
});

/// [SoftButton]'s four resolved colours. The `ButtonStyle` properties are
/// `WidgetStateProperty`s, so they are resolved for the default (enabled,
/// untouched) state rather than read raw.
_Soft _softStyle(WidgetTester tester) {
  final ButtonStyle style = tester
      .widget<OutlinedButton>(find.byType(OutlinedButton))
      .style!;
  final Text label = tester.widget<Text>(
    find.descendant(of: find.byType(SoftButton), matching: find.byType(Text)),
  );
  return (
    background: style.backgroundColor!.resolve(<WidgetState>{})!,
    foreground: style.foregroundColor!.resolve(<WidgetState>{})!,
    side: style.side!.resolve(<WidgetState>{})!.color,
    labelColor: label.style!.color!,
  );
}

typedef _Grad = ({BoxDecoration decoration, Color labelColor});

/// [GradientButton]'s outer decoration (gradient + glow) and its label colour.
_Grad _gradientStyle(WidgetTester tester) {
  final DecoratedBox box = tester.widget<DecoratedBox>(
    find
        .descendant(
          of: find.byType(GradientButton),
          matching: find.byType(DecoratedBox),
        )
        .first,
  );
  final Text label = tester.widget<Text>(
    find.descendant(
      of: find.byType(GradientButton),
      matching: find.byType(Text),
    ),
  );
  return (
    decoration: box.decoration as BoxDecoration,
    labelColor: label.style!.color!,
  );
}
