// ─────────────────────────────────────────────────────────────────────────────
// data_states_test.dart — the five screens that read the subscription list tell
// LOADING, EMPTY and FAILED apart, and none of the three renders as another.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE DEFECT THIS FILE EXISTS TO KEEP FIXED
// ═══════════════════════════════════════════════════════════════════════════
// Until 2026-09-10 all five of these screens opened with some spelling of
//     ref.watch(subscriptionsControllerProvider).value ?? const []
// (budget:131, calendar:116, detail:108, insights:234, notifications:47).
// `valueOrNull` is null while a fetch is IN FLIGHT and null when it has FAILED,
// and `?? const []` renders both as a fetch that SUCCEEDED and returned
// nothing. A user whose network had just died was told, calmly and in the
// app's own empty-state voice, that they have no subscriptions.
//
// ⚠️ WHY THE NEGATIVE ASSERTIONS ARE THE POINT. Every case below asserts the
// expected state is present AND that the other two are absent, by KEY. A suite
// that only checked "the failed state shows the failure title" would have
// passed on the original defect from the day it was written, because on the
// broken code the empty state showed ITS title too and both checks were
// positive. Keys rather than copy, so a translation can never satisfy them.
//
// ⚠️ AND THE FAILING CASE MUST NOT BE ABLE TO PASS BY ACCIDENT. `_Failing`
// throws, so if a screen ever swallows the error and falls back to an empty
// list, `failedKey` is absent and `emptyKey` is present — which is precisely
// the original bug, and precisely what these cases go red on.
//
// ⚠️ `pump`, NEVER `pumpAndSettle` — the loading state holds an indeterminate
// `CircularProgressIndicator` that never quiesces. `pumpAt` from the width
// harness pumps a fixed 12 frames for exactly this reason and is reused here.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/calendar/calendar_screen.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/features/notifications/notifications_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// A repository whose `fetchAll` NEVER COMPLETES — the honest model of a slow
/// network, and the only way to hold a screen in its loading state for the
/// length of an assertion.
class _Pending implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() =>
      Completer<List<Subscription>>().future;

  @override
  Future<BudgetInfo> budget() => Completer<BudgetInfo>().future;

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

/// A repository whose `fetchAll` THROWS. The state the app used to render as
/// "you have no subscriptions".
class _Failing implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() async =>
      throw StateError('the network is down');

  @override
  Future<BudgetInfo> budget() async => throw StateError('the network is down');

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

/// A repository that SUCCEEDS and genuinely has nothing. The only one of the
/// three for which "no subscriptions yet" is a true sentence.
class _Empty implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() async => const <Subscription>[];

  @override
  Future<BudgetInfo> budget() async => const BudgetInfo(
    monthlyBudget: Money(500000, 'USD'),
    categories: <BudgetCap>[],
  );

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

List<Override> _repo(SubscriptionRepository r) => <Override>[
  subscriptionRepositoryProvider.overrideWithValue(r),
];

/// Exactly one of the three state keys is on screen, and it is [present].
///
/// The absent half is the half that can fail — see the header.
void expectOnlyState(Key present, String screen) {
  for (final Key k in <Key>[
    DataStateView.loadingKey,
    DataStateView.emptyKey,
    DataStateView.failedKey,
  ]) {
    expect(
      find.byKey(k),
      k == present ? findsOneWidget : findsNothing,
      reason: k == present
          ? '$screen did not render the state under test at all'
          : '$screen rendered a SECOND state beside the one under test. The '
                'three are mutually exclusive branches; two at once is how '
                '"failed" and "empty" were one screen in the first place',
    );
  }
}

