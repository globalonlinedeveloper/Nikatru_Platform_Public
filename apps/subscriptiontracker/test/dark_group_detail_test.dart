// ─────────────────────────────────────────────────────────────────────────────
// P4·L4 — THE DETAIL + SCAN GROUP: both locales, both brightnesses.
//
// ⏱ 2026-10-01 · IM-01 (ADR 077 §2.2): SCAN is retired; its section is now
// the IMPORT hub's, held to the same two locales and the dark scaffold rule.
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
//   · The LIGHT half is a PIN, not a feature test. `apps/subscriptiontracker` is the frozen
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
// ⏱ 2026-09-28 · train ST-D5: the two bullets above now hold for SCAN only.
// DETAIL was rebuilt on the design foundation, which unfreezes its light
// build: its group asserts both brightnesses against the scheme and uses the
// retired light literals as the falsifier instead. See that group's note.
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
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/seed/demo_data.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/features/import/import_screen.dart';
import 'package:subscriptiontracker/features/shared/due.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

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
/// Returns the container so a case can read the same `currencyCodeProvider` the
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
  // sequence, and `pumpAndSettle` would be a lie about why we are waiting.
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
  return c;
}

Color? _textColor(WidgetTester tester, String text) =>
    tester.widget<Text>(find.text(text).first).style?.color;

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
    for (final String code in kSupportedLocaleCodes) {
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
        expect(find.text(l10n.stopOrRemove), findsOneWidget);
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
      // English. (`more_horiz` opens the lifecycle menu — ST-T3b, ST-E3.)
      expect(find.bySemanticsLabel(ta.back), findsOneWidget);
      expect(find.bySemanticsLabel('Back'), findsNothing);
      expect(find.bySemanticsLabel(ta.moreOptions), findsOneWidget);
      expect(find.bySemanticsLabel('More options'), findsNothing);
      handle.dispose();
    });
  });

  group('detail: the date tables are gone', () {
    // ⏱ 2026-09-28 · ST-T3b. Netflix is STORED as renewing 2026-07-22; the
    // screen shows its ROLLED next charge (ST-M3), and its history is DERIVED
    // from the seed's first charge by the platform rule (ST-E1) — this used
    // to pin a fabricated June row. The newest charge heads the list.
    final Subscription netflix = DemoData.subscriptions().firstWhere(
      (Subscription s) => s.id == kNetflixId,
    );
    final DateTime today = DateTime.now();
    final DateTime renewal = netflix.nextCharge(today);
    final DateTime firstPayment = RecurrenceSchedule.rollForward(
      netflix.firstChargeOn!,
      netflix.cycle!,
      DateTime(today.year, today.month, today.day),
    ).crossings.last;

    for (final String code in kSupportedLocaleCodes) {
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
      // 🔴 THE ENGLISH ORACLE IS LOADED EXPLICITLY, AND THE DIRECTION IS THE
      // WHOLE POINT (2026-08-25). This used to be `DueInfo.of(...)`, the
      // English-only factory, deleted in this change. The replacement must NOT
      // be `DueInfo.localized(ta, …)` — that would compare the Tamil render
      // against Tamil, `findsNothing` would be asserting that the screen does
      // not show what it is supposed to show, and the case would pass by being
      // backwards. `en` is the same substitution `of` was: the arb's English
      // values for the three due branches are byte-identical to the strings `of`
      // hardcoded ("Due today", "Renews tomorrow", "In N days" for N >= 2 — the
      // `=1{In 1 day}` arm is unreachable because d == 1 returns
      // renewsTomorrow first).
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
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

      // The mini-card's sub-caption. An un-localized render would show the
      // ENGLISH label under a Tamil locale, so the pair below is what says the
      // call site is localized: the Tamil string is on screen and the English
      // one is not.
      final String expected = DueInfo.localized(ta, netflix, now).label;
      final String englishLabel = DueInfo.localized(en, netflix, now).label;
      expect(
        englishLabel,
        isNot(expected),
        reason:
            'precondition: if Tamil ever rendered this branch identically to '
            'English the two assertions below would pass for the wrong reason',
      );
      expect(find.text(expected), findsOneWidget);
      expect(
        find.text(englishLabel),
        findsNothing,
        reason: 'the English label is still reaching the Tamil detail screen',
      );
    });
  });

  // ⏱ 2026-09-28 · train ST-D5: THE LIGHT HALF OF THIS GROUP PINNED THE FROZEN
  // LEGACY LOOK — `AppColors.ink`/`.muted`/`.line`/`.surface` literals, status
  // colours that did not fork, and a hero of three fixed indigos with white
  // ink. The design train is the change that unfreezes it, so every case below
  // asserts BOTH brightnesses against the scheme (or [StatusTones]) and
  // carries a falsifier against the retired light literal: a revert to the
  // old arm goes red in the light build, where it used to be pinned green.
  group('detail is theme-aware', () {
    for (final ThemeMode mode in <ThemeMode>[ThemeMode.light, ThemeMode.dark]) {
      final ThemeData theme = mode == ThemeMode.light ? lightTheme : darkTheme;
      final ColorScheme scheme = theme.colorScheme;

      testWidgets('[${mode.name}] every ink and fill derives from the scheme', (
        WidgetTester tester,
      ) async {
        final AppLocalizations en = await AppLocalizations.delegate.load(
          const Locale('en'),
        );
        await _pump(
          tester,
          const SubscriptionDetailScreen(id: kNetflixId),
          mode: mode,
        );

        expect(_textColor(tester, en.paymentHistory), scheme.onSurface);
        expect(
          _textColor(tester, en.paymentHistory),
          isNot(AppColors.ink),
          reason:
              'the retired literal heading ink (0xFF141420) — near-black on a '
              'dark scaffold, and a seed-blind colour on a light one',
        );
        expect(_textColor(tester, en.fieldLabelPrice), scheme.onSurfaceVariant);
        expect(_textColor(tester, en.fieldLabelPrice), isNot(AppColors.muted));
        expect(
          tester
              .widget<LinearProgressIndicator>(
                find.byType(LinearProgressIndicator),
              )
              .backgroundColor,
          scheme.surfaceContainerHighest,
          reason: 'the meter track is an opaque container slot in both schemes',
        );
        final Material historyCard = tester.widget<Material>(
          find
              .descendant(
                of: find.byKey(const Key('detail-history-card')),
                matching: find.byType(Material),
              )
              .first,
        );
        expect(
          historyCard.color,
          AppCard.fillOf(theme),
          reason:
              'the payment rows sit on ONE chassis card, whose fill is the '
              'measured container slot for this scheme',
        );
      });

      testWidgets('[${mode.name}] the status word forks by SCHEME, not seed', (
        WidgetTester tester,
      ) async {
        final AppLocalizations en = await AppLocalizations.delegate.load(
          const Locale('en'),
        );
        await _pump(
          tester,
          const SubscriptionDetailScreen(id: kNetflixId),
          mode: mode,
        );
        final StatusTones tones = StatusTones.forBrightness(theme.brightness);
        expect(_textColor(tester, en.usageActive), tones.positive);
        expect(
          _textColor(tester, en.usageActive),
          isNot(AppColors.positive),
          reason:
              'AppColors.positive (#10B981) was the one literal in BOTH '
              'schemes, and as 12px text on the white card it measured 2.54:1 '
              '— the a11y sweep carried a named exemption for it',
        );
      });

      testWidgets('[${mode.name}] the header band derives from the scheme', (
        WidgetTester tester,
      ) async {
        await _pump(
          tester,
          const SubscriptionDetailScreen(id: kNetflixId),
          mode: mode,
        );
        final ColoredBox band = tester.widget<ColoredBox>(
          find
              .descendant(
                of: find.byKey(const Key('detail-header-band')),
                matching: find.byType(ColoredBox),
              )
              .first,
        );
        expect(band.color, scheme.surfaceContainer);
        expect(_textColor(tester, 'Netflix'), scheme.onSurface);
        expect(
          tester.widget<Icon>(find.byIcon(Icons.arrow_back)).color,
          scheme.onSurface,
        );
        expect(
          find.byWidgetPredicate(
            (Widget w) =>
                w is Container &&
                w.decoration is BoxDecoration &&
                (w.decoration! as BoxDecoration).gradient ==
                    AppColors.heroGradient,
          ),
          findsNothing,
          reason:
              'the fixed-indigo hero is retired: it was the one surface on '
              'this route that did not follow the seed, and its white ink was '
              'correct on that gradient only',
        );
      });
    }

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
      // inherits is asserted too.
      expect(darkTheme.scaffoldBackgroundColor, dark.surface);
      expect(darkTheme.scaffoldBackgroundColor, isNot(AppColors.bg));
      expect(lightTheme.scaffoldBackgroundColor, light.surface);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORT (`/import`) — the hub that replaced SCAN (ADR 077 §2.2, IM-01)
  // ═══════════════════════════════════════════════════════════════════════════
  group('import speaks the arb', () {
    for (final String code in kSupportedLocaleCodes) {
      testWidgets('[$code] the hub: title, subtitle, paste, read', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l10n = await AppLocalizations.delegate.load(
          Locale(code),
        );
        await _pump(tester, const ImportScreen(), locale: Locale(code));
        expect(find.text(l10n.importTitle), findsOneWidget);
        expect(find.text(l10n.importSubtitle), findsOneWidget);
        expect(find.text(l10n.importPasteLabel), findsOneWidget);
        expect(find.text(l10n.importRead), findsOneWidget);
        if (code == 'ta') {
          expect(
            find.text('Import subscriptions'),
            findsNothing,
            reason: 'the English title on a Tamil screen: the arb was not read',
          );
        }
      });
    }

    testWidgets('the scaffold INHERITS instead of painting AppColors.bg', (
      WidgetTester tester,
    ) async {
      await _pump(tester, const ImportScreen(), mode: ThemeMode.dark);
      expect(
        tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
        isNull,
        reason:
            'AppColors.bg is 0xFFF4F4F8 — an explicit override would paint '
            'the whole import hub near-white under dark chrome.',
      );
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      expect(_textColor(tester, en.importTitle), dark.onSurface);
      expect(_textColor(tester, en.importTitle), isNot(AppColors.ink));
    });
  });
}
