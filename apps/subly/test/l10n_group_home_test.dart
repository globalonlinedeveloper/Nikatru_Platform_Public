// ─────────────────────────────────────────────────────────────────────────────
// P4·L3 — THE HOME GROUP SPEAKS BOTH LOCALES: home, the shell, notifications.
//
// 🔴 EVERY CASE RUNS IN EN **AND** TA, AND THE ENGLISH HALF ALONE IS WORTHLESS
// HERE. The arb values for this group were minted to be byte-identical to the
// literals they replaced — "Good morning" is `greetingMorning`, "Active" is
// `usageActive`, "3 marked unused" is `markedUnusedCount(3)` — precisely so the
// shipped English copy does not move. That is the right call for the product and
// it makes an English-only assertion TAUTOLOGICAL: a screen that never touched
// the arb would pass every [en] case in this file.
//
// Tamil is what makes them able to fail, so every [ta] case also asserts that
// the pre-l10n English literal is `findsNothing`. That pair — the arb string is
// present AND the old literal is gone — is the actual property.
//
// ── THE THREE PLURALS THIS GROUP OWNS ────────────────────────────────────────
// `markedUnusedCount` (home), `activeCount` (home), `notifUnusedCount` +
// `notifCancellingSaves` + `notifRenewsInDays` (notifications) are five of the
// app's first nine plural keys, and two of them are the interesting kind: their
// arms carry WHOLE CLAUSES rather than a noun, because what was there before
// agreed a verb ("plan is" / "plans are") and swapped a pronoun ("it" / "them")
// with inline Dart ternaries. That is English grammar written as control flow.
// The tests below therefore exercise BOTH arms of each key from the SAME screen
// — a one-item fixture and a two-item one — because a plural asserted at one
// cardinality only is a plural nothing is using.
//
// ── WHY A FIXTURE CLIENT AND NOT THE SEED DATA ───────────────────────────────
// `SeedApiClient`'s twelve demo rows carry ABSOLUTE renewal dates (2026-07-22 …
// 2026-09-02), so which of them is "due in N days" — and therefore which plural
// arm renders — depends on the day the suite runs. `_FixedClient` below derives
// its dates from today, so both arms are reachable on every wall clock.
//
// ⚠️ THE ONE CLOCK ASSUMPTION LEFT: the test and the screen each call
// `DateTime.now()`, so a run that straddles midnight between the two would shift
// every day-count by one. The dates are built at local midnight and compared
// date-to-date (`Subscription.daysUntil` truncates), so the window is the few
// hundred milliseconds of the pump. Named rather than engineered away: the
// alternative is an injectable clock through three screens for a flake nobody
// has seen.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/core/format/currency.dart';
import 'package:subly/core/format/sub_math.dart';
import 'package:subly/core/router.dart';
import 'package:subly/data/api/seed_api_client.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/features/home/home_screen.dart';
import 'package:subly/features/notifications/notifications_screen.dart';
import 'package:subly/features/shell/app_shell.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';
import 'package:subly/state/settings_controller.dart' show currencyProvider;

import 'support/width_harness.dart';

const Color kSublySeed = Color(0xFF6459F5);

/// Local midnight today — see the header's clock note.
DateTime get _today {
  final DateTime n = DateTime.now();
  return DateTime(n.year, n.month, n.day);
}

Subscription _sub(
  String id,
  String name, {
  required int inDays,
  required double price,
  BillingCycle cycle = BillingCycle.monthly,
  int usedPct = 50,
  bool unused = false,
}) => Subscription(
  id: id,
  name: name,
  category: 'Streaming',
  price: price,
  cycle: cycle,
  nextRenewal: _today.add(Duration(days: inDays)),
  glyph: name.substring(0, 3).toUpperCase(),
  usedPct: usedPct,
  unused: unused,
);

/// A clock-relative subscription set. [unusedCount] is 1 or 2 so both arms of
/// every count-driven plural on these screens are reachable.
///
/// Subclasses [SeedApiClient] rather than reimplementing `ApiClient`: only
/// `getSubscriptions` matters to these three screens, and the eight other
/// methods would be eight chances to write a fake that drifts from the real
/// interface.
class _FixedClient extends SeedApiClient {
  _FixedClient({required this.unusedCount});
  final int unusedCount;

