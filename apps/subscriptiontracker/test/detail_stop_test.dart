// train ST-detail-stop (DE-04..11): the detail screen holds every fact and
// stops a charge. One case per red control the brief names; each says what
// it fails on without its patch.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/core/router/navigator_key.dart';
import 'package:subscriptiontracker/core/router/routes.dart';
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/price_change.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/features/shared/failure_copy.dart';
import 'package:subscriptiontracker/features/stop/stop_flow.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/width_harness.dart';

/// A server twin: soft delete on BOTH paths (PATCH `deleted_at`, and DELETE),
/// payments by Idempotency-Key, and a price history.
class _Api implements ApiClient, PaymentWrites {
  _Api(this.subs);
  List<Subscription> subs;

  /// Answer 400 to a PATCH that sets `deleted_at` — an API older than its
  /// soft-delete readers, which sends the controller down the DELETE path.
  bool refuseSoftDeletePatch = false;

  final Map<String, PaymentRecord> payments = <String, PaymentRecord>{};
  int paymentPosts = 0;

  /// The Idempotency-Key of every POST, in order.
  final List<String> paymentKeys = <String>[];

  /// Answer the next N payment POSTs with a 503 (after seeing the key) — the
  /// lost-answer shape a retry exists for.
  int failNextPayments = 0;
  List<PriceChange> prices = const <PriceChange>[];

  @override
  Future<List<Subscription>> getSubscriptions() async => subs;
  @override
  Future<Subscription> createSubscription(Subscription draft) async => draft;
  @override
  Future<Subscription> getSubscription(String id) async =>
      subs.firstWhere((Subscription s) => s.id == id);
  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    if (refuseSoftDeletePatch && changes['deleted_at'] != null) {
      throw ApiException(400, 'invalid_body');
    }
    final Subscription u = subs
        .firstWhere((Subscription s) => s.id == id)
        .patched(changes);
    subs = <Subscription>[
      for (final Subscription s in subs) s.id == id ? u : s,
    ];
    return u;
  }

  /// `DELETE /v1/subscriptions/:id` — a SOFT delete, as the route now is.
  @override
  Future<void> deleteSubscription(String id) async {
    subs = <Subscription>[
      for (final Subscription s in subs)
        s.id == id
            ? s.patched(<String, dynamic>{
                'deleted_at': DateTime.utc(2026, 10, 1).toIso8601String(),
              })
            : s,
    ];
  }

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async =>
      payments.values.toList();
  @override
  Future<SpendHistory> getSpendHistory() async => SpendHistory.empty;
  @override
  Future<PaymentRecord> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {
    paymentPosts++;
    paymentKeys.add(idempotencyKey);
    if (failNextPayments > 0) {
      failNextPayments--;
      throw ApiException(503, 'unavailable');
    }
    return payments.putIfAbsent(
      idempotencyKey,
      () => PaymentRecord(date: paidOn, amount: amount),
    );
  }

  @override
  Future<List<PriceChange>> getPriceHistory(String id) async => prices;
  @override
  Future<BudgetInfo> getBudget() async => const BudgetInfo(
    monthlyBudget: Money(1, 'USD'),
    categories: <BudgetCap>[],
  );
  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async => budget;
  @override
  Future<core.Entitlements> getEntitlements() async => core.Entitlements.none;
}

class _Links implements core.ExternalLinkLauncher {
  final List<Uri> opened = <Uri>[];
  @override
  Future<core.LinkOutcome> open(Uri uri) async {
    opened.add(uri);
    return core.LinkOutcome.opened;
  }
}

Subscription _sub({
  String id = '1',
  String name = 'Netflix',
  PaymentRail? rail,
  String? serviceId,
  SubscriptionStatus status = SubscriptionStatus.active,
}) => Subscription(
  id: id,
  name: name,
  category: 'Entertainment',
  price: const Money(64900, 'INR'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2026, 11, 3),
  rail: rail,
  serviceId: serviceId,
  status: status,
);

