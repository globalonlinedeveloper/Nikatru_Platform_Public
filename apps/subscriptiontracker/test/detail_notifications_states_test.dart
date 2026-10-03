// ─────────────────────────────────────────────────────────────────────────────
// TRAIN ST-D5 — DETAIL AND NOTIFICATIONS, ONE CASE PER STATE.
//
// Both screens are PUSHED routes that own their own chrome, so every case
// below asserts two things: the state under test is on screen (by the
// design system's state KEYS, never by copy a translator may change), and the
// way off the screen survived it. A state that drops the back arrow or the
// close is a dead end, and the dead end is worst in exactly the states a user
// most wants out of — failed and offline.
//
// THE STATES, per screen:
//   loading · empty · error · offline · populated
// plus the ones only these screens have: detail's payment history loading on
// its own card, and notifications' "subscriptions, but nothing due".
//
// ⚠️ OFFLINE IS THE REAL OFFLINE, NOT A FAKE FLAG. The list goes through the
// production `CachedApiClient` over a network that answers `ApiException(0)`
// with a store holding a cached list — the path a user without signal takes.
// History is NOT cached, so offline is precisely the state in which the
// detail page's history card must say "failed" rather than "No payments yet",
// which is the sentence the old `FutureBuilder` printed.
//
// ⚠️ THE CLOCK IS PINNED through `nowProvider`. The demo renewal dates are
// fixed (July 2026), so a case that read the wall clock would pass today and
// silently measure an empty "due soon" list next month.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/seed/demo_data.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/features/notifications/notifications_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// The day every case is pinned to. Netflix (`demo_data.dart`, id 1) renews
/// 2026-07-22, i.e. TOMORROW — the one due caption drawn as a warning — and
/// GitHub Copilot (id 5) renews 2026-07-24, three days out, drawn neutral.
final DateTime kToday = DateTime(2026, 7, 21, 9);

const String kNetflixId = '1';

/// A seed client whose list is [subs] and whose history is [history] — or,
/// when [history] is null, the seed's own four records.
class _ListApi extends SeedApiClient {
  _ListApi(this.subs, {this.history});
  final List<Subscription> subs;
  final Future<List<PaymentRecord>> Function()? history;
  int historyCalls = 0;

  @override
  Future<List<Subscription>> getSubscriptions() async => subs;

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) {
    historyCalls += 1;
    final Future<List<PaymentRecord>> Function()? h = history;
    return h == null ? super.getPaymentHistory(id) : h();
  }
}

/// A network with no signal: every call answers the status-0 `ApiException`
/// `DioApiClient` maps a connection failure to.
class _NoSignal extends SeedApiClient {
  int historyCalls = 0;

  @override
  Future<List<Subscription>> getSubscriptions() async =>
      throw ApiException(0, 'Network error');

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async {
    historyCalls += 1;
    throw ApiException(0, 'Network error');
  }
}

/// A list fetch that never answers.
class _PendingApi extends SeedApiClient {
  @override
  Future<List<Subscription>> getSubscriptions() =>
      Completer<List<Subscription>>().future;
}

/// A list fetch that fails with something the cache does NOT serve (a 401 is
/// not "offline"), so the screen has nothing to draw.
class _FailingApi extends SeedApiClient {
  @override
  Future<List<Subscription>> getSubscriptions() async =>
      throw ApiException(401, 'Unauthorized');
}

/// A phone-WIDE window, tall enough that the whole detail page is built.
///
/// ⏱ 2026-10-01 · DE-11: the detail now holds every fact (details, rail
/// panel, how to cancel), so the history card sits below a phone's first
/// screen, and the body is a lazy `ListView` that does not build what is off
/// it. These cases read that card; the width under test is still kPhone's.
final Size _kTallPhone = Size(kPhone.width, kPhone.height * 3);

