// ─────────────────────────────────────────────────────────────────────────────
// P4·L4 — THE DETAIL + SCAN GROUP: both locales, both brightnesses.
//
// These two screens moved together because they share nothing structurally and
// everything in kind: each is a full route outside the shell, each paints a
// gradient hero over a light-palette body, and each was hardcoding the same
// three things — English copy, an English date table (detail), and the light
// neutrals.
//
// 🔴 EVERY BRIGHTNESS PAIR BELOW IS LOAD-BEARING IN OPPOSITE DIRECTIONS, and
// this is the shape `dark_card_surface_test.dart` and `shared_primitives_test.
// dart` established rather than a new one:
//
//   · The LIGHT half is a PIN, not a feature test. `apps/subly` is the frozen
//     legacy rail-prover the owner eyeballs. It asserts the LITERAL token
//     (`AppColors.ink`, `AppColors.muted`, `AppColors.surface`,
//     `AppColors.line`) and NOT the equivalent scheme slot — on purpose.
//     Asserting `scheme.onSurface` would make the natural regression (someone
//     "tidying" the light arm to a scheme slot) PASS, because both sides of
//     the comparison would move together. An assertion that cannot fail is
//     worse than none.
//
//   · The DARK half is the FALSIFIER: revert any one fork to its
//     unconditional light value and the matching dark case goes red on its
//     first `expect`.
//
// 🔴 AND EVERY l10n ASSERTION RUNS IN TAMIL AS WELL AS ENGLISH, for the reason
// L1 recorded: the English values are byte-identical to the literals they
// replaced, so an implementation that never touched the arb passes [en]
// completely. [ta] is what makes those assertions able to fail, and each Tamil
// case also asserts the pre-l10n English literal `findsNothing`.
//
// ── THE THREE THINGS THIS FILE PINS THAT NOTHING ELSE DOES ───────────────────
//   1. THE SCAFFOLDS NO LONGER PAINT `AppColors.bg`. That token is 0xFFF4F4F8 —
//      a near-white — so on a dark theme it was the entire page rendered light
//      under dark chrome, the single worst pixel on either route. Asserted as
//      `backgroundColor == null` (i.e. inherited), which is exactly falsified
//      by re-adding the override, PLUS a check that what it inherits is
//      genuinely dark — otherwise "inherits" would be satisfied by a theme that
//      hands back a light colour anyway.
//   2. THE DATE TABLES ARE GONE. `_months` and `_shortMon` were English arrays
//      indexed by month number: they baked the ORDER of the parts, not just
//      their names, so no set of arb month keys could have made them correct.
//      The Tamil cases assert the `DateFormat` output and assert the English
//      rendering is absent.
//   3. `subscriptionCount` IS FED THE REAL COUNT. Pumped at ONE subscription
//      and at TWO, in the same test, because a plural key wired to a constant
//      passes either case alone. The one-item case is also the shipped bug this
//      fixes: the live line read `'${subs.length} subscriptions'`, i.e.
//      "1 subscriptions" for the user most likely to be on a first run.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/core/format/currency.dart';
import 'package:subly/core/format/sub_math.dart';
import 'package:subly/data/api/seed_api_client.dart';
import 'package:subly/data/models/payment_record.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/data/seed/demo_data.dart';
import 'package:subly/features/detail/subscription_detail_screen.dart';
import 'package:subly/features/scan/scan_screen.dart';
import 'package:subly/features/shared/due.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';
import 'package:subly/state/settings_controller.dart';

import 'support/width_harness.dart';

/// The seed `app.dart` passes to BOTH `theme:` and `darkTheme:`. A literal, as
/// in `dark_card_surface_test.dart`, so a change to the app's seed surfaces as
/// a failure to explain rather than a test that silently follows it.
const Color kSublySeed = Color(0xFF6459F5);

/// Netflix — `data/seed/demo_data.dart:10`. Monthly, `unused: false`, so the
/// detail screen renders `perMonth` and `usageActive`.
const String kNetflixId = '1';

