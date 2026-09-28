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

/// The sheet's own surface, identified by its signature rounding: BOTH sheets
/// round only the top two corners at 28, and nothing else in either tree does.
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

/// The two cycle buttons, in order — Monthly (selected by default) then Yearly.
/// 14 is their own corner radius and is unique in the add sheet (the handle is
/// 4, the glyph tiles 13, the fields and the submit button 16, the sheet 28).
List<BoxDecoration> _cycleButtons(WidgetTester tester) {
  final List<BoxDecoration> hits = _decorations(tester)
      .where((BoxDecoration d) => d.borderRadius == BorderRadius.circular(14))
      .toList();
  expect(
    hits,
    hasLength(2),
    reason: 'expected exactly the Monthly/Yearly pair at radius 14',
  );
  return hits;
}

/// The 40×4 drag handle.
BoxDecoration _dragHandle(WidgetTester tester) {
  final Iterable<Container> hits = tester
      .widgetList<Container>(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(Container),
        ),
      )
      .where(
        (Container c) =>
            c.constraints == BoxConstraints.tightFor(width: 40, height: 4),
      );
  expect(hits, hasLength(1), reason: 'the 40x4 drag handle is gone');
  return hits.single.decoration! as BoxDecoration;
}

/// The add sheet's heading — disambiguated from the submit button, which reads
/// the SAME key (`addSubscriptionTitle`) by design, on its 22 px size.
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
  group('add sheet · surface', () {
    testWidgets('LIGHT is pixel-identical to the pre-dark sheet', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await _openSheet(
        tester,
        mode: ThemeMode.light,
        open: (BuildContext c) => showAddSubscriptionSheet(c),
      );

      expect(
        _sheetSurface(tester).color,
        AppColors.bg,
        reason:
            'The light sheet MUST stay the literal AppColors.bg. This is the '
            'frozen legacy app the owner eyeballs.',
      );
      expect(_dragHandle(tester).color, AppColors.line);
      // Monthly is selected on open: gradient, no flat fill. Yearly carries the
      // resting fill, which is the one the dark branch has to move.
      final List<BoxDecoration> cycle = _cycleButtons(tester);
      expect(cycle[0].gradient, isNotNull);
      expect(cycle[0].color, isNull);
      expect(cycle[1].color, AppColors.surface);
      expect(
        _styleOf(tester, _headingSized(en.addSubscriptionTitle, 22)).color,
        AppColors.ink,
      );
      expect(
        _styleOf(tester, find.text(en.addPopularHeading)).color,
        AppColors.muted,
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
        open: (BuildContext c) => showAddSubscriptionSheet(c),
      );

      final BoxDecoration surface = _sheetSurface(tester);
      expect(
        surface.color,
        isNot(AppColors.bg),
        reason:
            'THE DEFECT: a light sheet over dark chassis chrome. Reverting the '
            'decoration to the unconditional AppColors.bg turns this red.',
      );
      expect(
        surface.color,
        dark.surfaceContainerLow,
        reason:
            "M3's own bottom-sheet container slot, and in a dark scheme it sits "
            'ABOVE scheme.surface — which buildAppTheme paints the scaffold '
            'with — so the sheet lifts off the page it covers.',
      );
      expect(_dragHandle(tester).color, dark.outlineVariant);

      final List<BoxDecoration> cycle = _cycleButtons(tester);
      expect(
        cycle[0].gradient,
        isNotNull,
        reason:
            'ON-GRADIENT STAYS: the selected button is the brand gradient in '
            'both brightnesses. The gradient IS its background, so it does not '
            'inherit one, and the white on it is the same decision either way.',
      );
      expect(
        cycle[1].color,
        dark.surfaceContainerHighest,
        reason:
            'A control resting on the sheet takes the same slot cardDecoration '
            'and RowCard use for a card resting on a page.',
      );

      // 🔴 THE HALF THAT WOULD HAVE REGRESSED IN SILENCE. AppText.title carries
      // a hardcoded AppColors.ink, so a dark fill with the ink left alone is
      // near-black text on a dark sheet — worse than the light sheet it
      // replaced. Deleting the `color:` from the title's copyWith turns this
      // red and leaves every fill assertion above green.
      expect(
        _styleOf(tester, _headingSized(en.addSubscriptionTitle, 22)).color,
        isNot(AppColors.ink),
      );
      expect(
        _styleOf(tester, _headingSized(en.addSubscriptionTitle, 22)).color,
        dark.onSurface,
      );
      expect(
        _styleOf(tester, find.text(en.addPopularHeading)).color,
        dark.onSurfaceVariant,
      );
      expect(tester.takeException(), isNull);
    });
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
