import 'dart:io' show File;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/state/providers.dart';

/// 🔴 THE DEFECT, AND THE ONLY PROOF THAT IT IS CLOSED.
///
/// A `flutter test` takes no `--dart-define`s, so `AppConfig.isApiConfigured` is
/// false here — which is not a testing convenience, it is the SHIPPED default:
/// every build with no `API_BASE_URL` resolves the same branch. On that branch
/// `SeedApiClient` held the user's subscriptions in plain fields on a
/// non-auto-dispose provider, so an added subscription survived every navigation
/// and died with the process. Nothing logged it. Nothing could: there was simply
/// nowhere for the row to go.
///
/// Every test below builds a container, uses the app's OWN provider chain
/// (`subscriptionRepositoryProvider` → `apiClientProvider` → the persisted
/// client → the key-value store), disposes it, and builds a SECOND container
/// over the same bytes. Two containers over one store is a restart — the same
/// shape `settings_wiring_test.dart`'s "the chosen currency SURVIVES a restart"
/// uses, and for the same reason: it is the only thing a widget test can do that
/// a relaunch also does.
class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// A launch of the app against [kv] — the platform store the OS would hand it.
///
/// Only the store is overridden. The client, the repository and the branch that
/// chooses between them are the app's own, so a wiring mistake in
/// `apiClientProvider` fails these tests rather than being papered over by a
/// fake repository.
ProviderContainer _launch(_MemStore kv) => ProviderContainer(
  overrides: <Override>[
    keyValueStoreProvider.overrideWith((Ref ref) async => kv),
  ],
);

