// ST-T9 (train st-add-catalogue, EN-18) — the after-sign-in setup. Red
// controls:
//   · a first sign-in with an EMPTY list is taken to setup; a list with rows,
//     or an account that has seen it, is not
//   · picking 3 tiles creates 3 prefilled rows (the add sheet's prefill rule)
//   · Skip from the first step writes nothing and marks setup seen
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/firstrun/setup_steps_view.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/setup/setup_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/catalogue_fixture.dart';
import 'support/home_fixture.dart';
import 'support/width_harness.dart';

class _Repo implements SubscriptionRepository {
  _Repo([List<Subscription>? rows]) : rows = rows ?? <Subscription>[];
  final List<Subscription> rows;
  final List<Subscription> added = <Subscription>[];

  @override
  Future<List<Subscription>> fetchAll() async => rows;

  @override
  Future<Subscription> add(Subscription draft) async {
    final Subscription made = draft.patched(<String, dynamic>{
      'id': 'n${added.length}',
    });
    added.add(draft);
    rows.add(made);
    return made;
  }

  @override
  Future<BudgetInfo> budget() async => throw StateError('not under test');

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

class _Seen extends SetupSeenController {
  _Seen(this.value);
  final bool? value;
  bool marked = false;

  @override
  bool? build() => value;