void main() {
  // The five screens, each built the way its route builds it. `detail` is given
  // an id nothing will match, which is deliberate: on the EMPTY repository its
  // genuine outcome is "no such record", and that is the state it must show
  // rather than a failure.
  final Map<String, Widget> screens = <String, Widget>{
    'calendar': const CalendarScreen(),
    'insights': const InsightsScreen(),
    'notifications': const NotificationsScreen(),
    'detail': const SubscriptionDetailScreen(id: 'no-such-id'),
  };

  group('a fetch IN FLIGHT is a loading state, on every screen', () {
    // ⏱ 2026-09-28 · train ST-D5: NOTIFICATIONS' loading state is the LIST'S
    // OWN OUTLINE — a `SkeletonList` in the card the rows arrive in — not the
    // whole-surface spinner. Its case asserts THAT key, and still asserts the
    // other three state keys absent: a skeleton beside "failed" or "empty" is
    // two states at once, the defect the whole file exists to catch.
    const Set<String> skeletonLoaders = <String>{'notifications'};
    screens.forEach((String name, Widget screen) {
      testWidgets('$name shows loading, and neither empty nor failed', (
        WidgetTester tester,
      ) async {
        await pumpAt(tester, kPhone, screen, overrides: _repo(_Pending()));
        if (skeletonLoaders.contains(name)) {
          expect(find.byKey(SkeletonList.skeletonKey), findsOneWidget);
          for (final Key k in <Key>[
            DataStateView.loadingKey,
            DataStateView.emptyKey,
            DataStateView.failedKey,
          ]) {
            expect(find.byKey(k), findsNothing, reason: '$name: $k');
          }
          return;
        }
        expectOnlyState(DataStateView.loadingKey, name);
        expect(find.byType(CircularProgressIndicator), findsWidgets);
      });
    });
  });

  group('a FAILED fetch is an error state with a retry, on every screen', () {
    screens.forEach((String name, Widget screen) {
      testWidgets('$name shows failed, and offers a retry', (
        WidgetTester tester,
      ) async {
        await pumpAt(tester, kPhone, screen, overrides: _repo(_Failing()));
        expectOnlyState(DataStateView.failedKey, name);
        expect(
          find.byKey(DataStateView.retryKey),
          findsOneWidget,
          reason:
              'a failure a user can read but not act on is a dead end, and '
              'the dead end is what this whole change exists to remove',
        );
      });
    });
  });

  group('a SUCCESSFUL fetch of nothing is an empty state, on every screen', () {
    screens.forEach((String name, Widget screen) {
      testWidgets('$name shows empty, with NO retry offered', (
        WidgetTester tester,
      ) async {
        await pumpAt(tester, kPhone, screen, overrides: _repo(_Empty()));
        expectOnlyState(DataStateView.emptyKey, name);
        expect(
          find.byKey(DataStateView.retryKey),
          findsNothing,
          reason:
              'a retry on the empty state tells a user their empty account '
              'is a malfunction — and it is the one edit that would make the '
              'empty state look like the failed one again',
        );
      });
    });
  });

  group('the chrome survives every state', () {
    // 🔴 THE DEAD-END CHECK. `notifications` and `detail` are PUSHED routes that
    // own their own chrome; the other three are shell tabs whose navigation the
    // chassis draws. `home_screen.dart:363` records what happens when a gate is
    // put around the chrome instead of inside it: a spinner ate the only route
    // off the screen. These two cases are what stop that being re-introduced
    // here, where it would bite hardest — during a failure, which is exactly
    // when a user wants out.
    testWidgets('notifications keeps its close control while loading', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const NotificationsScreen(),
        overrides: _repo(_Pending()),
      );
      expect(find.byIcon(Icons.close), findsOneWidget);
    });

    testWidgets('notifications keeps its close control when the fetch failed', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const NotificationsScreen(),
        overrides: _repo(_Failing()),
      );
      expect(find.byIcon(Icons.close), findsOneWidget);
      expect(find.byKey(DataStateView.retryKey), findsOneWidget);
    });

    testWidgets('detail keeps an app bar in all three states', (
      WidgetTester tester,
    ) async {
      for (final SubscriptionRepository r in <SubscriptionRepository>[
        _Pending(),
        _Failing(),
        _Empty(),
      ]) {
        await pumpAt(
          tester,
          kPhone,
          const SubscriptionDetailScreen(id: 'no-such-id'),
          overrides: _repo(r),
        );
        expect(
          find.byType(AppBar),
          findsOneWidget,
          reason:
              'this route is reachable by a reloaded URL, so on a cold load '
              'the app bar is the only chrome on screen — a state that drops '
              'it is a screen with no way back',
        );
      }
    });
  });
}
