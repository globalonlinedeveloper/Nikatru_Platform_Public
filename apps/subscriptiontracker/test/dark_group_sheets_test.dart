// ─────────────────────────────────────────────────────────────────────────────
// P4·L5 — THE TWO SHEETS: BOTH BRIGHTNESSES, AND (FOR CANCEL) BOTH LOCALES.
//
// The add sheet and the cancel sheet are the app's two modal surfaces. They are
// pinned together because they carry the same two defects and the same two
// fixes, and because a fix applied to one of them alone is the shape that ships.
//
// 🔴 WHY THE INK IS ASSERTED AND NOT JUST THE FILL. Both sheets painted
// `AppColors.bg` unconditionally, so with `app.dart` supplying `darkTheme` a
// dark-OS user got a LIGHT sheet over dark chassis chrome. Repointing only the
// fill would have been WORSE THAN LEAVING IT: every string on these sheets is
// drawn with an `AppText` style, and those styles carry a hardcoded
// `AppColors.ink` / `AppColors.muted`. A dark fill under near-black text is
// invisible text — a legibility failure where there was only an inconsistency.
// So each dark case asserts the FILL and the INK, and the ink half is the one
// that would otherwise regress in silence.
//
// 🔴 THE LIGHT HALVES ARE PINS AGAINST THE LITERAL TOKENS, NOT AGAINST THE
// SCHEME — the same rule as `dark_card_surface_test.dart` and
// `shared_primitives_test.dart`. `apps/subscriptiontracker` is the frozen legacy rail-prover
// the owner eyeballs. Written as `expect(fill, scheme.surfaceContainerLow)` the
// natural regression ("tidy the light branch to a scheme slot") would PASS,
// because both sides of the comparison move together. Written against
// `AppColors.bg` it cannot.
//
// 🔴 THE REMOVE SHEET IS ASSERTED IN BOTH SHIPPED LOCALES (ST-U3). It prints no
// money figure and no date in either, and no English sentence in Tamil.
//
// ⚠️ The surface is pinned with [setSurface] for layout determinism only.
// Nothing here measures a width; the phone is chosen because it is the
// narrowest, so the Tamil sentences are also being asked to fit.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/core/format/monthly_share.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/features/cancel/cancel_sheet.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

import 'support/width_harness.dart';

/// The seed `app.dart` passes to BOTH `theme:` and `darkTheme:`. A literal, as
/// in the two sibling dark specs, so a change to the app's seed surfaces as a
/// failure to explain rather than as a test that silently follows it.
const Color kSublySeed = Color(0xFF6459F5);

/// The currency an empty [MemStore] resolves to — `SettingsState`'s default
/// `currencyCode` (`settings_controller.dart`).
/// Named rather than inlined so that if the default ever moves, the equality
/// below fails with both sentences printed instead of with a bare mismatch.
const String kDefaultCurrencyCode = 'USD';

/// These sheets render under the default `en` delegate, so the money in them
/// is formatted under `en` — the same locale the widget's own
/// `AppLocalizations.localeName` reports. Restating it here rather than
/// hardcoding a grouped string keeps the expectation on the same two axes the
/// sheet used.
const MoneyFormatter kMoney = MoneyFormatter('en');

Subscription _sub() => Subscription(
  id: 'sub-1',
  name: 'Netflix',
  category: 'Streaming',
  price: const Money(1500, kDefaultCurrencyCode),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 9, 12),
);

/// The open-button host, in [mode] and [locale].
///
/// Both sheets are opened by a call rather than routed to, so they need a
/// launcher; [open] is the `show*` entry point itself, which is the seam that
/// matters — a test that pumped the private `_AddSheet`/`_CancelSheet` widget
/// directly would bypass `showModalBottomSheet` and therefore prove nothing
/// about the surface the user actually sees.
Widget _host({
  required ThemeMode mode,
  required Locale locale,
  required void Function(BuildContext) open,
}) => ProviderScope(
  overrides: defaultWidthOverrides(),
  child: MaterialApp(
    locale: locale,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    theme: buildAppTheme(seed: kSublySeed),
    darkTheme: buildAppTheme(seed: kSublySeed, brightness: Brightness.dark),
    themeMode: mode,
    home: Scaffold(
      body: Builder(
        builder: (BuildContext context) => Center(
          child: TextButton(
            onPressed: () => open(context),
            // Not localized on purpose: it belongs to the harness, not to the
            // app, and keeping it English makes the [ta] cases readable.
            child: const Text('open'),
          ),
        ),
      ),
    ),
  ),
);

