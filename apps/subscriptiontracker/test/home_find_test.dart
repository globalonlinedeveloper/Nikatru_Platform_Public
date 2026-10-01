// HOME FINDS AND DECIDES — train T8 (HO-03..06, SH-02, B8). One red control
// per patch, each on the real `HomeScreen` (or the real shell):
//
//   · HO-03  3 of 12 rows match "net" (name OR notes); "Paused" shows only
//            paused rows
//   · HO-04  6 renewals in 30 days show 4 + "2 more"; crossing local midnight
//            relabels "Renews tomorrow" to "Due today"
//   · HO-05  a trial ending in 3 days has its strip, with ONE action; no strip
//            says "unused"
//   · HO-06  a catalogue row shows the pack's logo; a hand-typed row its
//            monogram
//   · SH-02  N opens the add sheet; / focuses the search field
//   · B8     the empty detail pane says "Select a subscription"
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show LogicalKeyboardKey;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/router.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/home/home_signals.dart';
import 'package:subscriptiontracker/features/shell/app_shell.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

final DateTime _now = DateTime(2026, 9, 28, 9);

Subscription _sub(
  String id,
  String name, {
  int inDays = 40,
  String notes = '',
  SubscriptionStatus status = SubscriptionStatus.active,
  Cadence cycle = BillingCycle.monthly,
  DateTime? trialEndsOn,
  String? serviceId,
  String glyph = '',
  int price = 1000,
}) => Subscription(
  id: id,
  name: name,
  category: 'Other',
  price: Money(price, 'USD'),
  cycle: cycle,
  nextRenewal: _now.add(Duration(days: inDays)),
  notes: notes,
  status: status,
  trialEndsOn: trialEndsOn,
  serviceId: serviceId,
  glyph: glyph,
);

/// Twelve rows; "net" is in two names and one note.
List<Subscription> _twelve() => <Subscription>[
  _sub('1', 'Netflix'),
  _sub('2', 'Spotify', status: SubscriptionStatus.paused),
  _sub('3', 'Internet'),
  _sub('4', 'City Gym', notes: 'Paid with the Planet card'),
  _sub('5', 'iCloud+'),
  _sub('6', 'Adobe CC'),
  _sub('7', 'Notion'),
  _sub('8', 'Audible'),
  _sub('9', 'Kindle', status: SubscriptionStatus.paused),
  _sub('10', 'Xbox'),
  _sub('11', 'Duolingo'),
  _sub('12', 'Canva'),
];

class _Repo implements SubscriptionRepository {
  _Repo(this.rows);
  final List<Subscription> rows;

  @override
  Future<List<Subscription>> fetchAll() async => rows;

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

Future<void> _home(
  WidgetTester tester,
  List<Subscription> rows, {
  List<Override> extra = const <Override>[],
  Size size = const Size(420, 3000),
  bool fixedClock = true,
}) => pumpAt(
  tester,
  size,
  const HomeScreen(),
  overrides: <Override>[
    subscriptionRepositoryProvider.overrideWithValue(_Repo(rows)),
    if (fixedClock) nowProvider.overrideWithValue(() => _now),
    // ST-T9's after-sign-in setup reads the account's "seen" flag through
    // auth; Home's finding and deciding is not about it, so it is settled.
    setupSeenProvider.overrideWith(_SetupSeen.new),
    ...extra,
  ],
);

class _SetupSeen extends SetupSeenController {
  @override
  bool? build() => true;
}

List<String> _allNames(WidgetTester tester) => tester
    .widgetList<AppListRow>(
      find.descendant(
        of: find.byKey(HomeScreen.allKey),
        matching: find.byType(AppListRow),
      ),
    )
    .map((AppListRow r) => r.title)
    .toList();

class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

class _SignedInAuth extends core.AuthRepository {
  @override
  core.AuthUser? get currentUser => const core.AuthUser(
    id: 'keys',
    email: 'keys@test.dev',
    emailVerified: true,
  );

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('HO-03 · search, sort and filter', () {
    testWidgets('🔴 3 of 12 rows match "net" — by name AND by notes', (
      WidgetTester tester,
    ) async {
      await _home(tester, _twelve());
      expect(_allNames(tester), hasLength(12));

      await tester.enterText(find.byKey(HomeScreen.searchFieldKey), 'net');
      await tester.pump();
      expect(_allNames(tester)..sort(), <String>[
        'City Gym',
        'Internet',
        'Netflix',
      ]);
    });

    testWidgets('🔴 filter "Paused" shows only paused rows', (
      WidgetTester tester,
    ) async {
      final AppLocalizations l10n = await _en();
      await _home(tester, _twelve());
      expect(
        find.byType(FilterChip),
        findsNothing,
        reason: 'the chips fold away until asked for',
      );
      await tester.tap(find.byKey(HomeScreen.filterKey));
      await tester.pump();
      await tester.tap(find.widgetWithText(FilterChip, l10n.statusPaused));
      await tester.pump();
      expect(_allNames(tester)..sort(), <String>['Kindle', 'Spotify']);

      // Closing the chips clears them: no hidden filter keeps rows away.
      await tester.tap(find.byKey(HomeScreen.filterKey));
      await tester.pump();
      expect(find.byType(FilterChip), findsNothing);
      expect(_allNames(tester), hasLength(12));
    });

    testWidgets('nothing matching says so, in place of the list', (
      WidgetTester tester,
    ) async {
      final AppLocalizations l10n = await _en();
      await _home(tester, _twelve());
      await tester.enterText(find.byKey(HomeScreen.searchFieldKey), 'zzz');
      await tester.pump();
      expect(find.byKey(HomeScreen.allKey), findsNothing);
      expect(find.text(l10n.homeNoMatches), findsOneWidget);
    });

    testWidgets('sort by name orders A to Z', (WidgetTester tester) async {
      final AppLocalizations l10n = await _en();
      await _home(tester, _twelve());
      await tester.tap(find.byKey(HomeScreen.sortKey));
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(CheckedPopupMenuItem<HomeSort>, l10n.homeSortName),
      );
      await tester.pumpAndSettle();
      final List<String> names = _allNames(tester);
      expect(names.first, 'Adobe CC');
      expect(names.last, 'Xbox');
    });
  });