  @override
  Future<void> markSeen() async {
    marked = true;
    state = true;
  }
}

Subscription _row() => Subscription(
  id: '1',
  name: 'Netflix',
  category: 'Streaming',
  price: const Money(64900, 'INR'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2030, 1, 1),
);

Future<void> _pumpRouter(
  WidgetTester tester, {
  required _Repo repo,
  required bool? seen,
}) async {
  await tester.binding.setSurfaceSize(kPhone);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final GoRouter router = GoRouter(
    initialLocation: '/home',
    routes: <RouteBase>[
      GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
      GoRoute(
        path: '/setup',
        builder: (_, _) => const Scaffold(body: Text('SETUP')),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      retry: (int retryCount, Object error) => null,
      overrides: <Override>[
        ...defaultWidthOverrides(),
        subscriptionRepositoryProvider.overrideWithValue(repo),
        nowProvider.overrideWithValue(() => kHomeFixtureNow),
        setupSeenProvider.overrideWith(() => _Seen(seen)),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

void main() {
  group('when setup is offered', () {
    test('only a definite "not seen" with a list that loaded empty', () {
      const AsyncValue<List<Subscription>> empty =
          AsyncData<List<Subscription>>(<Subscription>[]);
      expect(shouldOfferSetup(seen: false, subscriptions: empty), isTrue);
      expect(shouldOfferSetup(seen: null, subscriptions: empty), isFalse);
      expect(shouldOfferSetup(seen: true, subscriptions: empty), isFalse);
      expect(
        shouldOfferSetup(
          seen: false,
          subscriptions: AsyncData<List<Subscription>>(<Subscription>[_row()]),
        ),
        isFalse,
      );
      expect(
        shouldOfferSetup(
          seen: false,
          subscriptions: const AsyncLoading<List<Subscription>>(),
        ),
        isFalse,
      );
      expect(
        shouldOfferSetup(
          seen: false,
          subscriptions: AsyncError<List<Subscription>>(
            StateError('offline'),
            StackTrace.empty,
          ),
        ),
        isFalse,
        reason: 'a failed read is not an empty list',
      );
    });

    testWidgets('a first sign-in with an empty list shows setup', (
      WidgetTester tester,
    ) async {
      await _pumpRouter(tester, repo: _Repo(), seen: false);
      expect(find.text('SETUP'), findsOneWidget);
    });

    testWidgets('a list with rows stays on home', (WidgetTester tester) async {
      await _pumpRouter(
        tester,
        repo: _Repo(<Subscription>[_row()]),
        seen: false,
      );
      expect(find.text('SETUP'), findsNothing);
    });

    testWidgets('an account that has seen it stays on home', (
      WidgetTester tester,
    ) async {
      await _pumpRouter(tester, repo: _Repo(), seen: true);
      expect(find.text('SETUP'), findsNothing);
    });
  });

  group('the setup itself', () {
    late _Seen seen;

    Future<_Repo> open(WidgetTester tester) async {
      final _Repo repo = _Repo();
      seen = _Seen(false);
      await pumpAt(
        tester,
        kPhone,
        SetupScreen(now: () => DateTime(2026, 10, 1)),
        overrides: <Override>[
          subscriptionRepositoryProvider.overrideWithValue(repo),
          ...catalogueOverrides(region: 'IN'),
          setupSeenProvider.overrideWith(() => seen),
        ],
      );
      await tester.pumpAndSettle();
      return repo;
    }

    testWidgets('picking 3 tiles creates 3 prefilled rows', (
      WidgetTester tester,
    ) async {
      final _Repo repo = await open(tester);
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      expect(find.text(en.setupCurrencyTitle), findsOneWidget);
      expect(find.text(en.setupPosition(1, 3)), findsOneWidget);

      // Step 1 · home currency: INR, so the tiles are India-first.
      await tester.tap(find.byKey(SetupKeys.currency));
      await tester.pumpAndSettle();
      await tester.tap(find.text('INR').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(SetupStepsView.advanceButton));
      await tester.pumpAndSettle();
      // Step 2 · reminder channels.
      expect(find.text(en.setupRemindersTitle), findsOneWidget);
      await tester.tap(find.byKey(SetupStepsView.advanceButton));
      await tester.pumpAndSettle();
      // Step 3 · pick what you pay for.
      expect(find.text(en.setupPickTitle), findsOneWidget);
      for (final String id in <String>['jiohotstar', 'netflix', 'spotify']) {
        await tester.ensureVisible(find.byKey(SetupKeys.tile(id)));
        await tester.tap(find.byKey(SetupKeys.tile(id)));
        await tester.pumpAndSettle();
      }
      expect(find.text(en.setupPicked(3)), findsOneWidget);
      await tester.tap(find.byKey(SetupStepsView.advanceButton));
      await tester.pumpAndSettle();

      expect(repo.added, hasLength(3));
      final Map<String, Subscription> byService = <String, Subscription>{
        for (final Subscription s in repo.added) s.serviceId!: s,
      };
      expect(
        byService.keys,
        unorderedEquals(<String>['jiohotstar', 'netflix', 'spotify']),
      );
      final Subscription netflix = byService['netflix']!;
      expect(netflix.name, 'Netflix');
      expect(netflix.category, 'Streaming');
      expect(netflix.categoryId, 'streaming');
      expect(netflix.cycle, Cadence.monthly);
      expect(netflix.cancelUrl, 'https://example.com/netflix/cancel');
      expect(netflix.noticeDays, 1);
      // The pack's INR price where it has one; zero (to fill in) where not.
      expect(netflix.price, const Money(64900, 'INR'));
      expect(byService['spotify']!.price, const Money(0, 'INR'));
      expect(byService['spotify']!.category, 'Music');
      expect(seen.marked, isTrue);
    });

    testWidgets('Skip writes nothing and marks setup seen', (
      WidgetTester tester,
    ) async {
      final _Repo repo = await open(tester);
      await tester.tap(find.byKey(SetupStepsView.skipButton));
      await tester.pumpAndSettle();
      expect(repo.added, isEmpty);
      expect(seen.marked, isTrue);
    });

    testWidgets('Back returns to the previous step', (
      WidgetTester tester,
    ) async {
      await open(tester);
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await tester.tap(find.byKey(SetupStepsView.advanceButton));
      await tester.pumpAndSettle();
      expect(find.text(en.setupPosition(2, 3)), findsOneWidget);
      await tester.tap(find.byKey(SetupStepsView.backButton));
      await tester.pumpAndSettle();
      expect(find.text(en.setupCurrencyTitle), findsOneWidget);
    });
  });
}