  @override
  Future<List<Subscription>> getSubscriptions() async => <Subscription>[
    // Renews TOMORROW: the `=1` arm of notifRenewsInDays, and DueInfo's
    // `renewsTomorrow` branch.
    _sub('a', 'Alpha', inDays: 1, price: 10, usedPct: 90),
    // Renews in 3 days: the `other` arm, same screen, same run.
    _sub('b', 'Beta', inDays: 3, price: 20, usedPct: 30),
    // Far out, so they never enter the 7-day window and only ever drive the
    // unused plurals.
    _sub('c', 'Gamma', inDays: 40, price: 30, usedPct: 4, unused: true),
    if (unusedCount > 1)
      _sub('d', 'Delta', inDays: 50, price: 40, usedPct: 2, unused: true),
  ];
}

class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

class _SignedInAuth implements core.AuthRepository {
  @override
  core.AuthUser? get currentUser =>
      const core.AuthUser(id: 'l10n', email: 'l10n@test.dev');

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Hosts [screen] in [locale] against a [_FixedClient] with [unusedCount] flagged
/// rows, and hands back the container so a case can read the SAME `Currency` and
/// `SubMath` the screen used rather than restating a formatted number.
Future<ProviderContainer> _pumpScreen(
  WidgetTester tester,
  Locale locale,
  Widget screen, {
  int unusedCount = 2,
}) async {
  // 🔴 A TALL SURFACE, AND IT IS LOAD-BEARING RATHER THAN COSMETIC. Home is a
  // lazy `ListView`: at flutter_test's default 800×600 the hero alone reaches
  // the fold, so "All subscriptions" and every row under it are NEVER BUILT and
  // `find.text` reports them missing — a red that names the copy and says
  // nothing about the cause. 2400px is taller than the whole dashboard for this
  // fixture, so every call site under test is in the element tree.
  await tester.binding.setSurfaceSize(const Size(420, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      apiClientProvider.overrideWithValue(
        _FixedClient(unusedCount: unusedCount),
      ),
    ],
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
        home: Scaffold(body: screen),
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
  return c;
}

/// The whole app through its real router, pinned to a phone so the COMPACT nav
/// pill (and therefore the five tab labels) is the bar that renders. At the
/// flutter_test default of 800×600 the chassis draws a RAIL instead, and the
/// labels would be asserted on a surface the phone user never sees.
Future<void> _pumpShell(WidgetTester tester, Locale locale) async {
  await tester.binding.setSurfaceSize(kPhone);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
      authRepositoryProvider.overrideWithValue(_SignedInAuth()),
      analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: kSublySeed),
        routerConfig: c.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
  expect(find.byType(AppShell), findsOneWidget);
}

Future<AppLocalizations> _l10n(String code) =>
    AppLocalizations.delegate.load(Locale(code));

void main() {
  // ───────────────────────────────────────────────────────────────────────────
  group('home reads its copy from the arb', () {
    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] greeting · plurals · hero · rows', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l = await _l10n(code);
        final ProviderContainer c = await _pumpScreen(
          tester,
          Locale(code),
          const HomeScreen(),
        );
        final Currency currency = c.read(currencyProvider);
        final List<Subscription> subs = await _FixedClient(
          unusedCount: 2,
        ).getSubscriptions();

        // ── The greeting. Which of the three renders depends on the hour, and
        // the 12/18 boundaries stay in Dart on purpose (a locale that divides
        // the day differently needs a different RULE, not a different string).
        // So the property is "exactly one of the three arb greetings is on
        // screen" — which in [ta] is unsatisfiable unless the arb is what the
        // screen read.
        final int greetings = <String>[
          l.greetingMorning,
          l.greetingAfternoon,
          l.greetingEvening,
        ].where((String s) => find.text(s).evaluate().isNotEmpty).length;
        expect(
          greetings,
          1,
          reason: 'exactly one time-of-day greeting must render, from the arb',
        );

        // ── PLURAL 1: markedUnusedCount, fed the count the screen computed.
        expect(
          find.text(l.markedUnusedCount(SubMath.unused(subs).length)),
          findsOneWidget,
          reason:
              'the unused banner must render the plural for the REAL count '
              '(${SubMath.unused(subs).length}); feeding the key a different '
              'number renders a different sentence and this goes red',
        );
        expect(
          find.text(l.cancelToSave(currency.fmt(SubMath.savings(subs)))),
          findsOneWidget,
        );

        // ── PLURAL 2: activeCount, in the hero pill.
        expect(find.text(l.activeCount(subs.length)), findsOneWidget);

        // ── The hero's labels and the two stat boxes.
        expect(find.text(l.monthlySpend), findsOneWidget);
        expect(find.text(l.dueIn7Days), findsOneWidget);
        expect(find.text(l.dueIn30Days), findsOneWidget);
        expect(
          find.text(
            l.perYearTotal(currency.fmt0(SubMath.totalMonthly(subs) * 12)),
          ),
          findsOneWidget,
        );

        // ── Section headers and the calendar link (the arrow is now an Icon).
        expect(find.text(l.upcomingRenewals), findsOneWidget);
        expect(find.text(l.allSubscriptions), findsOneWidget);
        expect(find.text(l.calendarLink), findsOneWidget);
        expect(
          find.descendant(
            of: find.byType(GestureDetector),
            matching: find.byIcon(Icons.arrow_forward),
          ),
          findsWidgets,
          reason:
              'the baked "→" left the string and became a matchTextDirection '
              'icon; deleting it would leave a bare word where an affordance '
              'was',
        );

        // ── Usage words and the per-cycle suffixes on the rows.
        expect(find.text('Streaming · ${l.usageActive}'), findsOneWidget);
        expect(find.text('Streaming · ${l.usageOccasional}'), findsOneWidget);
        expect(find.text('Streaming · ${l.usageRarelyUsed}'), findsWidgets);
        expect(find.text(l.perMonth), findsWidgets);

        // ── DueInfo.localized is now what the rows read (the L1 migration).
        // Alpha renews tomorrow; Beta in 3 days — so both the dedicated
        // `renewsTomorrow` branch and the plural branch render on one screen.
        expect(find.text(l.renewsTomorrow), findsOneWidget);
        expect(find.text(l.dueInDays(3)), findsOneWidget);
      });
    }

    testWidgets('[ta] the pre-l10n English literals are GONE', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, const Locale('ta'), const HomeScreen());

      // THE FALSIFIER. Every string below is exactly what this file rendered
      // before the extraction; each one surviving into a Tamil build would mean
      // that call site never reached the arb.
      for (final String english in <String>[
        'Good morning',
        'Good afternoon',
        'Good evening',
        'MONTHLY SPEND',
        'DUE IN 7 DAYS',
        'DUE IN 30 DAYS',
        'Upcoming renewals',
        'All subscriptions',
        'Calendar →',
        'per month',
        'per year',
        'Renews tomorrow',
      ]) {
        expect(
          find.text(english),
          findsNothing,
          reason: '"$english" survived into a Tamil build',
        );
      }
      expect(
        find.textContaining('marked unused'),
        findsNothing,
        reason: 'the unused plural is still rendering its English arm',
      );
    });

    testWidgets('the plural keys really pluralize', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await _l10n('en');
      // Pins the ARB, not the screen: if `markedUnusedCount` were ever
      // "simplified" back to an interpolation, the two cardinalities would
      // collapse and every assertion above would still pass.
      expect(en.markedUnusedCount(1), isNot(en.markedUnusedCount(2)));
      expect(en.markedUnusedCount(1), '1 marked unused');
      expect(en.markedUnusedCount(2), '2 marked unused');
    });

    testWidgets('the ONE-unused screen renders the singular arm', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await _l10n('en');
      await _pumpScreen(
        tester,
        const Locale('en'),
        const HomeScreen(),
        unusedCount: 1,
      );
      expect(find.text(en.markedUnusedCount(1)), findsOneWidget);
      expect(
        find.text(en.markedUnusedCount(2)),
        findsNothing,
        reason:
            'the count fed to the key must be the real one — a hardcoded 2 '
            'would pass the two-unused case above and fail here',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the shell reads its chrome from the arb', () {
    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] five tab labels, the demo banner and the FAB', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l = await _l10n(code);
        await _pumpShell(tester, Locale(code));

        // The five labels. `_tabs` stopped being a `static const` for exactly
        // this: a const list cannot hold a value that depends on the resolved
        // Localizations, and `destinations:` is what the rail, the drawer and
        // every screen reader read.
        for (final String label in <String>[
          l.navHome,
          l.navCalendar,
          l.navInsights,
          l.navBudget,
          l.navMore,
        ]) {
          expect(
            find.descendant(
              of: find.byKey(AppShell.navPillKey),
              matching: find.text(label),
            ),
            findsOneWidget,
            reason: '[$code] tab label "$label" is not on the compact pill',
          );
        }

        // The demo-data marker — the honesty banner, which shipped in English
        // only. `AppConfig.isApiConfigured` is false under test, so it renders.
        expect(find.text(l.demoDataBanner), findsOneWidget);

        // The FAB's tooltip is what a screen reader announces for an icon-only
        // control, and it REUSES the add sheet's own title key so the control
        // and the surface it opens cannot drift into two words for one action.
        expect(
          tester.widget<Tooltip>(find.byType(Tooltip)).message,
          l.addSubscriptionTitle,
        );
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 🔴 THE COLLISION THIS INCREMENT CREATES, PINNED SO NOBODY REDISCOVERS IT
    // FROM A FAILING E2E.
    //
    // Home's section link was the literal `'Calendar →'`; the arb key
    // `calendarLink` drops the baked arrow (it is a left-to-right glyph in
    // copy — see the comment at the call site), so its value is the bare word
    // "Calendar". The compact nav pill's second tab is ALSO "Calendar", via
    // `navCalendar`. Both render on /home at the same time, so the app now has
    // TWO `Text('Calendar')` on its first screen where it had one.
    //
    // Nothing is wrong with that — they are two different affordances that
    // legitimately share a word — but it makes a bare `find.text('Calendar')`
    // AMBIGUOUS, and `integration_test/app_test.dart:386` used to tap exactly
    // that. `tester.tap` on a two-widget finder throws, so the E2E's Calendar
    // step had to start targeting the nav icon instead. This case is the reason
    // that edit exists; if the copy ever diverges again, this goes red and the
    // E2E can be simplified back.
    testWidgets('"Calendar" is now ambiguous on /home — by design', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await _l10n('en');
      await _pumpShell(tester, const Locale('en'));

      expect(en.calendarLink, en.navCalendar);
      expect(
        find.text(en.navCalendar),
        findsNWidgets(2),
        reason:
            'one on the nav pill, one as home\'s "Upcoming renewals" link — a '
            'bare find.text() on this word can no longer be tapped',
      );
      expect(
        find.byIcon(Icons.calendar_month_rounded),
        findsOneWidget,
        reason:
            'the nav icon is the unambiguous handle app_test.dart:386 switched '
            'to; a second use of this icon anywhere would take that away',
      );
    });

    testWidgets('[ta] the pre-l10n English chrome is GONE', (
      WidgetTester tester,
    ) async {
      await _pumpShell(tester, const Locale('ta'));
      for (final String english in <String>[
        'Calendar',
        'Insights',
        'Budget',
        'More',
        'Demo data - sample subscriptions, not your account',
      ]) {
        expect(
          find.text(english),
          findsNothing,
          reason: '"$english" survived into a Tamil build',
        );
      }
      expect(
        tester.widget<Tooltip>(find.byType(Tooltip)).message,
        isNot('Add subscription'),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('notifications reads its copy from the arb', () {
    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] whole-clause plurals and a formatted date', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l = await _l10n(code);
        final ProviderContainer c = await _pumpScreen(
          tester,
          Locale(code),
          const NotificationsScreen(),
        );
        final Currency currency = c.read(currencyProvider);
        final DateFormat fmt = DateFormat.yMd(code);

        expect(find.text(l.notifications), findsOneWidget);

        // ── PLURAL, `=1` arm: Alpha renews tomorrow.
        expect(find.text(l.notifRenewsInDays('Alpha', 1)), findsOneWidget);
        // ── PLURAL, `other` arm: Beta in 3 days. Both arms, one screen.
        expect(find.text(l.notifRenewsInDays('Beta', 3)), findsOneWidget);

        // ── 🔴 THE DATE. This was
        // `'${d.day}/${d.month}/${d.year}'` — day-first for every locale,
        // including `en`, where it silently means the wrong month for eleven
        // days out of twelve. `DateFormat.yMd` is the fix and the LOCALE is
        // what makes the assertion able to fail: the two locales format the
        // same instant differently.
        expect(
          find.text(
            l.notifChargeOn(
              currency.fmt(10),
              fmt.format(_today.add(const Duration(days: 1))),
            ),
          ),
          findsOneWidget,
        );

        // ── PLURAL with a VERB inside the arm ("plan is" / "plans are").
        expect(find.text(l.notifUnusedCount(2)), findsOneWidget);
        // ── PLURAL with a PRONOUN inside the arm ("it" / "them").
        final List<Subscription> subs = await _FixedClient(
          unusedCount: 2,
        ).getSubscriptions();
        expect(
          find.text(
            l.notifCancellingSaves(2, currency.fmt(SubMath.savings(subs))),
          ),
          findsOneWidget,
        );
      });
    }

    testWidgets('the singular arms render at count 1', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await _l10n('en');
      await _pumpScreen(
        tester,
        const Locale('en'),
        const NotificationsScreen(),
        unusedCount: 1,
      );
      expect(find.text(en.notifUnusedCount(1)), findsOneWidget);
      expect(
        find.textContaining('plans are'),
        findsNothing,
        reason:
            'the verb must agree with the count. "1 plans are marked unused" '
            'is what an interpolation produces and what the plural removes.',
      );
      expect(
        find.textContaining('Cancelling it would save'),
        findsOneWidget,
        reason: 'and the pronoun with it — "them" at count 1 was the old bug',
      );
    });

    testWidgets('[ta] the pre-l10n English literals are GONE', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(
        tester,
        const Locale('ta'),
        const NotificationsScreen(),
      );
      for (final String fragment in <String>[
        'renews in',
        'marked unused',
        'Cancelling',
        'Notifications',
      ]) {
        expect(
          find.textContaining(fragment),
          findsNothing,
          reason: '"$fragment" survived into a Tamil build',
        );
      }
    });

    // ── THE DATE-ORDER FIX, PINNED WHERE IT CAN ACTUALLY FAIL ────────────────
    //
    // ⚠️ THE OBVIOUS VERSION OF THIS TEST DOES NOT WORK, and finding that out
    // was worth more than the assertion it replaced. The first draft asserted,
    // on the TAMIL screen, that `'${d.day}/${d.month}/${d.year}'` was
    // `findsNothing` — and it failed, correctly: Tamil's `yMd` pattern IS
    // `d/M/y`, so the formatter's own output is character-identical to the
    // concatenation it replaced. A falsifier the FIXED code cannot satisfy is
    // not a falsifier; and on any date where day == month it would have been
    // unfalsifiable in the other direction too.
    //
    // So the property is pinned at the FORMATTER, on a fixed date whose day and
    // month differ. `en` is month-first, `ta` is day-first — which is exactly
    // why the concatenation was a BUG and not a style: it rendered every date
    // in Indian order to an American reader, silently, for eleven days in
    // twelve. The rendering half is covered above, where each locale's screen
    // is matched against that same locale's formatter.
    testWidgets('yMd is locale-dependent, and en is NOT the old d/m/y', (
      WidgetTester tester,
    ) async {
      final DateTime d = DateTime(2026, 8, 10);
      const String oldConcatenation = '10/8/2026';

      expect(
        DateFormat.yMd('en').format(d),
        '8/10/2026',
        reason: 'en is month-first',
      );
      expect(
        DateFormat.yMd('en').format(d),
        isNot(oldConcatenation),
        reason:
            'THE SHIPPED BUG: the hardcoded d/m/y rendered 10 August as '
            '"10/8/2026", which an en reader reads as 10 October.',
      );
      expect(
        DateFormat.yMd('ta').format(d),
        isNot(DateFormat.yMd('en').format(d)),
        reason:
            'and the two locales must disagree, or localising the date bought '
            'nothing',
      );
    });

    testWidgets('the dead time-stamp Text is gone with its field', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(
        tester,
        const Locale('en'),
        const NotificationsScreen(),
      );
      // Each card is now exactly TWO Texts — title and body. The third rendered
      // `n.time.toUpperCase()` with `n.time` empty at both construction sites:
      // a zero-width Text plus a 6px gap on every card, invisible and
      // untestable. `_Notif.time` went with it.
      final Finder cards = find.descendant(
        of: find.byType(ListView),
        matching: find.byType(Column),
      );
      expect(cards, findsWidgets);
      expect(
        find.descendant(of: cards.first, matching: find.byType(Text)),
        findsNWidgets(2),
        reason:
            'a third Text here means the dead time stamp came back — or that '
            'a real one was added without a key to read it from',
      );
      expect(
        find.text(''),
        findsNothing,
        reason: 'no empty Text should be laid out on this screen at all',
      );
    });
  });
}