Subscription _draft(String name) => Subscription(
  id: '',
  name: name,
  category: 'AI tools',
  price: const Money(2000, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2026, 10, 1),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('🔴 A SUBSCRIPTION THE USER ADDS SURVIVES A RESTART', () async {
    final _MemStore kv = _MemStore();

    final ProviderContainer first = _launch(kv);
    final Subscription created = await first
        .read(subscriptionRepositoryProvider)
        .add(_draft('Claude Pro'));
    expect(created.name, 'Claude Pro');
    first.dispose();

    // The relaunch. Nothing is carried over but the bytes in the store.
    final ProviderContainer reborn = _launch(kv);
    addTearDown(reborn.dispose);
    final List<Subscription> subs = await reborn
        .read(subscriptionRepositoryProvider)
        .fetchAll();

    expect(
      subs.map((Subscription s) => s.name),
      contains('Claude Pro'),
      reason:
          'this is the whole defect. Before the fix the second container read a '
          'freshly constructed SeedApiClient and the row was simply gone, with '
          'no error and nothing in any log.',
    );
    expect(
      subs.where((Subscription s) => s.name == 'Claude Pro'),
      hasLength(1),
      reason: 'a restart must not duplicate the row it restored',
    );
  });

  test('a CANCELLED subscription stays cancelled across a restart', () async {
    final _MemStore kv = _MemStore();

    final ProviderContainer first = _launch(kv);
    final SubscriptionRepository repo = first.read(
      subscriptionRepositoryProvider,
    );
    final List<Subscription> before = await repo.fetchAll();
    final Subscription victim = before.first;
    await repo.cancel(victim.id);
    first.dispose();

    final ProviderContainer reborn = _launch(kv);
    addTearDown(reborn.dispose);
    final List<Subscription> after = await reborn
        .read(subscriptionRepositoryProvider)
        .fetchAll();

    expect(after.map((Subscription s) => s.id), isNot(contains(victim.id)));
    expect(after, hasLength(before.length - 1));
  });

  test('an EDIT survives a restart', () async {
    final _MemStore kv = _MemStore();

    final ProviderContainer first = _launch(kv);
    final SubscriptionRepository repo = first.read(
      subscriptionRepositoryProvider,
    );
    final String id = (await repo.fetchAll()).first.id;
    await repo.update(id, <String, dynamic>{'name': 'Renamed', 'price': 1.23});
    first.dispose();

    final ProviderContainer reborn = _launch(kv);
    addTearDown(reborn.dispose);
    final Subscription reread =
        (await reborn.read(subscriptionRepositoryProvider).fetchAll())
            .firstWhere((Subscription s) => s.id == id);
    expect(reread.name, 'Renamed');
    // ⚠️ THE PATCH IS STILL A BARE `num` AND THE ROW KEEPS ITS OWN CURRENCY.
    // `changes` comes off the wire, where a price is a decimal with no
    // currency beside it, so `copyWith` reads 1.23 as 123 minor units of the
    // unit this row was already in — a patch that changes the NUMBER has not
    // changed the currency.
    expect(reread.price, const Money(123, 'USD'));
  });

  test('the BUDGET survives a restart', () async {
    final _MemStore kv = _MemStore();

    final ProviderContainer first = _launch(kv);
    await first
        .read(subscriptionRepositoryProvider)
        .saveBudget(
          const BudgetInfo(
            monthlyBudget: Money(25000, 'USD'),
            categories: <BudgetCap>[BudgetCap('AI tools', Money(6000, 'USD'))],
          ),
        );
    first.dispose();

    final ProviderContainer reborn = _launch(kv);
    addTearDown(reborn.dispose);
    final BudgetInfo budget = await reborn
        .read(subscriptionRepositoryProvider)
        .budget();
    expect(budget.monthlyBudget, const Money(25000, 'USD'));
    expect(budget.categories.single.name, 'AI tools');
    expect(budget.categories.single.cap, const Money(6000, 'USD'));
  });

  test('🔴 AN EMPTIED LIST STAYS EMPTY — the seed is not re-planted', () async {
    final _MemStore kv = _MemStore();

    final ProviderContainer first = _launch(kv);
    final SubscriptionRepository repo = first.read(
      subscriptionRepositoryProvider,
    );
    for (final Subscription s in await repo.fetchAll()) {
      await repo.cancel(s.id);
    }
    expect(await repo.fetchAll(), isEmpty);
    first.dispose();

    final ProviderContainer reborn = _launch(kv);
    addTearDown(reborn.dispose);
    expect(
      await reborn.read(subscriptionRepositoryProvider).fetchAll(),
      isEmpty,
      reason:
          'absent is not empty. If the store answered "nothing here" for a '
          'deliberately cleared list, twelve demo rows would be planted back on '
          'top of the user on every launch, for ever.',
    );
  });

  test('a FRESH device still gets the demo set, and keeps it', () async {
    final _MemStore kv = _MemStore();
    expect(kv.data, isEmpty);

    final ProviderContainer first = _launch(kv);
    addTearDown(first.dispose);
    final List<Subscription> subs = await first
        .read(subscriptionRepositoryProvider)
        .fetchAll();

    expect(
      subs,
      isNotEmpty,
      reason:
          'test/support/width_harness.dart leans on this: left alone, the '
          'unconfigured chain renders a POPULATED list, because an empty state '
          'has no rows to stretch and a width test that measures one is an '
          'assertion that cannot fail.',
    );
    // And the seed is now the device's own — it was written down, not just
    // constructed, so the ids the user sees today are the ids they see tomorrow.
    expect(kv.data.keys, contains(kLocalSubscriptionsKey));
    expect(kv.data.keys, contains(kLocalBudgetKey));
  });

  test('a corrupt store falls back to the seed instead of breaking', () async {
    final _MemStore kv = _MemStore();
    kv.data[kLocalSubscriptionsKey] = 'not json {{{';
    kv.data[kLocalBudgetKey] = 'not json {{{';

    final ProviderContainer c = _launch(kv);
    addTearDown(c.dispose);
    expect(await c.read(subscriptionRepositoryProvider).fetchAll(), isNotEmpty);
    // ⚠️ `greaterThan(0)` NO LONGER TYPE-CHECKS AT RUNTIME and the analyzer
    // cannot say so: `expect`'s matcher argument is `dynamic`, so an int
    // against a [Money] compiles and then throws inside `_OrderingMatcher`.
    // The claim is "the seed budget is a real figure", so it is read off the
    // minor units — the one axis that is comparable without naming a currency.
    expect(
      (await c.read(subscriptionRepositoryProvider).budget())
          .monthlyBudget
          .minorUnits,
      greaterThan(0),
    );
  });

  test('🔴 a store that is not there: the app still RUNS, and an add FAILS '
      'HONESTLY with the list unchanged', () async {
    // No `keyValueStoreProvider` override at all: under `flutter test` there is
    // no `shared_preferences` plugin, so the real provider's future FAILS. The
    // app must still run — this is the same degradation a browser with storage
    // blocked, or a device with no writable profile, produces in the field.
    //
    // THIS USED TO ASSERT THAT THE ADD SUCCEEDED. It "succeeded" into memory
    // and was gone at the next launch, with nothing said. Now the write fails
    // where the user can see it (the add sheet re-arms and says so) and the
    // seed is rolled back, so the list never shows a row the device refused.
    //
    // As the app's root ProviderScope (main.dart): no automatic retry. Riverpod
    // 3 retries a failing provider by default, which holds the store's future
    // in loading for ~38 s of backoff instead of failing it.
    final ProviderContainer c = ProviderContainer(
      retry: (int retryCount, Object error) => null,
    );
    addTearDown(c.dispose);
    final List<Subscription> subs = await c
        .read(subscriptionRepositoryProvider)
        .fetchAll();
    expect(subs, isNotEmpty);
    await expectLater(
      c.read(subscriptionRepositoryProvider).add(_draft('Claude Pro')),
      throwsA(isA<LocalStoreWriteFailure>()),
    );
    final List<Subscription> after = await c
        .read(subscriptionRepositoryProvider)
        .fetchAll();
    expect(after.length, subs.length, reason: 'rolled back — not half-saved');
    expect(
      after.map((Subscription s) => s.name),
      isNot(contains('Claude Pro')),
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔴 THE CONFIGURED BRANCH — THE ONE EVERY REAL BUILD TAKES.
  //
  // `AppConfig.isApiConfigured` is compile-time and false under `flutter test`,
  // so the provider's configured branch is proven through the named function
  // it delegates to, PLUS a reading of the provider's own source that the
  // branch still delegates. Two halves of one mutation: make
  // `cachedApiClientOver` return the network bare, or make the provider return
  // `DioApiClient` bare, and one of these goes red.
  // ═══════════════════════════════════════════════════════════════════════════
  group(
    'API configured: the list survives a restart with the network dead',
    () {
      test('through the wiring function the provider uses', () async {
        final _MemStore kv = _MemStore();
        LocalSubscriptionStore store() =>
            LocalSubscriptionStore(Future<core.KeyValueStore>.value(kv));
        final _FakeNetwork net = _FakeNetwork(<Subscription>[
          _draft('Netflix'),
          _draft('Spotify'),
        ]);

        // Launch 1, online, through the app's own wiring.
        final ApiClient first = cachedApiClientOver(net, store());
        expect((await first.getSubscriptions()).length, 2);

        // Kill the network; launch 2 is a NEW client over the same bytes.
        net.dead = true;
        final ApiClient second = cachedApiClientOver(net, store());
        expect(
          (await second.getSubscriptions()).map((Subscription s) => s.name),
          <String>['Netflix', 'Spotify'],
        );
      });

      test('and the provider\'s configured branch still calls it', () {
        // A SOURCE reading, because no test can flip the compile-time define.
        final String src = File(
          'lib/state/providers/subscriptions.dart',
        ).readAsStringSync();
        final int start = src.indexOf(
          'apiClientProvider = Provider<ApiClient>',
        );
        final int end = src.indexOf('});', start);
        final String body = src.substring(start, end);
        expect(body, contains('cachedApiClientOver('));
        expect(
          body,
          isNot(contains('return DioApiClient(')),
          reason:
              'a bare DioApiClient is the production path with no local copy',
        );
      });
    },
  );
}

/// The Worker, reduced to a list and a kill switch.
class _FakeNetwork implements ApiClient {
  _FakeNetwork(this.subs);
  List<Subscription> subs;
  bool dead = false;
  void _gate() {
    if (dead) throw ApiException(0, 'Network error');
  }

  @override
  Future<List<Subscription>> getSubscriptions() async {
    _gate();
    return subs;
  }

  @override
  Future<Subscription> createSubscription(Subscription draft) async {
    _gate();
    return draft;
  }

  @override
  Future<Subscription> getSubscription(String id) async {
    _gate();
    return subs.firstWhere((Subscription s) => s.id == id);
  }

  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    _gate();
    return subs.firstWhere((Subscription s) => s.id == id);
  }

  @override
  Future<void> deleteSubscription(String id) async => _gate();

  // NO-10 · "Mark as paid": not exercised by this suite.
  @override
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {}

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async {
    _gate();
    return const <PaymentRecord>[];
  }

  @override
  Future<SpendHistory> getSpendHistory() async {
    _gate();
    return SpendHistory.empty;
  }

  @override
  Future<BudgetInfo> getBudget() async {
    _gate();
    return const BudgetInfo(
      monthlyBudget: Money(1, 'USD'),
      categories: <BudgetCap>[],
    );
  }

  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async {
    _gate();
    return budget;
  }

  @override
  Future<core.Entitlements> getEntitlements() async {
    _gate();
    return core.Entitlements.none;
  }
}