  group('HO-04 · a month ahead', () {
    testWidgets('🔴 6 renewals in 30 days show 4 + "2 more"', (
      WidgetTester tester,
    ) async {
      final AppLocalizations l10n = await _en();
      await _home(tester, <Subscription>[
        for (int i = 0; i < 6; i++) _sub('u$i', 'Soon $i', inDays: 2 + i * 4),
        _sub('far', 'Far away', inDays: 45),
      ]);
      expect(
        find.descendant(
          of: find.byKey(HomeScreen.upcomingKey),
          matching: find.byType(AppListRow),
        ),
        findsNWidgets(4),
      );
      expect(find.text(l10n.homeUpcomingMore(2)), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(HomeScreen.upcomingKey),
          matching: find.text('Far away'),
        ),
        findsNothing,
        reason: 'a charge past the 30-day horizon is not "upcoming"',
      );
    });

    testWidgets('🔴 crossing local midnight relabels "Renews tomorrow"', (
      WidgetTester tester,
    ) async {
      final AppLocalizations l10n = await _en();
      DateTime clock = DateTime(2026, 9, 28, 23, 59);
      await _home(
        tester,
        <Subscription>[
          Subscription(
            id: 'm',
            name: 'Midnight',
            category: 'Other',
            price: const Money(500, 'USD'),
            cycle: BillingCycle.monthly,
            nextRenewal: DateTime(2026, 9, 29),
          ),
        ],
        fixedClock: false,
        extra: <Override>[
          nowProvider.overrideWith(
            (Ref ref) =>
                () => clock,
          ),
        ],
      );
      Finder inUpcoming(String text) => find.descendant(
        of: find.byKey(HomeScreen.upcomingKey),
        matching: find.text(text),
      );
      expect(inUpcoming(l10n.renewsTomorrow), findsOneWidget);

      clock = DateTime(2026, 9, 29, 0, 0, 30);
      await tester.pump(const Duration(minutes: 2));
      await tester.pump();
      expect(inUpcoming(l10n.dueToday), findsOneWidget);
      expect(inUpcoming(l10n.renewsTomorrow), findsNothing);
    });

    test('untilLocalMidnight is the rest of the local day', () {
      expect(
        untilLocalMidnight(DateTime(2026, 9, 28, 23, 59)),
        const Duration(minutes: 1),
      );
      expect(
        untilLocalMidnight(DateTime(2026, 9, 28, 23, 59, 59, 999)),
        const Duration(seconds: 1),
        reason: 'never a zero-length tick',
      );
    });
  });

  group('HO-05 · decisions that act', () {
    testWidgets('🔴 a trial ending in 3 days has its strip, with ONE action', (
      WidgetTester tester,
    ) async {
      final AppLocalizations l10n = await _en();
      await _home(tester, <Subscription>[
        _sub(
          't',
          'Trialist',
          status: SubscriptionStatus.trialing,
          trialEndsOn: _now.add(const Duration(days: 3)),
        ),
        _sub('x', 'Ordinary'),
      ]);
      final Finder strip = find.byKey(
        HomeScreen.signalKey(HomeSignalKind.trialEnding, 't'),
      );
      expect(strip, findsOneWidget);
      expect(
        find.text(l10n.homeSignalTrialEnds('Trialist', 3)),
        findsOneWidget,
      );
      final DecisionStrip w = tester.widget<DecisionStrip>(strip);
      expect(w.actions, hasLength(1));
      expect(w.actions.single.label, l10n.homeSignalOpen);
      expect(find.byType(DecisionStrip), findsOneWidget);
    });

    testWidgets('🔴 no strip reads "unused" — whichever signal is on', (
      WidgetTester tester,
    ) async {
      final Subscription rarely = Subscription(
        id: 'r',
        name: 'Rarely',
        category: 'Other',
        price: const Money(900, 'USD'),
        cycle: BillingCycle.monthly,
        nextRenewal: _now.add(const Duration(days: 40)),
        unused: true,
      );
      for (final List<Subscription> rows in <List<Subscription>>[
        <Subscription>[
          _sub(
            't',
            'Trialist',
            status: SubscriptionStatus.trialing,
            trialEndsOn: _now.add(const Duration(days: 3)),
          ),
          rarely,
        ],
        <Subscription>[
          _sub('y', 'Yearly', cycle: BillingCycle.yearly, inDays: 30),
          rarely,
        ],
        <Subscription>[rarely],
      ]) {
        await _home(tester, rows);
        expect(
          find.byType(DecisionStrip),
          findsOneWidget,
          reason: 'Home asks ONE decision at a time, the most urgent',
        );
        for (final Element e
            in find
                .descendant(
                  of: find.byType(DecisionStrip),
                  matching: find.byType(Text),
                )
                .evaluate()) {
          final String text = (e.widget as Text).data ?? '';
          expect(text.toLowerCase(), isNot(contains('unused')));
        }
      }
    });

    test('the most urgent signal comes first', () {
      final List<HomeSignal> s = HomeSignals.of(
        <Subscription>[
          Subscription(
            id: 'r',
            name: 'Rarely',
            category: 'Other',
            price: const Money(900, 'USD'),
            cycle: BillingCycle.monthly,
            nextRenewal: _now.add(const Duration(days: 40)),
            unused: true,
          ),
          _sub('y', 'Yearly', cycle: BillingCycle.yearly, inDays: 30),
          _sub(
            't',
            'Trialist',
            status: SubscriptionStatus.trialing,
            trialEndsOn: _now.add(const Duration(days: 3)),
          ),
        ],
        _now,
        stillUsing: (Subscription s) => s.id == 'r',
      );
      expect(s.map((HomeSignal x) => x.kind), <HomeSignalKind>[
        HomeSignalKind.trialEnding,
        HomeSignalKind.yearlyDue,
        HomeSignalKind.stillUsing,
      ]);
    });

    test('the signal horizons are boundaries, both sides', () {
      List<HomeSignalKind> kinds(List<Subscription> s) =>
          HomeSignals.of(s, _now).map((HomeSignal x) => x.kind).toList();
      Subscription trial(int d) => _sub(
        't$d',
        'T',
        status: SubscriptionStatus.trialing,
        trialEndsOn: _now.add(Duration(days: d)),
      );
      expect(kinds(<Subscription>[trial(7)]), <HomeSignalKind>[
        HomeSignalKind.trialEnding,
      ]);
      expect(kinds(<Subscription>[trial(8)]), isEmpty);
      Subscription yearly(int d) =>
          _sub('y$d', 'Y', cycle: BillingCycle.yearly, inDays: d);
      expect(kinds(<Subscription>[yearly(60)]), <HomeSignalKind>[
        HomeSignalKind.yearlyDue,
      ]);
      expect(kinds(<Subscription>[yearly(61)]), isEmpty);
      // A monthly plan is never a "yearly plan due".
      expect(kinds(<Subscription>[_sub('m', 'M', inDays: 5)]), isEmpty);
    });

    test('a price that rose since the last charge is a signal', () {
      final Subscription rose = Subscription.fromJson(<String, dynamic>{
        'id': 'p',
        'name': 'Pricey',
        'price_minor': 1299,
        'currency': 'USD',
        'cycle': 'monthly',
        'next_renewal': '2026-10-20',
        'price_history': <Map<String, dynamic>>[
          <String, dynamic>{
            'old_price_minor': 999,
            'new_price_minor': 1299,
            'old_currency': 'USD',
            'new_currency': 'USD',
          },
        ],
      });
      expect(rose.previousPrice, const Money(999, 'USD'));
      final List<HomeSignal> s = HomeSignals.of(<Subscription>[rose], _now);
      expect(s.single.kind, HomeSignalKind.priceRose);
      expect(s.single.was, const Money(999, 'USD'));

      final Subscription fell = Subscription.fromJson(<String, dynamic>{
        'id': 'q',
        'name': 'Cheaper',
        'price_minor': 499,
        'currency': 'USD',
        'cycle': 'monthly',
        'next_renewal': '2026-10-20',
        'price_history': <Map<String, dynamic>>[
          <String, dynamic>{'old_price_minor': 999, 'old_currency': 'USD'},
        ],
      });
      expect(HomeSignals.of(<Subscription>[fell], _now), isEmpty);
    });
  });

  group('HO-06 · logos', () {
    testWidgets('🔴 a catalogue row shows the logo; a typed row its monogram', (
      WidgetTester tester,
    ) async {
      await _home(
        tester,
        <Subscription>[
          _sub('a', 'Netflix', serviceId: 'netflix', glyph: 'NFX'),
          _sub('b', 'Corner Shop', glyph: 'CSH'),
        ],
        extra: <Override>[
          // The test pack: one logo, at an asset the app already bundles.
          serviceLogoAssetsProvider.overrideWithValue(const <String, String>{
            'netflix': 'assets/brand/nikatru-logo.png',
          }),
        ],
      );
      Finder rowOf(String name) =>
          find.ancestor(of: find.text(name), matching: find.byType(AppListRow));
      expect(
        find.descendant(
          of: rowOf('Netflix').first,
          matching: find.byType(Image),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: rowOf('Netflix').first, matching: find.text('NFX')),
        findsNothing,
      );
      expect(
        find.descendant(
          of: rowOf('Corner Shop').first,
          matching: find.byType(Image),
        ),
        findsNothing,
      );
      expect(
        find.descendant(
          of: rowOf('Corner Shop').first,
          matching: find.text('CSH'),
        ),
        findsOneWidget,
      );
    });

    test('service_id round-trips the wire; an empty one is no id', () {
      final Subscription s = _sub('a', 'Netflix', serviceId: 'netflix');
      expect(Subscription.fromJson(s.toJson()).serviceId, 'netflix');
      expect(_sub('b', 'Typed').toJson().containsKey('service_id'), isFalse);
      final Map<String, dynamic> j = s.toJson()..['service_id'] = '';
      expect(Subscription.fromJson(j).serviceId, isNull);
    });
  });

  group('B8 · the empty detail pane', () {
    testWidgets('says "Select a subscription"', (WidgetTester tester) async {
      final AppLocalizations l10n = await _en();
      await _home(tester, _twelve(), size: const Size(1100, 2400));
      expect(find.text(l10n.homeSelectSubscription), findsOneWidget);
    });
  });

  group('SH-02 · desktop keys', () {
    Future<ProviderContainer> shell(WidgetTester tester) async {
      await setSurface(tester, kDesktop);
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          ...defaultWidthOverrides(),
          onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
          legalReacceptanceNeededProvider.overrideWithValue(false),
          authRepositoryProvider.overrideWithValue(_SignedInAuth()),
          analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
          apiClientProvider.overrideWithValue(SeedApiClient()),
          nowProvider.overrideWithValue(() => _now),
        ],
      );
      addTearDown(c.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp.router(
            localizationsDelegates: <LocalizationsDelegate<dynamic>>[
              ...AppLocalizations.localizationsDelegates,
              ChassisLocalizations.delegate,
            ],
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: c.read(routerProvider),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(AppShell), findsOneWidget);
      return c;
    }

    testWidgets('🔴 pressing N opens the add sheet', (
      WidgetTester tester,
    ) async {
      await shell(tester);
      expect(find.byType(SubscriptionFormSheet), findsNothing);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pumpAndSettle();
      expect(find.byType(SubscriptionFormSheet), findsOneWidget);
    });

    testWidgets('🔴 / focuses the search field', (WidgetTester tester) async {
      await shell(tester);
      EditableText field() => tester.widget<EditableText>(
        find.descendant(
          of: find.byKey(HomeScreen.searchFieldKey),
          matching: find.byType(EditableText),
        ),
      );
      expect(field().focusNode.hasFocus, isFalse);
      await tester.sendKeyEvent(LogicalKeyboardKey.slash, character: '/');
      await tester.pumpAndSettle();
      expect(field().focusNode.hasFocus, isTrue);
      expect(
        field().controller.text,
        isEmpty,
        reason: 'the / that focused the field is not typed into it',
      );
    });
  });
}