/// Adobe CC — `demo_data.dart:15`. `unused: true`, so it renders the OTHER arm
/// of the usage ternary. Both arms are l10n'd and only pumping both proves it.
const String kAdobeId = '6';

/// A seed client whose subscription list is the first [n] of the demo set.
///
/// Subclassed rather than hand-implemented: `ApiClient` has eight methods and
/// seven of them are irrelevant here, so re-typing them would be seven more
/// places for this fake to disagree with the real one.
class _NSubsApi extends SeedApiClient {
  _NSubsApi(this.n);
  final int n;
  @override
  Future<List<Subscription>> getSubscriptions() async =>
      DemoData.subscriptions().take(n).toList();
}

/// A seed client with no payment history — the only way to reach the detail
/// screen's `noPaymentsYet` branch, since the real seed always generates four
/// records.
class _NoHistoryApi extends SeedApiClient {
  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async =>
      const <PaymentRecord>[];
}

/// Mounts [screen] under a REAL theme pair and a REAL locale.
///
/// Deliberately not `width_harness`'s [pumpAt]: that one hosts a bare
/// `MaterialApp` with no `theme`/`darkTheme`/`themeMode` and no `locale`, which
/// is right for a width property and useless for these two. It DOES reuse
/// [defaultWidthOverrides] — the storage and notification seams are platform
/// channels that do not exist under flutter_test, and restating them here would
/// be a second copy to drift.
///
/// Returns the container so a case can read the same `currencyProvider` the
/// screen read, rather than assuming the default symbol.
Future<ProviderContainer> _pump(
  WidgetTester tester,
  Widget screen, {
  ThemeMode mode = ThemeMode.light,
  Locale locale = const Locale('en'),
  List<Override> overrides = const <Override>[],
  Size size = const Size(420, 1400),
}) async {
  await setSurface(tester, size);
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[...defaultWidthOverrides(), ...overrides],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: kSublySeed),
        darkTheme: buildAppTheme(seed: kSublySeed, brightness: Brightness.dark),
        themeMode: mode,
        home: screen,
      ),
    ),
  );
  // Bare pumps, as in the harness: several provider futures resolve in
  // sequence, and `pumpAndSettle` against ScanScreen's periodic timer either
  // burns its whole run or spins. Advancing the scan clock is explicit, below.
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
  return c;
}

/// Walks the scan screen's 560 ms timer to its results phase.
///
/// Five steps then the flip: six periods. Only a pump WITH a duration advances
/// fake time. `width_scan_test.dart` does the same walk for the same reason.
Future<void> _toResults(WidgetTester tester) async {
  for (int i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 560));
  }
}

Color? _textColor(WidgetTester tester, String text) =>
    tester.widget<Text>(find.text(text).first).style?.color;

/// The nearest `Container` ancestor of [text] — the idiom `width_scan_test`
/// uses for the results hero, and for the same reason: finding the row or the
/// hero BY TYPE would match whichever Container the element tree visited first.
BoxDecoration _boxAround(WidgetTester tester, String text) =>
    tester
            .widget<Container>(
              find
                  .ancestor(
                    of: find.text(text),
                    matching: find.byType(Container),
                  )
                  .first,
            )
            .decoration!
        as BoxDecoration;

