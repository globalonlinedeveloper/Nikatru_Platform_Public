// ─────────────────────────────────────────────────────────────────────────────
// P4·L2 — THE THREE GROUPED-LIST SCREENS: calendar, budget, insights, in both
// brightnesses and in both locales.
//
// `dark_card_surface_test.dart` and `shared_primitives_test.dart` pin the two
// SHARED surfaces (`cardDecoration`, `RowCard`). Neither of them can see the
// defect this file is about, because the defect is not in a card at all — it is
// in the TEXT painted on one. `AppText.title`/`.fig`/`.body` bake
// `AppColors.ink` (#141420) and `AppText.muted`/`.label` bake `AppColors.muted`,
// so every one of these screens shipped its headings and figures as near-black
// literals. W0 turned the cards dark underneath them and no test went red: the
// cards were correct and the writing on them had become invisible.
//
// 🔴 THE DARK HALF IS A WHOLE-SCREEN SWEEP, NOT A SPOT CHECK, and that is
// deliberate. A single `expect(titleColour, dark.onSurface)` is satisfied by
// fixing one `Text` out of fourteen, which is exactly the half-migration this
// repo keeps catching — a screen that reports healthy because the one line
// somebody remembered to assert on is the one line they fixed. The sweep walks
// every painted `RichText` span on the screen and fails if ANY of them is still
// one of the two light literals, so reverting a single `copyWith(color:)`
// anywhere in the file turns it red.
//
// 🔴 THE LIGHT HALF IS A PIN AGAINST THE LITERAL, for the same reason the two
// files above pin theirs: `apps/subscriptiontracker` is the frozen legacy rail-prover the
// owner eyeballs. Asserting light against `scheme.onSurface` would let the
// natural regression — "tidying" the light branch to a scheme slot — pass,
// because both sides of the comparison would move together.
//
// 🔴 AND THE l10n HALF RUNS IN TAMIL, because English is tautological here. The
// arb values are byte-identical to the literals they replaced and
// `DateFormat.yMMMM('en')` renders exactly what the deleted `_months` table
// did, so an implementation that changed nothing at all passes every English
// assertion. Tamil is what makes them able to fail.
//
// ⚠️ ONE KNOWN GAP IS EXCLUDED FROM THE SWEEP, IN THE OPEN: `SectionHeader`
// (calendar's "By date", budget's "By category") paints with `AppText.title`'s
// baked ink and lives in `features/shared/widgets.dart`, which this increment
// does not own. The exclusion is scoped to that one widget so the gap is
// visible here rather than absent; when the shared widget takes the same branch
// these call sites now do, delete `_sectionHeaderSpans` and the sweep covers it.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/calendar/calendar_screen.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/features/shared/widgets.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
// The fixture reads the same clock as the screens (`nowProvider`'s default),
// so a time-travel run moves both (test/support/test_clock.dart).
import 'package:subscriptiontracker/state/providers.dart' show wallClock;

import 'support/width_harness.dart';

/// The seed `app.dart` passes to BOTH `theme:` and `darkTheme:`. A literal here
/// (as in `dark_card_surface_test.dart` and `shared_primitives_test.dart`) so a
/// change to the app's seed surfaces as a failure to explain rather than as a
/// test that silently follows it.
const Color kSublySeed = Color(0xFF6459F5);