Future<void> _pump(
  WidgetTester tester,
  Widget screen,
  ApiClient api, {
  Size? size,
  double textScale = 1,
  Locale locale = const Locale('en'),
}) async {
  await setSurface(tester, size ?? _kTallPhone);
  final ProviderContainer c = ProviderContainer(
    // As the app's root ProviderScope: no automatic retry (Riverpod 3).
    retry: noProviderRetry,
    overrides: <Override>[
      ...defaultWidthOverrides(),
      apiClientProvider.overrideWithValue(api),
      nowProvider.overrideWithValue(() => kToday),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: const Color(0xFF6459F5)),
        builder: (BuildContext context, Widget? child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: screen,
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

/// The production cache over [network], holding [cached] from a previous
/// session.
Future<ApiClient> _cachedOver(
  ApiClient network,
  List<Subscription> cached,
) async {
  final LocalSubscriptionStore store = LocalSubscriptionStore.inMemory();
  await store.writeSubscriptions(cached);
  return cachedApiClientOver(network, store);
}

Finder _inHistory(Finder f) => find.descendant(
  of: find.byKey(const Key('detail-history-card')),
  matching: f,
);

void _expectNoPageState() {
  for (final Key k in <Key>[
    DataStateView.loadingKey,
    DataStateView.emptyKey,
    DataStateView.failedKey,
  ]) {
    expect(find.byKey(k), findsNothing, reason: 'unexpected page state $k');
  }
}

void main() {
  late AppLocalizations en;
  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DETAIL
  // ═══════════════════════════════════════════════════════════════════════════
  group('detail · one case per state', () {
    const Widget screen = SubscriptionDetailScreen(id: kNetflixId);

    testWidgets('loading: the page spinner, under an app bar', (
      WidgetTester tester,
    ) async {
      await _pump(tester, screen, _PendingApi());
      expect(find.byKey(DataStateView.loadingKey), findsOneWidget);
      expect(find.byType(AppBar), findsOneWidget);
    });

    testWidgets('empty: an id the list does not hold is "not found"', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: 'no-such-id'),
        _ListApi(DemoData.subscriptions()),
      );
      expect(find.byKey(DataStateView.emptyKey), findsOneWidget);
      expect(find.text(en.subscriptionNotFound), findsOneWidget);
      expect(find.byKey(DataStateView.retryKey), findsNothing);
      expect(find.byType(AppBar), findsOneWidget);
    });

    testWidgets('error: failed, with a retry, under an app bar', (
      WidgetTester tester,
    ) async {
      await _pump(tester, screen, _FailingApi());
      expect(find.byKey(DataStateView.failedKey), findsOneWidget);
      expect(find.byKey(DataStateView.retryKey), findsOneWidget);
      expect(find.byType(AppBar), findsOneWidget);
    });

    testWidgets('offline: the page renders from the cache and the HISTORY '
        'card says it failed — never "No payments yet"', (
      WidgetTester tester,
    ) async {
      final _NoSignal network = _NoSignal();
      await _pump(
        tester,
        screen,
        await _cachedOver(network, DemoData.subscriptions()),
      );

      // The page itself is populated, from the cached list.
      expect(find.text('Netflix'), findsOneWidget);
      expect(find.text(en.fieldLabelPrice), findsOneWidget);
      expect(find.byKey(E2EKeys.detailBack), findsOneWidget);

      // The history card — and ONLY the history card — is the failed state.
      expect(_inHistory(find.byKey(DataStateView.failedKey)), findsOneWidget);
      expect(find.byKey(DataStateView.failedKey), findsOneWidget);
      expect(
        find.text(en.noPaymentsYet),
        findsNothing,
        reason:
            'THE DEFECT THIS FIXES: the FutureBuilder read `snap.data ?? []`, '
            'so a failed history fetch told an offline user they had never '
            'paid for this plan',
      );

      // The retry is scoped to the card and really re-fetches.
      final int before = network.historyCalls;
      await tester.tap(_inHistory(find.byKey(DataStateView.retryKey)));
      for (int i = 0; i < 6; i++) {
        await tester.pump();
      }
      expect(network.historyCalls, before + 1);
    });

    testWidgets('history loading: the card shows its own skeleton', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        screen,
        _ListApi(
          DemoData.subscriptions(),
          history: () => Completer<List<PaymentRecord>>().future,
        ),
      );
      expect(_inHistory(find.byKey(SkeletonList.skeletonKey)), findsOneWidget);
      expect(find.text(en.noPaymentsYet), findsNothing);
      _expectNoPageState();
    });

    testWidgets('history empty: the card says so, with no retry', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        screen,
        _ListApi(
          DemoData.subscriptions(),
          history: () async => const <PaymentRecord>[],
        ),
      );
      expect(_inHistory(find.text(en.noPaymentsYet)), findsOneWidget);
      expect(find.byKey(DataStateView.retryKey), findsNothing);
    });

    testWidgets('populated: figures, a warned due caption, four payment rows '
        'and every e2e anchor', (WidgetTester tester) async {
      await _pump(tester, screen, _ListApi(DemoData.subscriptions()));
      _expectNoPageState();

      final List<AppFigureTile> tiles = tester
          .widgetList<AppFigureTile>(find.byType(AppFigureTile))
          .toList();
      expect(tiles.map((AppFigureTile t) => t.label), <String>[
        en.fieldLabelPrice,
        en.nextChargeLabel,
      ]);
      expect(
        tiles.last.caption,
        en.renewsTomorrow,
        reason: 'Netflix renews 2026-07-22 and the clock is pinned to 07-21',
      );
      expect(
        tiles.last.status,
        StatusKind.warn,
        reason:
            'tomorrow is the last day a cancellation saves this cycle, so it '
            'is the one due caption drawn as a warning',
      );
      expect(tiles.first.status, isNull);

      expect(_inHistory(find.byType(AppListRow)), findsNWidgets(4));
      expect(find.byKey(E2EKeys.detailBack), findsOneWidget);
      expect(find.byKey(E2EKeys.detailCancelPlan), findsOneWidget);
      expect(find.text(en.stopOrRemove), findsOneWidget);
    });

    testWidgets('populated, three days out: the due caption is NOT a warning', (
      WidgetTester tester,
    ) async {
      // GitHub Copilot, 2026-07-24. The falsifier for the case above: a
      // status wired to a constant passes that one alone.
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: '5'),
        _ListApi(DemoData.subscriptions()),
      );
      final AppFigureTile due = tester
          .widgetList<AppFigureTile>(find.byType(AppFigureTile))
          .last;
      expect(due.caption, en.dueInDays(3));
      expect(due.status, isNull);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT SCALING — the platform-owned setting every target honours. `app.dart`
  // clamps it to [1.0, 2.0], so 2.0 is the largest a user can reach; both
  // screens must lay out at it on the narrowest phone with nothing clipped.
  // ═══════════════════════════════════════════════════════════════════════════
  group('text scale 2.0 at 375', () {
    for (final Locale locale in kSupportedLocales.map(
      (RegisteredLocale r) => r.locale,
    )) {
      testWidgets('[${locale.languageCode}] detail and notifications do not '
          'overflow', (WidgetTester tester) async {
        for (final Widget screen in const <Widget>[
          SubscriptionDetailScreen(id: kNetflixId),
          NotificationsScreen(),
        ]) {
          await _pump(
            tester,
            screen,
            _ListApi(DemoData.subscriptions()),
            textScale: 2,
            locale: locale,
          );
          expect(
            tester.takeException(),
            isNull,
            reason:
                'a RenderFlex overflow is reported as an exception, not as a '
                'stripe a test would otherwise miss ($screen)',
          );
        }
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  group('notifications · one case per state', () {
    const Widget screen = NotificationsScreen();

    testWidgets('loading: the list outline, and the close survives', (
      WidgetTester tester,
    ) async {
      await _pump(tester, screen, _PendingApi());
      expect(find.byKey(SkeletonList.skeletonKey), findsOneWidget);
      _expectNoPageState();
      expect(find.byKey(E2EKeys.notificationsClose), findsOneWidget);
    });

    testWidgets('empty: no subscriptions at all', (WidgetTester tester) async {
      await _pump(tester, screen, _ListApi(const <Subscription>[]));
      expect(find.byKey(DataStateView.emptyKey), findsOneWidget);
      expect(find.text(en.dataEmptyTitle), findsOneWidget);
      expect(find.byKey(DataStateView.retryKey), findsNothing);
      expect(find.byKey(E2EKeys.notificationsClose), findsOneWidget);
    });

    testWidgets('empty: subscriptions, but nothing due and nothing unused', (
      WidgetTester tester,
    ) async {
      // Every renewal pushed a year out, and the unused ones dropped: a REAL
      // list with nothing to say about it this week.
      final List<Subscription> quiet = DemoData.subscriptions()
          .where((Subscription s) => !s.unused)
          .map(
            (Subscription s) => s.copyWith(nextRenewal: DateTime(2027, 7, 21)),
          )
          .toList();
      expect(quiet, isNotEmpty);
      await _pump(tester, screen, _ListApi(quiet));
      expect(find.byKey(DataStateView.emptyKey), findsOneWidget);
      expect(find.text(en.notifNothingDue), findsOneWidget);
      expect(
        find.text(en.dataEmptyTitle),
        findsNothing,
        reason:
            'the user HAS subscriptions — "no subscriptions yet" here would '
            'be a false statement about their account',
      );
    });

    testWidgets('error: failed, with a retry, and the close survives', (
      WidgetTester tester,
    ) async {
      await _pump(tester, screen, _FailingApi());
      expect(find.byKey(DataStateView.failedKey), findsOneWidget);
      expect(find.byKey(DataStateView.retryKey), findsOneWidget);
      expect(find.byKey(E2EKeys.notificationsClose), findsOneWidget);
    });

    testWidgets('offline: the notices derive from the CACHED list', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        screen,
        await _cachedOver(_NoSignal(), DemoData.subscriptions()),
      );
      _expectNoPageState();
      expect(
        find.byKey(const Key('notifications-due-card')),
        findsOneWidget,
        reason:
            'the notices are DERIVED from the list, so a cached list is all '
            'they need — offline must not degrade to the failed state',
      );
      expect(
        find.byKey(const Key('notifications-unused-strip')),
        findsOneWidget,
      );
      expect(find.byKey(E2EKeys.notificationsClose), findsOneWidget);
    });

    testWidgets('populated: renewals soonest first, tomorrow warned, and the '
        'unused nudge', (WidgetTester tester) async {
      // ⏱ 2026-10-01 · NO-10: each due row now carries its four answers, so
      // the renewed card sits below a phone's first screen, and a `ListView`
      // does not build what it has not scrolled to. Tall enough to hold all
      // three cards: this case is about what they SAY, not where they fall.
      await _pump(
        tester,
        screen,
        _ListApi(DemoData.subscriptions()),
        size: const Size(375, 2000),
      );
      _expectNoPageState();

      final List<AppListRow> rows = tester
          .widgetList<AppListRow>(
            find.descendant(
              of: find.byKey(const Key('notifications-due-card')),
              matching: find.byType(AppListRow),
            ),
          )
          .toList();
      // Due within 7 days of 2026-07-21: Netflix (1), Copilot (3),
      // iCloud+ (4), Adobe CC (7). Spotify and ChatGPT renewed already.
      expect(rows.map((AppListRow r) => r.title), <String>[
        en.notifRenewsInDays('Netflix', 1),
        en.notifRenewsInDays('GitHub Copilot', 3),
        en.notifRenewsInDays('iCloud+', 4),
        en.notifRenewsInDays('Adobe CC', 7),
      ]);
      final List<StatusKind?> kinds = rows
          .map((AppListRow r) => (r.leading! as AppMonogram).status)
          .toList();
      expect(kinds, <StatusKind?>[StatusKind.warn, null, null, null]);

      // ST-R6 (audit C19): the two that renewed already are said, in a card
      // of their own, oldest first.
      final List<AppListRow> renewedRows = tester
          .widgetList<AppListRow>(
            find.descendant(
              of: find.byKey(const Key('notifications-renewed-card')),
              matching: find.byType(AppListRow),
            ),
          )
          .toList();
      expect(renewedRows.map((AppListRow r) => r.title), <String>[
        'Spotify',
        'ChatGPT Plus',
      ]);

      final DecisionStrip strip = tester.widget<DecisionStrip>(
        find.byKey(const Key('notifications-unused-strip')),
      );
      expect(strip.kind, StatusKind.warn);
      expect(strip.message, en.notifUnusedCount(3));
      expect(
        strip.actions,
        isEmpty,
        reason:
            'nothing in the app records usage, so the strip informs; an '
            'answer here would be a control the screen cannot honour',
      );
    });
  });
}