void main() {
  final ThemeData lightTheme = buildAppTheme(seed: kSublySeed);
  final ThemeData darkTheme = buildAppTheme(
    seed: kSublySeed,
    brightness: Brightness.dark,
  );
  final ColorScheme light = lightTheme.colorScheme;
  final ColorScheme dark = darkTheme.colorScheme;

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBSCRIPTION DETAIL
  // ═══════════════════════════════════════════════════════════════════════════
  group('detail speaks the arb', () {
    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] the eight visible strings come from l10n', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l10n = await AppLocalizations.delegate.load(
          Locale(code),
        );
        await _pump(
          tester,
          const SubscriptionDetailScreen(id: kNetflixId),
          locale: Locale(code),
        );

        expect(find.text(l10n.usageThisMonth), findsOneWidget);
        expect(find.text(l10n.paymentHistory), findsOneWidget);
        expect(find.text(l10n.editPlan), findsOneWidget);
        expect(find.text(l10n.cancelPlanButton), findsOneWidget);
        // The invisible tier — mini-card labels and the per-cycle caption.
        expect(find.text(l10n.fieldLabelPrice), findsOneWidget);
        expect(find.text(l10n.nextChargeLabel), findsOneWidget);
        expect(
          find.text(l10n.perMonth),
          findsOneWidget,
          reason: 'Netflix is monthly, so the ternary takes its perMonth arm.',
        );
        expect(
          find.text(l10n.usageActive),
          findsOneWidget,
          reason: 'Netflix has unused: false — the OTHER arm is pumped below.',
        );
      });
    }

    testWidgets('[ta] the pre-l10n English literals are GONE', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: kNetflixId),
        locale: const Locale('ta'),
      );

      // 🔴 THE FALSIFIER for the whole [en]/[ta] pair above. Every English
      // value in the arb is byte-identical to the literal it replaced, so [en]
      // alone is satisfied by a screen that still hardcodes all of them.
      for (final String stale in <String>[
        'Usage this month',
        'Payment history',
        'Edit plan',
        'PRICE',
        'NEXT CHARGE',
        'per month',
        'Active',
      ]) {
        expect(
          find.text(stale),
          findsNothing,
          reason: '"$stale" survived into a Tamil build — still hardcoded.',
        );
      }
    });

    testWidgets('the OTHER usage arm, and the not-found branch', (
      WidgetTester tester,
    ) async {
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );

      await _pump(
        tester,
        const SubscriptionDetailScreen(id: kAdobeId),
        locale: const Locale('ta'),
        // ⚠️ WIDER ON PURPOSE, AND NOT BECAUSE THE SCREEN NEEDS IT. flutter_test
        // substitutes a fallback font that draws EVERY glyph as a box of the
        // full font size, so "அரிதாகப் பயன்படுத்தப்படுகிறது" measures 29 × 12 px
        // here — several times what a real Tamil face renders. Treating that as
        // a layout defect would mean tuning this screen for a font that never
        // ships. The property under test in this group is COPY; the real width
        // properties live in `width_detail_test.dart`, which measures offered
        // constraints (font-independent) and stays green untouched.
        size: const Size(900, 1400),
      );
      expect(find.text(ta.usageRarelyUsed), findsOneWidget);
      expect(find.text('Rarely used'), findsNothing);

      // An id the seed does not hold. The route resolves and the RECORD does
      // not, which is why this is `subscriptionNotFound` and not the chassis
      // `notFoundTitle` ("Page not found").
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: 'no-such-id'),
        locale: const Locale('ta'),
      );
      expect(find.text(ta.subscriptionNotFound), findsOneWidget);
      expect(find.text('Subscription not found'), findsNothing);
    });

    testWidgets('the empty payment history reads from the arb', (
      WidgetTester tester,
    ) async {
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: kNetflixId),
        locale: const Locale('ta'),
        overrides: <Override>[
          apiClientProvider.overrideWithValue(_NoHistoryApi()),
        ],
      );
      expect(find.text(ta.noPaymentsYet), findsOneWidget);
      expect(find.text('No payments yet.'), findsNothing);
    });

    testWidgets('the icon-only controls announce localized labels', (
      WidgetTester tester,
    ) async {
      // Disposed INLINE, not via addTearDown: flutter_test asserts every
      // SemanticsHandle is released before tear-downs run, so `addTearDown`
      // here fails the test it is trying to clean up after.
      final SemanticsHandle handle = tester.ensureSemantics();
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: kNetflixId),
        locale: const Locale('ta'),
      );

      // An icon-only button is UNUSABLE under a screen reader without one, so
      // an untranslated label is a Tamil user reaching a control that speaks
      // English. `more_horiz` is still a stub; its label ships regardless.
      expect(find.bySemanticsLabel(ta.back), findsOneWidget);
      expect(find.bySemanticsLabel(ta.moreOptions), findsOneWidget);
      expect(find.bySemanticsLabel('Back'), findsNothing);
      expect(find.bySemanticsLabel('More options'), findsNothing);
      handle.dispose();
    });
  });

  group('detail: the date tables are gone', () {
    // Netflix renews 2026-07-22; the seed generates four prior payments on the
    // 22nd of each preceding month.
    final DateTime renewal = DateTime(2026, 7, 22);
    final DateTime firstPayment = DateTime(2026, 6, 22);

    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] next charge is MMMd and history is yMMMd', (
        WidgetTester tester,
      ) async {
        await _pump(
          tester,
          const SubscriptionDetailScreen(id: kNetflixId),
          locale: Locale(code),
        );

        expect(
          find.text(DateFormat.MMMd(code).format(renewal)),
          findsOneWidget,
          reason: 'the NEXT CHARGE mini-card, off _shortMon before this',
        );
        expect(
          find.text(DateFormat.yMMMd(code).format(firstPayment)),
          findsOneWidget,
          reason: 'the first payment row, off _months before this',
        );
      });
    }

    testWidgets('[ta] the English renderings are absent', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: kNetflixId),
        locale: const Locale('ta'),
      );

      // 🔴 THE FALSIFIER, and it is sharper than a missing-string check: the
      // deleted tables produced exactly these two strings, so their presence in
      // a Tamil build means an English month array is still being indexed.
      expect(find.text('Jul 22'), findsNothing);
      expect(find.text('June 22, 2026'), findsNothing);
      expect(
        DateFormat.yMMMd('ta').format(firstPayment),
        isNot(DateFormat.yMMMd('en').format(firstPayment)),
        reason:
            'if Tamil ever rendered dates identically to English the two '
            'assertions above would pass for the wrong reason',
      );
    });

    testWidgets('DueInfo comes through the localized factory', (
      WidgetTester tester,
    ) async {
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );
      final DateTime now = DateTime.now();
      final Subscription netflix = DemoData.subscriptions().firstWhere(
        (Subscription s) => s.id == kNetflixId,
      );
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: kNetflixId),
        locale: const Locale('ta'),
      );

      // The mini-card's sub-caption. `DueInfo.of` — the English-only factory
      // L1 retained — would render the same label in Tamil as in English, so
      // this is the assertion that says the call site migrated.
      final String expected = DueInfo.localized(ta, netflix, now).label;
      expect(find.text(expected), findsOneWidget);
      expect(
        find.text(DueInfo.of(netflix, now).label),
        findsNothing,
        reason: 'the un-localized factory is still being called at detail:56',
      );
    });
  });

  group('detail is theme-aware', () {
    testWidgets('LIGHT pins every literal token', (WidgetTester tester) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await _pump(tester, const SubscriptionDetailScreen(id: kNetflixId));

      expect(
        _textColor(tester, en.paymentHistory),
        AppColors.ink,
        reason:
            'the section heading must stay the LITERAL 0xFF141420. Asserting '
            'scheme.onSurface here would let a swap to it pass.',
      );
      expect(
        _textColor(tester, en.fieldLabelPrice),
        AppColors.muted,
        reason: 'the mini-card label stays the literal 0xFF73737F',
      );
      expect(
        tester
            .widget<LinearProgressIndicator>(
              find.byType(LinearProgressIndicator),
            )
            .backgroundColor,
        AppColors.line,
        reason: 'the usage meter track stays the literal 0xFFECECF2',
      );
      expect(
        _boxAround(
          tester,
          DateFormat.yMMMd('en').format(DateTime(2026, 6, 22)),
        ).color,
        AppColors.surface,
        reason:
            'a payment row stays the literal white — and stays SHADOWLESS: '
            'routing it through cardDecoration would add kCardShadow to a row '
            'that has never had one',
      );
    });

    testWidgets('DARK derives every one of them from the scheme', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: kNetflixId),
        mode: ThemeMode.dark,
      );

      expect(
        _textColor(tester, en.paymentHistory),
        isNot(AppColors.ink),
        reason:
            'THE DEFECT: 0xFF141420 heading ink on a dark scaffold is a '
            'heading nobody can read. Reverting the fork turns this red.',
      );
      expect(_textColor(tester, en.paymentHistory), dark.onSurface);
      expect(_textColor(tester, en.fieldLabelPrice), isNot(AppColors.muted));
      expect(_textColor(tester, en.fieldLabelPrice), dark.onSurfaceVariant);
      expect(
        tester
            .widget<LinearProgressIndicator>(
              find.byType(LinearProgressIndicator),
            )
            .backgroundColor,
        dark.outlineVariant,
        reason:
            'unbranched the track is a near-white bar BRIGHTER than the meter '
            'it is the background of',
      );

      final BoxDecoration row = _boxAround(
        tester,
        DateFormat.yMMMd('en').format(DateTime(2026, 6, 22)),
      );
      expect(
        row.color,
        isNot(AppColors.surface),
        reason:
            'a white payment row on a dark scaffold — the same defect as '
            'cardDecoration and RowCard, in the third place it lives',
      );
      expect(row.color, dark.surfaceContainerHighest);
    });

    testWidgets('the status colours do NOT fork, in either brightness', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      for (final ThemeMode mode in <ThemeMode>[
        ThemeMode.light,
        ThemeMode.dark,
      ]) {
        await _pump(
          tester,
          const SubscriptionDetailScreen(id: kNetflixId),
          mode: mode,
        );
        expect(
          _textColor(tester, en.usageActive),
          AppColors.positive,
          reason:
              'green means good in every app and at every brightness — '
              'AppThemeX.fromScheme keeps positive/warn/danger literal for '
              'exactly this reason, and re-hueing them from a brand seed would '
              'trade a universal signal for a decoration ($mode)',
        );
      }
    });

    testWidgets('the hero gradient and its whites are brightness-INVARIANT', (
      WidgetTester tester,
    ) async {
      for (final ThemeMode mode in <ThemeMode>[
        ThemeMode.light,
        ThemeMode.dark,
      ]) {
        await _pump(
          tester,
          const SubscriptionDetailScreen(id: kNetflixId),
          mode: mode,
        );

        final BoxDecoration hero =
            tester
                    .widget<Container>(
                      find.byKey(const Key('detail-hero-gradient')),
                    )
                    .decoration!
                as BoxDecoration;
        expect(
          hero.gradient,
          AppColors.heroGradient,
          reason:
              'heroA/B/C are three DARK indigos, so the hero is its own dark '
              'surface at either brightness. Deriving it from '
              'AppThemeX.heroGradient would repaint the LIGHT build ($mode).',
        );
        expect(
          _textColor(tester, 'Netflix'),
          Colors.white,
          reason:
              'which is why the ink on it stays white and does not fork — it '
              'is correct on this gradient both ways round ($mode)',
        );
        expect(
          tester.widget<Icon>(find.byIcon(Icons.arrow_back)).color,
          Colors.white,
        );
      }
    });

    testWidgets('the scaffold INHERITS instead of painting AppColors.bg', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: kNetflixId),
        mode: ThemeMode.dark,
      );
      expect(
        tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
        isNull,
        reason:
            'THE WORST PIXEL ON THIS ROUTE: AppColors.bg is 0xFFF4F4F8, so an '
            'explicit override painted the whole page near-white under dark '
            'chrome. Re-adding it turns this red.',
      );

      // ⚠️ AND `null` ON ITS OWN IS NOT THE PROPERTY. "Inherits" would be
      // satisfied by a theme that hands back a light colour anyway, so what it
      // inherits is asserted too — in both directions, since the light arm is
      // the one place in this file where light DOES move.
      expect(darkTheme.scaffoldBackgroundColor, dark.surface);
      expect(darkTheme.scaffoldBackgroundColor, isNot(AppColors.bg));
      expect(lightTheme.scaffoldBackgroundColor, light.surface);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCAN / FIRST-RUN SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  group('scan speaks the arb', () {
    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] the busy phase: title, subtitle, button, step', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l10n = await AppLocalizations.delegate.load(
          Locale(code),
        );
        await _pump(tester, const ScanScreen(), locale: Locale(code));

        expect(find.text(l10n.scanBusyTitle), findsOneWidget);
        expect(find.text(l10n.scanBusySubtitle), findsOneWidget);
        expect(find.text(l10n.scanningEllipsis), findsOneWidget);
        expect(
          find.text(l10n.scanStatusInitial),
          findsOneWidget,
          reason:
              'the pre-first-tick caption — on screen for 560 ms of every '
              'first run, which is why it is a key and not a placeholder',
        );

        // Walk the five step captions. They were a `static const List<String>`
        // the timer copied into a field; localized, they must be derived in
        // build, because AppLocalizations is an inherited lookup and illegal
        // in initState. This is the assertion that the derivation is right —
        // including its off-by-one.
        final List<String> steps = <String>[
          l10n.scanStep1,
          l10n.scanStep2,
          l10n.scanStep3,
          l10n.scanStep4,
          l10n.scanStep5,
        ];
        for (int i = 0; i < steps.length; i++) {
          await tester.pump(const Duration(milliseconds: 560));
          expect(
            find.text(steps[i]),
            findsOneWidget,
            reason: 'tick ${i + 1} must show scanStep${i + 1} in [$code]',
          );
        }
      });

      testWidgets('[$code] the results phase: heading, total, button', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l10n = await AppLocalizations.delegate.load(
          Locale(code),
        );
        final ProviderContainer c = await _pump(
          tester,
          const ScanScreen(),
          locale: Locale(code),
          overrides: <Override>[
            apiClientProvider.overrideWithValue(_NSubsApi(3)),
          ],
        );
        await _toResults(tester);

        final Currency currency = c.read(currencyProvider);
        final double total = SubMath.totalMonthly(
          DemoData.subscriptions().take(3).toList(),
        );

        expect(find.text(l10n.scanDoneTitle), findsOneWidget);
        expect(find.text(l10n.scanDoneSubtitle), findsOneWidget);
        expect(find.text(l10n.goToDashboard), findsOneWidget);
        expect(find.text(l10n.scanResultsHeading), findsOneWidget);
        expect(
          find.text(l10n.perMonthTotal(currency.fmt(total))),
          findsOneWidget,
        );
      });
    }

    testWidgets('[ta] the pre-l10n English literals are GONE', (
      WidgetTester tester,
    ) async {
      await _pump(tester, const ScanScreen(), locale: const Locale('ta'));
      expect(find.text('Setting up your board'), findsNothing);
      expect(find.text('This only takes a moment.'), findsNothing);
      expect(find.text('Scanning…'), findsNothing);
      expect(find.text('Setting things up'), findsNothing);
      await tester.pump(const Duration(milliseconds: 560));
      expect(find.text('Preparing your board'), findsNothing);

      await _toResults(tester);
      expect(find.text('All set'), findsNothing);
      expect(find.text('YOUR SUBSCRIPTIONS'), findsNothing);
      expect(find.text('Go to dashboard'), findsNothing);
    });
  });

  group('scan pluralizes the subscription count', () {
    // 🔴 ONE TEST, TWO COUNTS, DELIBERATELY. A plural key wired to a constant —
    // `subscriptionCount(1)`, or a stray `subs.length + 1` — passes whichever
    // single case you happen to write. Only the pair pins that the count comes
    // from the list.
    testWidgets('one subscription reads "1 subscription", two read "2"', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );

      await _pump(
        tester,
        const ScanScreen(),
        overrides: <Override>[
          apiClientProvider.overrideWithValue(_NSubsApi(1)),
        ],
      );
      await _toResults(tester);
      expect(find.text(en.subscriptionCount(1)), findsOneWidget);
      expect(
        find.text(en.subscriptionCount(2)),
        findsNothing,
        reason: 'a hardcoded count would show here',
      );
      expect(
        find.text('1 subscriptions'),
        findsNothing,
        reason:
            'THE SHIPPED BUG THIS FIXES. The live line was '
            "'\${subs.length} subscriptions', so the one-plan user — the "
            'likeliest audience for a first-run screen — was told '
            '"1 subscriptions".',
      );

      await _pump(
        tester,
        const ScanScreen(),
        overrides: <Override>[
          apiClientProvider.overrideWithValue(_NSubsApi(2)),
        ],
      );
      await _toResults(tester);
      expect(find.text(en.subscriptionCount(2)), findsOneWidget);
      expect(find.text(en.subscriptionCount(1)), findsNothing);
    });

    testWidgets('the arb arms are actually distinct', (
      WidgetTester tester,
    ) async {
      // Pins the KEY, not the screen: if the =1 arm were ever "tidied" away
      // the two assertions above would still pass against each other while
      // both rendered "1 subscriptions".
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      expect(en.subscriptionCount(1), '1 subscription');
      expect(en.subscriptionCount(2), '2 subscriptions');
      expect(en.subscriptionCount(1), isNot(en.subscriptionCount(2)));
    });
  });

  group('scan is theme-aware', () {
    testWidgets('LIGHT pins the literal tokens', (WidgetTester tester) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await _pump(tester, const ScanScreen());

      expect(
        _textColor(tester, en.scanBusyTitle),
        AppColors.ink,
        reason: 'the title stays the literal 0xFF141420',
      );
      expect(
        _textColor(tester, en.scanBusySubtitle),
        AppColors.muted,
        reason: 'the subtitle stays the literal 0xFF73737F',
      );
      expect(
        tester
            .widget<LinearProgressIndicator>(
              find.byType(LinearProgressIndicator),
            )
            .backgroundColor,
        AppColors.line,
        reason: 'the progress track stays the literal 0xFFECECF2',
      );
    });

    testWidgets('DARK derives them from the scheme', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await _pump(tester, const ScanScreen(), mode: ThemeMode.dark);

      expect(
        _textColor(tester, en.scanBusyTitle),
        isNot(AppColors.ink),
        reason:
            'THE DEFECT: near-black title ink on a dark first-run screen. '
            'Reverting the fork turns this red.',
      );
      expect(_textColor(tester, en.scanBusyTitle), dark.onSurface);
      expect(_textColor(tester, en.scanBusySubtitle), isNot(AppColors.muted));
      expect(_textColor(tester, en.scanBusySubtitle), dark.onSurfaceVariant);
      expect(
        tester
            .widget<LinearProgressIndicator>(
              find.byType(LinearProgressIndicator),
            )
            .backgroundColor,
        dark.outlineVariant,
      );
    });

    testWidgets('the results hero and its whites are brightness-INVARIANT', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      for (final ThemeMode mode in <ThemeMode>[
        ThemeMode.light,
        ThemeMode.dark,
      ]) {
        await _pump(
          tester,
          const ScanScreen(),
          mode: mode,
          overrides: <Override>[
            apiClientProvider.overrideWithValue(_NSubsApi(3)),
          ],
        );
        await _toResults(tester);

        expect(
          _boxAround(tester, en.scanResultsHeading).gradient,
          AppColors.brandGradient,
          reason:
              'a saturated indigo→violet is its own surface either way, which '
              'is what licenses the whites on it ($mode)',
        );
        expect(
          _textColor(tester, en.subscriptionCount(3)),
          Colors.white,
          reason: 'the figure on the gradient stays white ($mode)',
        );
      }
    });

    testWidgets('the scaffold INHERITS instead of painting AppColors.bg', (
      WidgetTester tester,
    ) async {
      await _pump(tester, const ScanScreen(), mode: ThemeMode.dark);
      expect(
        tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
        isNull,
        reason:
            'AppColors.bg is 0xFFF4F4F8 — an explicit override painted the '
            'whole first-run screen near-white under dark chrome.',
      );
      expect(darkTheme.scaffoldBackgroundColor, isNot(AppColors.bg));
    });
  });
}