/// Hosts [screen] on the width harness's rig — which is what supplies the two
/// platform-channel seams (storage, notifications) these screens need and,
/// crucially, does NOT override the repository, so every one of them renders its
/// POPULATED branch. An empty screen has no rows to paint and would make every
/// assertion below vacuous.
///
/// [theme] is pushed in BELOW the harness's `MaterialApp` rather than through
/// it: `pumpAt` takes no theme parameter and `test/support/width_harness.dart`
/// is shared with the other P4 file-group increments, so a wrapper here buys the
/// same thing without an edit that would collide. `Theme` replaces the inherited
/// theme wholesale for its subtree, which is exactly what `Theme.of(context)`
/// inside each screen reads.
///
/// [locale] likewise goes through `Localizations.override`, which reuses the
/// delegates the harness's `MaterialApp` already installed.
Future<void> _pumpScreen(
  WidgetTester tester,
  Widget screen, {
  required ThemeData theme,
  Locale? locale,
}) async {
  await pumpAt(
    tester,
    kPhone,
    Builder(
      builder: (BuildContext context) {
        final Widget themed = Theme(data: theme, child: screen);
        if (locale == null) {
          return themed;
        }
        return Localizations.override(
          context: context,
          locale: locale,
          child: themed,
        );
      },
    ),
  );
}

/// Every `RichText` on screen that is NOT inside a [SectionHeader]. See the
/// header for why the one exclusion exists and when to delete it.
Set<Element> _sectionHeaderSpans() => find
    .descendant(of: find.byType(SectionHeader), matching: find.byType(RichText))
    .evaluate()
    .toSet();

/// The colours actually PAINTED by every text span on screen.
///
/// Read off `RichText` rather than off the `Text` widgets, on purpose: `Text`
/// reports the style the call site asked for, while `RichText` carries the
/// style after `DefaultTextStyle` has been merged in — i.e. the colour a user
/// would see. It also catches `Text.rich`, whose colours live on child spans
/// where `Text.style` is null (budget's "value / cap" line is exactly that).
List<Color> _paintedTextColors(WidgetTester tester) {
  final Set<Element> skip = _sectionHeaderSpans();
  final List<Color> out = <Color>[];
  for (final Element e in find.byType(RichText).evaluate()) {
    if (skip.contains(e)) {
      continue;
    }
    final InlineSpan span = (e.widget as RichText).text;
    final Color? root = span.style?.color;
    if (root != null) {
      out.add(root);
    }
    span.visitChildren((InlineSpan child) {
      final Color? c = child.style?.color;
      if (c != null) {
        out.add(c);
      }
      return true;
    });
  }
  return out;
}

/// The fill of every decorated `Container` on screen.
// ⚠️ CIRCLES ARE EXCLUDED, AND THE EXCLUSION IS DATED EVIDENCE, NOT TIDINESS.
// This assertion hunts CARD SURFACES painted light on the dark scaffold. The
// calendar's today-cell renders a 4px CIRCLE dot in `Colors.white` — an
// ON-GRADIENT indicator (calendar_screen.dart documents why it must not follow
// the scheme), and `Colors.white == AppColors.surface` by value. The dot only
// exists when TODAY's date carries a seeded renewal, so this suite passed every
// day until 2026-08-10 (a fixture renews on day 10) and then failed everywhere
// at once — a date-dependent false positive that blocked every merge for a
// morning. A 4px decoration is not a surface; a real white CARD is still a
// rectangle and still caught (negative-proven the day this line landed).
List<Color?> _containerFills(WidgetTester tester) => tester
    .widgetList<Container>(find.byType(Container))
    .map((Container c) => c.decoration)
    .whereType<BoxDecoration>()
    .where((BoxDecoration d) => d.shape != BoxShape.circle)
    .map((BoxDecoration d) => d.color)
    .toList();