core.ServiceCatalogue _catalogue() => core.ServiceCatalogue(<core.ServiceEntry>[
  core.ServiceEntry(
    id: 'netflix',
    name: 'Netflix',
    categoryId: 'entertainment',
    cycle: core.ServiceCycle.monthly,
    cancelUrl: Uri.parse('https://www.netflix.com/cancelplan'),
    playManageUrl: Uri.parse(
      'https://play.google.com/store/account/subscriptions',
    ),
    appStoreManageUrl: Uri.parse(
      'https://apps.apple.com/account/subscriptions',
    ),
    noticeDays: 1,
    regions: const <String>{'*'},
  ),
]);

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

List<Override> _overrides(_Api api, {_Links? links}) => <Override>[
  ...defaultWidthOverrides(),
  subscriptionRepositoryProvider.overrideWithValue(SubscriptionRepository(api)),
  nowProvider.overrideWithValue(() => DateTime(2026, 10, 1, 10)),
  serviceCatalogueProvider.overrideWith(
    (Ref ref, String _) async => _catalogue(),
  ),
  if (links != null) cancelLinkLauncherProvider.overrideWithValue(links),
];

Future<void> _pump(WidgetTester tester, Widget child, List<Override> o) async {
  await tester.binding.setSurfaceSize(const Size(400, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: o,
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

ProviderContainer _container(_Api api) {
  final ProviderContainer c = ProviderContainer(
    retry: (int retryCount, Object error) => null,
    overrides: _overrides(api),
  );
  addTearDown(c.dispose);
  return c;
}

void main() {
  // ── DE-11 · every fact in one place ───────────────────────────────────────
  group('DE-11 details list', () {
    testWidgets('a row with every field shows every one', (
      WidgetTester tester,
    ) async {
      final Subscription full = Subscription.fromJson(<String, dynamic>{
        'id': '1',
        'name': 'Netflix',
        'category': 'Entertainment',
        'price_minor': 64900,
        'currency': 'INR',
        'cycle_every': 1,
        'cycle_unit': 'month',
        'next_renewal': '2026-11-03',
        'notes': 'Family plan',
        'cancel_url': 'https://www.netflix.com/cancelplan',
        'first_charge_on': '2024-01-03',
        'cancelled_on': '2026-09-30',
        'rail': 'upi_autopay',
        'rail_holder': 'me@okaxis',
      });
      await _pump(
        tester,
        DetailsList(sub: full),
        _overrides(_Api(<Subscription>[full])),
      );
      for (final String k in <String>[
        'details-paid-with',
        'details-category',
        'detail.details.website',
        'details-notes',
        'details-first-charge',
        'details-cancelled-on',
      ]) {
        expect(find.byKey(Key(k)), findsOneWidget, reason: k);
      }
      expect(find.textContaining('UPI Autopay · me@okaxis'), findsOneWidget);
    });

    testWidgets('an empty field shows nothing — no "—" noise', (
      WidgetTester tester,
    ) async {
      // Paused, so no reminder is armed for it either: every row is empty.
      final Subscription bare = _sub(
        status: SubscriptionStatus.paused,
      ).patched(<String, dynamic>{'category': ''});
      await _pump(
        tester,
        DetailsList(sub: bare),
        _overrides(_Api(<Subscription>[bare])),
      );
      expect(find.byKey(const Key('detail-details-card')), findsNothing);
      expect(find.text('—'), findsNothing);
    });
  });

  // ── DE-04 / DE-05 · mark as paid, and the timeline ────────────────────────
  group('DE-04 mark as paid', () {
    test(
      'one tap posts one payment; a replay with the same key adds none',
      () async {
        final _Api api = _Api(<Subscription>[_sub()]);
        final ProviderContainer c = _container(api);
        await c.read(subscriptionsControllerProvider.future);
        final SubscriptionsController ctl = c.read(
          subscriptionsControllerProvider.notifier,
        );
        await ctl.recordPayment(
          '1',
          amount: const Money(64900, 'INR'),
          paidOn: DateTime(2026, 10, 1),
          idempotencyKey: 'key-one-tap',
        );
        await ctl.recordPayment(
          '1',
          amount: const Money(64900, 'INR'),
          paidOn: DateTime(2026, 10, 1),
          idempotencyKey: 'key-one-tap',
        );
        expect(api.paymentPosts, 2, reason: 'the replay was sent');
        expect(api.payments, hasLength(1), reason: 'and added nothing');
        expect(await c.read(paymentHistoryProvider('1').future), hasLength(1));
      },
    );

    test('the demo client honours the key too', () async {
      final SeedApiClient seed = SeedApiClient();
      final String id = (await seed.getSubscriptions()).first.id;
      final int before = (await seed.getPaymentHistory(id)).length;
      for (int i = 0; i < 2; i++) {
        await seed.recordPayment(
          id,
          amount: const Money(100, 'USD'),
          paidOn: DateTime(2026, 9, 1),
          idempotencyKey: 'same',
        );
      }
      expect(await seed.getPaymentHistory(id), hasLength(before + 1));
    });

    testWidgets(
      'the dialog posts ONE payment, and its retry reuses the key — no second payment',
      (WidgetTester tester) async {
        // The first Save gets a 503 (the server may or may not have stored it);
        // the retry from the SAME dialog must carry the SAME key.
        final _Api api = _Api(<Subscription>[_sub()])..failNextPayments = 1;
        await tester.binding.setSurfaceSize(const Size(400, 3000));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(
          ProviderScope(
            overrides: _overrides(api),
            child: MaterialApp(
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const SubscriptionDetailScreen(id: '1'),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(E2EKeys.detailMarkPaid));
        await tester.pumpAndSettle();
        expect(find.text('649.00'), findsOneWidget, reason: 'prefilled');

        await tester.tap(find.byKey(E2EKeys.markPaidSave));
        await tester.pumpAndSettle();
        final AppLocalizations l10n = await _en();
        expect(api.paymentPosts, 1, reason: 'one tap, one POST');
        expect(find.byKey(const Key('mark-paid-failure')), findsOneWidget);
        expect(
          tester.widget<Text>(find.byKey(const Key('mark-paid-failure'))).data,
          l10n.changeServerError,
          reason: 'a 503 is a server problem, never "check your connection"',
        );

        await tester.tap(find.byKey(E2EKeys.markPaidSave));
        await tester.pumpAndSettle();
        expect(api.paymentPosts, 2);
        expect(
          api.paymentKeys.toSet(),
          hasLength(1),
          reason: 'the retry minted a new Idempotency-Key',
        );
        expect(api.payments.values.single.amount, const Money(64900, 'INR'));
        expect(find.text(l10n.paymentRecorded), findsOneWidget);
      },
    );
  });

  group('DE-05 timeline', () {
    testWidgets('a price change renders in the timeline', (
      WidgetTester tester,
    ) async {
      final _Api api = _Api(<Subscription>[_sub()])
        ..prices = <PriceChange>[
          PriceChange(
            changedOn: DateTime(2026, 9, 3),
            from: const Money(49900, 'INR'),
            to: const Money(64900, 'INR'),
          ),
        ];
      await tester.binding.setSurfaceSize(const Size(400, 3000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(api),
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const SubscriptionDetailScreen(id: '1'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('timeline-price-change')), findsOneWidget);
      expect(find.textContaining('Price rose from'), findsOneWidget);
      expect(find.textContaining('on Sep 3'), findsOneWidget);
    });

    test('a currency change is neither a rise nor a fall', () async {
      final AppLocalizations l10n = await _en();
      final String line = timelinePriceLine(
        l10n,
        MoneyFormatter('en'),
        PriceChange(
          changedOn: DateTime(2026, 9, 3),
          from: const Money(49900, 'INR'),
          to: const Money(999, 'USD'),
        ),
        DateFormat.MMMd('en_US'),
      );
      expect(line, startsWith('Price changed from'));
    });
  });

  // ── DE-06 · how to cancel ────────────────────────────────────────────────
  group('DE-06 how to cancel', () {
    testWidgets(
      'a Netflix row shows its cancel link, opened through the seam',
      (WidgetTester tester) async {
        final _Links links = _Links();
        final Subscription s = _sub(serviceId: 'netflix');
        await _pump(
          tester,
          HowToCancel(sub: s),
          _overrides(_Api(<Subscription>[s]), links: links),
        );
        expect(find.byKey(const Key('how-to-cancel-provider')), findsOneWidget);
        expect(find.byKey(const Key('how-to-cancel-play')), findsNothing);
        await tester.tap(find.byKey(const Key('how-to-cancel-provider')));
        await tester.pumpAndSettle();
        expect(links.opened, <Uri>[
          Uri.parse('https://www.netflix.com/cancelplan'),
        ]);
      },
    );

    testWidgets(
      'a row paid via Google Play shows the Play subscriptions link',
      (WidgetTester tester) async {
        final _Links links = _Links();
        final Subscription s = _sub(
          serviceId: 'netflix',
          rail: PaymentRail.play,
        );
        await _pump(
          tester,
          HowToCancel(sub: s),
          _overrides(_Api(<Subscription>[s]), links: links),
        );
        await tester.tap(find.byKey(const Key('how-to-cancel-play')));
        await tester.pumpAndSettle();
        expect(links.opened.single.host, 'play.google.com');
      },
    );

    testWidgets('an unmatched row gets the generic steps', (
      WidgetTester tester,
    ) async {
      final Subscription s = _sub(name: 'Local gym');
      await _pump(
        tester,
        HowToCancel(sub: s),
        _overrides(_Api(<Subscription>[s])),
      );
      expect(find.byKey(const Key('how-to-cancel-generic')), findsOneWidget);
    });
  });

  // ── DE-08 · the India rail panel ─────────────────────────────────────────
  group('DE-08 rail panel', () {
    testWidgets('a upi_autopay row shows the panel', (
      WidgetTester tester,
    ) async {
      final Subscription s = _sub(rail: PaymentRail.upiAutopay);
      await _pump(
        tester,
        RailPanel(sub: s),
        _overrides(_Api(<Subscription>[s])),
      );
      final AppLocalizations l10n = await _en();
      expect(find.byKey(const Key('rail-panel-upi_autopay')), findsOneWidget);
      expect(find.text(l10n.railPanelNotTheSame('Netflix')), findsOneWidget);
      expect(find.text(l10n.railPanelUpiWhere), findsOneWidget);
    });

    testWidgets('a card row shows the card variant', (
      WidgetTester tester,
    ) async {
      final Subscription s = _sub(rail: PaymentRail.cardEmandate);
      await _pump(
        tester,
        RailPanel(sub: s),
        _overrides(_Api(<Subscription>[s])),
      );
      expect(find.byKey(const Key('rail-panel-card_emandate')), findsOneWidget);
      expect(find.text((await _en()).railPanelCardWhere), findsOneWidget);
    });

    testWidgets('a Play row shows no panel', (WidgetTester tester) async {
      final Subscription s = _sub(rail: PaymentRail.play);
      await _pump(
        tester,
        RailPanel(sub: s),
        _overrides(_Api(<Subscription>[s])),
      );
      expect(find.byKey(const Key('rail-panel-play')), findsNothing);
    });
  });

  // ── DE-07 · the stop-a-charge flow ───────────────────────────────────────
  group('DE-07 stop flow', () {
    Future<_Api> pumpFlow(WidgetTester tester, Subscription s) async {
      final _Api api = _Api(<Subscription>[s]);
      await tester.binding.setSurfaceSize(const Size(400, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(api),
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: Builder(
                builder: (BuildContext c) => TextButton(
                  onPressed: () => showStopSheet(c, s),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      return api;
    }

    testWidgets('"I already cancelled" sets status and date', (
      WidgetTester tester,
    ) async {
      final _Api api = await pumpFlow(tester, _sub());
      await tester.tap(find.byKey(E2EKeys.stopChoiceCancelled));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(E2EKeys.stopItWorked));
      await tester.pumpAndSettle();
      expect(api.subs.single.status, SubscriptionStatus.cancelled);
      expect(api.subs.single.cancelledOn, DateTime(2026, 10, 1));
      expect(find.byKey(E2EKeys.stopDone), findsOneWidget);
    });

    testWidgets('"just remove" soft-deletes with Undo, and Undo restores', (
      WidgetTester tester,
    ) async {
      final _Api api = await pumpFlow(tester, _sub());
      await tester.tap(find.byKey(E2EKeys.stopChoiceRemove));
      await tester.pumpAndSettle();
      expect(api.subs.single.deletedAt, isNotNull, reason: 'soft, not hard');
      expect(find.byKey(E2EKeys.snackUndo), findsOneWidget);
      await tester.tap(find.byKey(E2EKeys.snackUndo));
      await tester.pumpAndSettle();
      expect(api.subs.single.deletedAt, isNull);
    });

    testWidgets('the walkthrough is picked by how it is paid', (
      WidgetTester tester,
    ) async {
      await pumpFlow(tester, _sub(rail: PaymentRail.upiAutopay));
      await tester.tap(find.byKey(E2EKeys.stopChoiceStop));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('stop-walkthrough-upi_autopay')),
        findsOneWidget,
      );
    });

    testWidgets('/sub/:id/stop resolves case-insensitively and deep-links', (
      WidgetTester tester,
    ) async {
      final _Api api = _Api(<Subscription>[_sub(id: 'abc')]);
      final GoRouter router = GoRouter(
        navigatorKey: rootNavigatorKey,
        initialLocation: '/SUB/abc/STOP',
        routes: appRoutes(),
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(api),
          child: MaterialApp.router(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: router,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(StopScreen), findsOneWidget);
      expect(find.byKey(E2EKeys.stopChoiceStop), findsOneWidget);
    });
  });

  // ── DE-09 / DE-10 · safe, undoable lifecycle ─────────────────────────────
  group('DE-09 safe lifecycle', () {
    test('Undo after Pause restores active', () async {
      final _Api api = _Api(<Subscription>[_sub()]);
      final ProviderContainer c = _container(api);
      await c.read(subscriptionsControllerProvider.future);
      final SubscriptionsController ctl = c.read(
        subscriptionsControllerProvider.notifier,
      );
      final Subscription was = api.subs.single;
      await ctl.pauseSubscription('1');
      expect(api.subs.single.status, SubscriptionStatus.paused);
      await ctl.restoreStatus(was);
      expect(api.subs.single.status, SubscriptionStatus.active);
    });

    test('a 400 never says "check your connection"', () async {
      final AppLocalizations l10n = await _en();
      final String refused = writeFailureMessage(
        l10n,
        ApiException(400, 'invalid_body'),
      );
      expect(refused, l10n.changeRefused);
      expect(refused.toLowerCase(), isNot(contains('connection')));
      expect(
        writeFailureMessage(l10n, ApiException(0, 'offline')),
        l10n.changeOffline,
      );
      expect(
        writeFailureMessage(l10n, ApiException(503, 'down')),
        l10n.changeServerError,
      );
    });

    testWidgets('Pause asks once, and its snackbar Undo restores active', (
      WidgetTester tester,
    ) async {
      final _Api api = _Api(<Subscription>[_sub()]);
      await tester.binding.setSurfaceSize(const Size(400, 3000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(api),
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const SubscriptionDetailScreen(id: '1'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final AppLocalizations l10n = await _en();
      await tester.tap(find.byKey(E2EKeys.detailMoreOptions));
      await tester.pumpAndSettle();
      await tester.tap(find.text(l10n.actionPause));
      await tester.pumpAndSettle();
      expect(find.text(l10n.pauseConfirmTitle('Netflix')), findsOneWidget);
      expect(
        api.subs.single.status,
        SubscriptionStatus.active,
        reason: 'nothing applies before the answer',
      );
      await tester.tap(find.byKey(E2EKeys.confirmYes));
      await tester.pumpAndSettle();
      expect(api.subs.single.status, SubscriptionStatus.paused);
      await tester.tap(find.byKey(E2EKeys.snackUndo));
      await tester.pumpAndSettle();
      expect(api.subs.single.status, SubscriptionStatus.active);
    });
  });

  group('DE-10 undo always works', () {
    test('the DELETE-fallback path offers Undo and restores the row', () async {
      final _Api api = _Api(<Subscription>[_sub()])
        ..refuseSoftDeletePatch = true;
      final ProviderContainer c = _container(api);
      await c.read(subscriptionsControllerProvider.future);
      final SubscriptionsController ctl = c.read(
        subscriptionsControllerProvider.notifier,
      );
      await ctl.cancelSubscription('1');
      expect(c.read(subscriptionsControllerProvider).requireValue, isEmpty);
      expect(ctl.canUndoDelete('1'), isTrue);
      await ctl.undoDelete('1');
      expect(
        c.read(subscriptionsControllerProvider).requireValue.single.id,
        '1',
      );
      expect(ctl.canUndoDelete('1'), isFalse);
    });
  });
}
