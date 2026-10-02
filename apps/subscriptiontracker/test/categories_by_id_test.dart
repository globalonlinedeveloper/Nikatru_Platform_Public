// ST-T9 (train st-add-catalogue, AD-05) — categories BY ID. Red controls:
//   · renaming a category keeps its budget cap and its rows (the seed twin of
//     routes/categories.ts PATCH's one batch), and a built-in cannot be renamed
//   · `ta` shows the Tamil built-in names in the add sheet's picker
//   · Settings › Categories adds, renames and deletes the user's own
//   · a pick from the catalogue files the row by id (`category_id`)
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/category.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/features/settings/categories_manager.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/catalogue_fixture.dart';
import 'support/width_harness.dart';

const Color kSublySeed = Color(0xFF6459F5);

Subscription _gymRow() => Subscription(
  id: '',
  name: 'Gym',
  category: 'Gym',
  price: const Money(150000, 'INR'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2030, 1, 5),
);

Future<void> _host(
  WidgetTester tester,
  SeedApiClient api,
  void Function(BuildContext) open, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = kPhone;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        ...defaultWidthOverrides(),
        ...catalogueOverrides(),
        apiClientProvider.overrideWithValue(api),
      ],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: kSublySeed),
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => Center(
              child: TextButton(
                onPressed: () => open(context),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  group('the API twin', () {
    test('renaming a category keeps its cap and its rows', () async {
      final SeedApiClient api = SeedApiClient();
      final SubscriptionCategory gym = await api.createCategory('Gym');
      final Subscription row = await api.createSubscription(
        _gymRow().patched(<String, dynamic>{'category_id': gym.id}),
      );
      final BudgetInfo before = await api.getBudget();
      await api.updateBudget(
        BudgetInfo(
          monthlyBudget: before.monthlyBudget,
          categories: <BudgetCap>[
            ...before.categories,
            BudgetCap('Gym', Money(2000, before.currencyCode)),
          ],
        ),
      );

      await api.renameCategory(gym.id, 'Gym & Yoga');

      final Subscription after = (await api.getSubscriptions()).firstWhere(
        (Subscription s) => s.id == row.id,
      );
      expect(after.category, 'Gym & Yoga');
      expect(after.categoryId, gym.id);
      final List<BudgetCap> caps = (await api.getBudget()).categories;
      expect(caps.map((BudgetCap c) => c.name), contains('Gym & Yoga'));
      expect(caps.map((BudgetCap c) => c.name), isNot(contains('Gym')));
      expect(
        caps.firstWhere((BudgetCap c) => c.name == 'Gym & Yoga').cap,
        Money(2000, before.currencyCode),
      );
      expect(
        (await api.getCategories()).map((SubscriptionCategory c) => c.name),
        containsAll(<String>['Streaming', 'Gym & Yoga']),
      );
    });

    test('a built-in cannot be renamed or deleted', () async {
      final SeedApiClient api = SeedApiClient();
      await expectLater(
        api.renameCategory('streaming', 'Video'),
        throwsA(
          isA<ApiException>().having(
            (ApiException e) => e.statusCode,
            'status',
            403,
          ),
        ),
      );
      await expectLater(
        api.deleteCategory('streaming'),
        throwsA(isA<ApiException>()),
      );
    });

    test('deleting a category leaves its rows uncategorised', () async {
      final SeedApiClient api = SeedApiClient();
      final SubscriptionCategory gym = await api.createCategory('Gym');
      final Subscription row = await api.createSubscription(_gymRow());
      await api.deleteCategory(gym.id);
      final Subscription after = (await api.getSubscriptions()).firstWhere(
        (Subscription s) => s.id == row.id,
      );
      expect(after.category, 'Other');
      expect(after.categoryId, isNull);
    });

    test('the row carries category_id on the wire', () {
      final Subscription s = _gymRow().patched(<String, dynamic>{
        'category_id': 'own-1',
      });
      expect(s.toJson()['category_id'], 'own-1');
      expect(_gymRow().toJson().containsKey('category_id'), isFalse);
    });
  });

  group('the picker', () {
    testWidgets('ta shows the Tamil built-in names', (
      WidgetTester tester,
    ) async {
      await _host(
        tester,
        SeedApiClient(),
        (BuildContext c) => showAppFormSheet<void>(
          c,
          builder: (_) => const SubscriptionFormSheet(),
        ),
        locale: const Locale('ta'),
      );
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );
      await tester.ensureVisible(find.byKey(E2EKeys.addCategory));
      await tester.tap(find.byKey(E2EKeys.addCategory));
      await tester.pumpAndSettle();
      expect(find.text(ta.categoryStreaming), findsWidgets);
      expect(find.text(ta.categorySecurity), findsWidgets);
      expect(ta.categoryStreaming, isNot('Streaming'));
      expect(find.text('Streaming'), findsNothing);
    });

    testWidgets('the user\'s own categories are offered beside the built-ins', (
      WidgetTester tester,
    ) async {
      final SeedApiClient api = SeedApiClient();
      await api.createCategory('Gym');
      await _host(
        tester,
        api,
        (BuildContext c) => showAppFormSheet<void>(
          c,
          builder: (_) => const SubscriptionFormSheet(),
        ),
      );
      await tester.ensureVisible(find.byKey(E2EKeys.addCategory));
      await tester.tap(find.byKey(E2EKeys.addCategory));
      await tester.pumpAndSettle();
      expect(find.text('Gym'), findsWidgets);
      expect(find.text('Streaming'), findsWidgets);
    });
  });

  group('Settings › Categories', () {
    testWidgets('adds, renames and deletes one of the user\'s own', (
      WidgetTester tester,
    ) async {
      final SeedApiClient api = SeedApiClient();
      await _host(tester, api, showCategoriesManager);
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      expect(find.text(en.categoriesOwnEmpty), findsOneWidget);
      expect(find.text(en.categoryStreaming), findsOneWidget);

      await tester.enterText(find.byKey(CategoriesManagerKeys.newName), 'Gym');
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(CategoriesManagerKeys.add));
      await tester.tap(find.byKey(CategoriesManagerKeys.add));
      await tester.pumpAndSettle();
      final SubscriptionCategory gym = (await api.getCategories()).firstWhere(
        (SubscriptionCategory c) => c.name == 'Gym',
      );
      expect(find.text('Gym'), findsOneWidget);

      await tester.tap(find.byKey(CategoriesManagerKeys.rename(gym.id)));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(CategoriesManagerKeys.renameField),
        'Gym & Yoga',
      );
      await tester.tap(find.byKey(CategoriesManagerKeys.renameSave));
      await tester.pumpAndSettle();
      expect(find.text('Gym & Yoga'), findsOneWidget);
      expect(find.text('Gym'), findsNothing);

      await tester.tap(find.byKey(CategoriesManagerKeys.delete(gym.id)));
      await tester.pumpAndSettle();
      expect(find.text('Gym & Yoga'), findsNothing);
      expect(find.text(en.categoriesOwnEmpty), findsOneWidget);
    });
  });

  testWidgets('a pick from the catalogue files the row by id', (
    WidgetTester tester,
  ) async {
    final SeedApiClient api = SeedApiClient();
    await _host(tester, api, (BuildContext c) => showAddSubscriptionSheet(c));
    await tester.enterText(find.byKey(E2EKeys.addSearch), 'spot');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(E2EKeys.addPickRow('spotify')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(E2EKeys.addPrice), '119');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
    await tester.pump();
    await tester.tap(find.byKey(E2EKeys.addSubmit));
    await tester.pumpAndSettle();
    final Subscription added = (await api.getSubscriptions()).firstWhere(
      (Subscription s) => s.name == 'Spotify' && s.serviceId == 'spotify',
    );
    expect(added.category, 'Music');
    expect(added.categoryId, 'music');
  });
}