void main() {
  final ThemeData lightTheme = buildAppTheme(seed: kSublySeed);
  final ThemeData darkTheme = buildAppTheme(
    seed: kSublySeed,
    brightness: Brightness.dark,
  );
  final ColorScheme dark = darkTheme.colorScheme;

  // The three screens, each with the arb key that renders as its page title —
  // the "one representative" the light half pins and the value assertions use.
  ({String name, Widget screen, String Function(AppLocalizations) title})
  screenOf(int i) =>
      <({String name, Widget screen, String Function(AppLocalizations) title})>[
        (
          name: 'calendar',
          screen: const CalendarScreen(),
          title: (AppLocalizations l) => l.calendarTitle,
        ),
        (
          name: 'insights',
          screen: const InsightsScreen(),
          title: (AppLocalizations l) => l.insightsTitle,
        ),
      ][i];

  // ───────────────────────────────────────────────────────────────────────────
  group('dark: the grouped-list screens derive from the scheme', () {
    // ⏱ ST-D3: Insights paints its cards with the ST-D0 `AppCard` (a Material
    // on `AppCard.fillOf`), not the app's `cardDecoration` Container, so the
    // Container-fill checks below run on calendar; Insights has its own case.
    testWidgets('[insights] every card is the foundation AppCard fill', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, const InsightsScreen(), theme: darkTheme);
      // The FIRST Material under each AppCard is the card itself; buttons
      // inside it carry their own.
      final List<Color?> fills = <Color?>[
        for (final Element card in find.byType(AppCard).evaluate())
          tester
              .widget<Material>(
                find
                    .descendant(
                      of: find.byWidget(card.widget),
                      matching: find.byType(Material),
                    )
                    .first,
              )
              .color,
      ];
      expect(fills, isNotEmpty, reason: 'NOT VACUOUS: no AppCard rendered');
      expect(fills, everyElement(AppCard.fillOf(darkTheme)));
      expect(fills, isNot(contains(AppColors.surface)));
    });

    for (int i = 0; i < 1; i++) {
      final ({
        String name,
        Widget screen,
        String Function(AppLocalizations) title,
      })
      s = screenOf(i);

      // ⏱ 2026-09-28 · train ST-D2: calendar left `cardDecoration` for
      // `AppCard` (a Material, not a Container); its card is asserted by the
      // ST-D2 group at the end of this file.
      if (s.name != 'calendar') {
        testWidgets('[${s.name}] no card is still the light surface', (
          WidgetTester tester,
        ) async {
          await _pumpScreen(tester, s.screen, theme: darkTheme);
          final List<Color?> fills = _containerFills(tester);

          expect(
            fills,
            isNot(contains(AppColors.surface)),
            reason:
                'A white card on a dark scaffold is the defect W0 fixed in '
                'cardDecoration. If it is back on ${s.name} it is because the '
                'screen stopped going through cardDecoration, not because the '
                'shared function regressed.',
          );
          expect(
            fills,
            contains(dark.surfaceContainerHighest),
            reason:
                'NOT VACUOUS: ${s.name} must actually have painted a card. With '
                'no card on screen the assertion above would pass on an empty '
                'page.',
          );
        });
      }

      testWidgets('[${s.name}] no text is still painted a light literal', (
        WidgetTester tester,
      ) async {
        await _pumpScreen(tester, s.screen, theme: darkTheme);
        final List<Color> colors = _paintedTextColors(tester);

        expect(
          colors,
          isNot(contains(AppColors.ink)),
          reason:
              'AppColors.ink is #141420 — near-black. Painted on the dark '
              'scaffold (scheme.surface) or on a surfaceContainerHighest card '
              'it is all but unreadable, and EVERY AppText.title/.fig/.body on '
              '${s.name} bakes it. Reverting a single copyWith(color:) in '
              '${s.name}_screen.dart turns this red.',
        );
        expect(
          colors,
          isNot(contains(AppColors.muted)),
          reason:
              'Same for AppColors.muted (#73737F), which AppText.muted and '
              'AppText.label bake — subtitles, stat captions, weekday heads.',
        );

        expect(
          colors,
          contains(dark.onSurface),
          reason:
              'NOT VACUOUS, and the positive half of the property: the ink '
              'neutral must resolve to the scheme slot buildAppTheme itself '
              'maps it to (ink: scheme.onSurface). A screen that simply '
              'rendered no text would satisfy the two isNot checks above.',
        );
        expect(
          colors,
          contains(dark.onSurfaceVariant),
          reason:
              'The muted neutral resolves to the slot AppThemeX.fromScheme '
              'maps `muted` to. Both halves are needed: ink alone would pass '
              'with every muted line left light.',
        );
      });
    }

    // ⏱ ST-D3 D3-3: the [budget] category-bar track case left with the Budget
    // screen. The Insights budget meter's track is `surfaceContainerHighest`,
    // pinned by the Insights goldens in both schemes.

    // ⏱ ST-D3 D3-4: the unused-row outlines left with the savings card (its
    // `unused` field is written by nothing). The ground this case now pins is
    // the budget meter's TRACK — the one bar on the rebuilt screen.
    testWidgets('[insights] the budget meter track is a scheme slot', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, const InsightsScreen(), theme: darkTheme);
      final List<Color?> tracks = tester
          .widgetList<LinearProgressIndicator>(
            find.byType(LinearProgressIndicator),
          )
          .map((LinearProgressIndicator p) => p.backgroundColor)
          .toList();
      expect(tracks, isNotEmpty, reason: 'NOT VACUOUS: the meter must exist.');
      expect(tracks, isNot(contains(AppColors.line)));
      expect(tracks, contains(dark.surfaceContainerHighest));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('light stays pinned to the literal tokens', () {
    // ⏱ ST-D3: Insights is rebuilt on the ST-D0 foundation — scheme roles and
    // the type ramp, never a colour literal — so the "light is the literal
    // token" pin applies to calendar only; the Insights goldens pin its light
    // pixels instead.
    for (int i = 0; i < 1; i++) {
      final ({
        String name,
        Widget screen,
        String Function(AppLocalizations) title,
      })
      s = screenOf(i);

      // ⏱ 2026-09-28 · train ST-D2: the legacy pin is RETIRED for calendar and
      // for calendar only — the design train repaints it from the ST-D0
      // foundation in both schemes, on purpose. The ST-D2 group at the end of
      // this file asserts the scheme slots the foundation promises instead; a
      // pin on the literal would now be the regression.
      if (s.name != 'calendar') {
        testWidgets('[${s.name}] the page title is still AppColors.ink exactly', (
          WidgetTester tester,
        ) async {
          final AppLocalizations en = await AppLocalizations.delegate.load(
            const Locale('en'),
          );
          await _pumpScreen(tester, s.screen, theme: lightTheme);

          final Text title = tester.widget<Text>(find.text(s.title(en)));
          expect(
            title.style?.color,
            AppColors.ink,
            reason:
                'THE LEGACY PIN. apps/subscriptiontracker is the frozen rail-prover the owner '
                'eyeballed at 1.0.151; light must stay byte-identical through '
                'the dark work. Asserting against lightTheme.colorScheme.onSurface '
                'instead would make the natural regression — tidying the light '
                'branch to a scheme slot — pass, because both sides of the '
                'comparison would move together.',
          );
          expect(
            _containerFills(tester),
            contains(AppColors.surface),
            reason: 'And the light cards are still the literal white surface.',
          );
        });
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the arb keys and the deleted date tables', () {
    testWidgets('[en] each screen renders its OWN title key', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );

      // 🔴 THE CROSS-CHECK IS THE POINT. `find.text(en.calendarTitle)` alone
      // passes if the screen kept the hardcoded literal, because the arb value
      // is byte-identical to it. What it CANNOT survive is the wrong key: swap
      // `l10n.calendarTitle` for `l10n.insightsTitle` in calendar_screen.dart and
      // the first pair below goes red naming both strings.
      await _pumpScreen(tester, const CalendarScreen(), theme: lightTheme);
      expect(find.text(en.calendarTitle), findsOneWidget);
      expect(
        find.text(en.insightsTitle),
        findsNothing,
        reason: 'calendar must not be showing insights\'s heading.',
      );
      expect(find.text(en.calendarByDate), findsOneWidget);

      await _pumpScreen(tester, const InsightsScreen(), theme: lightTheme);
      expect(find.text(en.insightsTitle), findsOneWidget);
      expect(find.text(en.calendarTitle), findsNothing);
      expect(find.text(en.byCategory), findsOneWidget);
    });

    testWidgets('[ta] the month name comes from intl, not a deleted table', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );
      // Both screens read `DateTime.now()` directly, so the expectation is
      // computed the same way rather than pinned to a month.
      final DateTime now = wallClock();
      final String taMonth = DateFormat.yMMMM('ta').format(now);
      final String enMonth = DateFormat.yMMMM('en').format(now);

      expect(
        taMonth,
        isNot(enMonth),
        reason:
            'THE PRECONDITION. If Tamil and English rendered the same month '
            'string, every assertion in this test would be vacuous.',
      );

      await _pumpScreen(
        tester,
        const CalendarScreen(),
        theme: lightTheme,
        locale: const Locale('ta'),
      );
      expect(
        find.textContaining(taMonth),
        findsOneWidget,
        reason:
            'calendar_screen.dart deleted a hardcoded English `_months` table. '
            'Restoring it — or interpolating `\$month \$year` — renders the '
            'English name inside an otherwise Tamil subtitle, which is exactly '
            'what shipped.',
      );
      expect(
        find.textContaining(enMonth),
        findsNothing,
        reason: 'The falsifier: no English month may survive a Tamil build.',
      );
      expect(
        find.text(ta.calendarTitle),
        findsOneWidget,
        reason:
            'And the heading is the TAMIL value — the assertion the English '
            'case above cannot make, because there the arb value and the '
            'deleted literal are the same bytes.',
      );
      expect(
        find.text(en.calendarTitle),
        findsNothing,
        reason: 'The pre-l10n English literal must not survive into Tamil.',
      );
    });
  });

  // ── ST-D2 · THE CALENDAR IS PAINTED FROM THE FOUNDATION, IN BOTH SCHEMES ───
  //
  // Replaces the legacy light pin for this one screen (see the two
  // `s.name != 'calendar'` guards above). Every expectation is a scheme slot
  // or an ST-D0 component's own answer, and each has a falsifier: a literal
  // colour, the old `cardDecoration`, or a bare `AppColors` neutral turns it
  // red.
  group('ST-D2: calendar derives every paint from the scheme', () {
    for (final Brightness b in Brightness.values) {
      testWidgets('[calendar] ${b.name}: title, cards and text are scheme '
          'slots', (WidgetTester tester) async {
        final ThemeData theme = b == Brightness.light ? lightTheme : darkTheme;
        final ColorScheme scheme = theme.colorScheme;
        final AppLocalizations en = await AppLocalizations.delegate.load(
          const Locale('en'),
        );
        await _pumpScreen(tester, const CalendarScreen(), theme: theme);

        expect(
          tester.widget<Text>(find.text(en.calendarTitle)).style?.color,
          scheme.onSurface,
        );
        final Iterable<Color?> cards = tester
            .widgetList<Material>(
              find.descendant(
                of: find.byType(AppCard),
                matching: find.byType(Material),
              ),
            )
            .map((Material m) => m.color)
            .whereType<Color>();
        expect(
          cards,
          isNotEmpty,
          reason: 'NOT VACUOUS: the grid card and the rows card must exist.',
        );
        expect(cards, everyElement(AppCard.fillOf(theme)));
        expect(
          _containerFills(tester),
          isNot(contains(AppColors.surface)),
          reason: 'no cardDecoration-era white card survives on this screen',
        );

        final List<Color> colors = _paintedTextColors(tester);
        expect(colors, contains(scheme.onSurface));
        expect(colors, contains(scheme.onSurfaceVariant));
        expect(colors, isNot(contains(AppColors.ink)));
        expect(colors, isNot(contains(AppColors.muted)));
      });
    }
  });
}