Future<void> _openSheet(
  WidgetTester tester, {
  required ThemeMode mode,
  Locale locale = const Locale('en'),
  required void Function(BuildContext) open,
}) async {
  await setSurface(tester, kPhone);
  await tester.pumpWidget(_host(mode: mode, locale: locale, open: open));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

/// Every `BoxDecoration` inside the mounted sheet, in tree order.
List<BoxDecoration> _decorations(WidgetTester tester) => tester
    .widgetList<Container>(
      find.descendant(
        of: find.byType(BottomSheet),
        matching: find.byType(Container),
      ),
    )
    .map((Container c) => c.decoration)
    .whereType<BoxDecoration>()
    .toList();

/// The CANCEL sheet's own surface, identified by its signature rounding: it
/// rounds only the top two corners at 28, and nothing else in its tree does.
/// (The add sheet is on the chassis `AppFormSheet` since train ST-D6, rounded
/// at `AppRadius.xl`, and its group finds it by that.)
///
/// Found by that property rather than by `.first` on purpose — `.first` is right
/// by accident and wrong the day a wrapper Container is added above it, and it
/// would go on reporting a colour either way.
BoxDecoration _sheetSurface(WidgetTester tester) {
  final List<BoxDecoration> hits = _decorations(tester)
      .where(
        (BoxDecoration d) =>
            d.borderRadius ==
            const BorderRadius.vertical(top: Radius.circular(28)),
      )
      .toList();
  expect(
    hits,
    hasLength(1),
    reason:
        'the sheet surface is no longer the one top-rounded-28 decoration in '
        'the tree, so this test is about to measure something else',
  );
  return hits.single;
}

/// A sheet's heading, found by its text AND its 22 px size — the cancel sheet's
/// title is the one reader left (the add sheet's title is the chassis
/// `AppFormSheet` heading since train ST-D6, found by its text in its group).
Finder _headingSized(String label, double fontSize) => find.byWidgetPredicate(
  (Widget w) => w is Text && w.data == label && w.style?.fontSize == fontSize,
  description: 'a Text "$label" at fontSize $fontSize',
);

TextStyle _styleOf(WidgetTester tester, Finder finder) {
  expect(finder, findsOneWidget);
  return tester.widget<Text>(finder).style!;
}

void main() {
  final ThemeData darkTheme = buildAppTheme(
    seed: kSublySeed,
    brightness: Brightness.dark,
  );
  final ColorScheme dark = darkTheme.colorScheme;

  // ───────────────────────────────────────────────────────────────────────────
  // ⏱ 2026-09-28 · train ST-D6: THE ADD SHEET IS ON THE CHASSIS FORM
  // COMPONENTS, AND ITS LIGHT ARM IS NO LONGER FROZEN. The "LIGHT is
  // pixel-identical" case that stood here pinned the literal `AppColors` light
  // palette; the design train repaints the sheet from the scheme in BOTH
  // brightnesses, so both arms now assert the same slots — and each still names
  // the defect it would catch (a literal light colour leaking into dark, ink
  // left behind when the fill moved).
  group('add sheet · surface', () {
    for (final (String name, ThemeMode mode, ThemeData theme)
        in <(String, ThemeMode, ThemeData)>[
          ('light', ThemeMode.light, buildAppTheme(seed: kSublySeed)),
          ('dark', ThemeMode.dark, darkTheme),
        ]) {
      testWidgets('[$name] every paint is a scheme slot, fill AND ink', (
        WidgetTester tester,
      ) async {
        final ColorScheme scheme = theme.colorScheme;
        final AppLocalizations en = await AppLocalizations.delegate.load(
          const Locale('en'),
        );
        await _openSheet(
          tester,
          mode: mode,
          open: (BuildContext c) => showAddSubscriptionSheet(c),
        );

        final List<BoxDecoration> surfaces = _decorations(tester)
            .where(
              (BoxDecoration d) =>
                  d.borderRadius ==
                  const BorderRadius.vertical(
                    top: Radius.circular(AppRadius.xl),
                  ),
            )
            .toList();
        expect(surfaces, hasLength(1), reason: 'the sheet surface moved');
        expect(
          surfaces.single.color,
          scheme.surfaceContainerLow,
          reason:
              "M3's own bottom-sheet slot; in dark it sits ABOVE the "
              'scaffold, so the sheet lifts off the page it covers.',
        );
        if (mode == ThemeMode.dark) {
          expect(surfaces.single.color, isNot(AppColors.bg));
        }

        // The title: the ink moved with the fill, or dark is near-black text
        // on a dark sheet. Deleting the colour from the chassis title turns
        // the dark case red.
        final TextStyle title = _styleOf(
          tester,
          find.text(en.addSubscriptionTitle).first,
        );
        expect(title.color, scheme.onSurface);
        expect(
          _styleOf(tester, find.text(en.addPopularHeading)).color,
          scheme.onSurfaceVariant,
        );

        // The cycle arms: selection is a FILL the scheme derives, never the
        // brand gradient with a literal white on it.
        Material arm(String label) => tester.widget<Material>(
          find
              .ancestor(of: find.text(label), matching: find.byType(Material))
              .first,
        );
        expect(arm(en.cycleMonthly).color, scheme.secondaryContainer);
        expect(arm(en.cycleYearly).color, AppCard.fillOf(theme));
        expect(tester.takeException(), isNull);
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('cancel sheet · surface', () {
    testWidgets('LIGHT is pixel-identical to the pre-dark sheet', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await _openSheet(
        tester,
        mode: ThemeMode.light,
        open: (BuildContext c) => showCancelSheet(c, _sub()),
      );

      expect(_sheetSurface(tester).color, AppColors.bg);
      expect(
        _styleOf(
          tester,
          _headingSized(en.cancelSubscriptionTitle('Netflix'), 22),
        ).color,
        AppColors.ink,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('DARK derives the fill AND the ink from the scheme', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await _openSheet(
        tester,
        mode: ThemeMode.dark,
        open: (BuildContext c) => showCancelSheet(c, _sub()),
      );

      expect(_sheetSurface(tester).color, isNot(AppColors.bg));
      expect(_sheetSurface(tester).color, dark.surfaceContainerLow);
      expect(
        _styleOf(
          tester,
          _headingSized(en.cancelSubscriptionTitle('Netflix'), 22),
        ).color,
        isNot(AppColors.ink),
      );
      expect(
        _styleOf(
          tester,
          _headingSized(en.cancelSubscriptionTitle('Netflix'), 22),
        ).color,
        dark.onSurface,
      );
      expect(tester.takeException(), isNull);
    });

    // 🔴 FilledButton's default foreground is `colorScheme.onPrimary`: white in
    // a light scheme, a very dark tone in a dark one. The background is the
    // FIXED AppColors.danger red, so the default would have printed near-black
    // on red for the one control on this sheet that must not be misread.
    // Stating `foregroundColor: Colors.white` changes nothing in light — which
    // is exactly what the light case pins.
    //
    // ⚠️ ONE MODE PER CASE, NOT A LOOP INSIDE ONE. `pumpWidget` reuses the
    // MaterialApp element, so its Navigator keeps the route stack: a second
    // `pumpWidget` in the same case leaves the FIRST sheet mounted above the
    // launcher and the tap lands on the scrim. Measured here — the loop version
    // failed with `Bad state: No element`, which reads like a missing widget
    // rather than like a leaked route.
    for (final (String name, ThemeMode mode) in <(String, ThemeMode)>[
      ('light', ThemeMode.light),
      ('dark', ThemeMode.dark),
    ]) {
      testWidgets('[$name] the destructive confirm keeps a WHITE label', (
        WidgetTester tester,
      ) async {
        await _openSheet(
          tester,
          mode: mode,
          open: (BuildContext c) => showCancelSheet(c, _sub()),
        );
        final FilledButton confirm = tester.widget<FilledButton>(
          find.byType(FilledButton),
        );
        expect(
          confirm.style!.foregroundColor!.resolve(<WidgetState>{}),
          Colors.white,
          reason: '$name: the confirm label must stay white on the danger fill',
        );
        expect(
          confirm.style!.backgroundColor!.resolve(<WidgetState>{}),
          AppColors.danger,
        );
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('remove sheet · says REMOVE and prints no money (ST-U3, B32)', () {
    // 🔴 THE RED CONTROL FOR ST-U3's SHEET. The shipped sheet said "Cancel
    // Netflix?", "You'll save {monthly}/mo · {yearly}/yr. Access continues
    // until {date}." and "You're now saving {monthly}/mo. Nicely done." — while
    // its only effect was deleting the row from this app's list. Restoring any
    // of the three money figures, the date, or the congratulation turns a case
    // below red, in both shipped locales.
    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] step 0 names the removal and no figure', (
        WidgetTester tester,
      ) async {
        await _openSheet(
          tester,
          mode: ThemeMode.light,
          locale: Locale(code),
          open: (BuildContext c) => showCancelSheet(c, _sub()),
        );
        final AppLocalizations l10n = await AppLocalizations.delegate.load(
          Locale(code),
        );
        final Subscription s = _sub();

        expect(find.text(l10n.cancelSubscriptionTitle(s.name)), findsOneWidget);
        expect(find.text(l10n.removeStep1Body), findsOneWidget);
        // No share, no yearly charge, no renewal date: the app deletes a row
        // and knows none of the provider's terms.
        expect(
          find.textContaining(kMoney.formatShareFigure(s.monthlyShare)),
          findsNothing,
        );
        expect(
          find.textContaining(kMoney.formatRounded(s.yearlyCharge)),
          findsNothing,
        );
        // Computed AFTER the pump: the l10n delegates are what call
        // `initializeDateFormatting`.
        expect(
          find.textContaining(DateFormat.MMMMd(code).format(s.nextRenewal)),
          findsNothing,
        );
        expect(tester.takeException(), isNull);
      });

      testWidgets('[$code] step 1 says removed, and points at the provider', (
        WidgetTester tester,
      ) async {
        await _openSheet(
          tester,
          mode: ThemeMode.light,
          locale: Locale(code),
          open: (BuildContext c) => showCancelSheet(c, _sub()),
        );
        final AppLocalizations l10n = await AppLocalizations.delegate.load(
          Locale(code),
        );

        // Step 1 is reached by confirming against the unoverridden seed chain —
        // see `defaultWidthOverrides`, which leaves the repository resolving.
        await tester.tap(find.text(l10n.confirmCancel));
        await tester.pumpAndSettle();

        expect(find.text(l10n.cancelledHeading), findsOneWidget);
        expect(find.text(l10n.removeStep2Body), findsOneWidget);
        expect(find.text(l10n.done), findsOneWidget);
        expect(
          find.textContaining(kMoney.formatShareFigure(_sub().monthlyShare)),
          findsNothing,
        );
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('[ta] no English sentence survives into the Tamil sheet', (
      WidgetTester tester,
    ) async {
      await _openSheet(
        tester,
        mode: ThemeMode.light,
        locale: const Locale('ta'),
        open: (BuildContext c) => showCancelSheet(c, _sub()),
      );
      expect(find.textContaining('save'), findsNothing);
      expect(find.textContaining('Access continues'), findsNothing);
      expect(find.textContaining('Remove'), findsNothing);
      expect(find.text('Keep it'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });
}
