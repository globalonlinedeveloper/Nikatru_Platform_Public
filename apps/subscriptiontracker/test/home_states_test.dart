// ─────────────────────────────────────────────────────────────────────────────
// home_states_test.dart — train ST-D1. Home in each of its five states, and
// never in two at once.
//
//   LOADING    — the list's own outline (`SkeletonList`), announced once.
//   FAILED     — a sentence and a Retry, never the exception string.
//   EMPTY      — "No subscriptions yet", with NO retry.
//   OFFLINE    — the shell's one offline notice, with the user's cached list
//                still under it; offline with nothing cached is FAILED.
//   POPULATED  — summary, the unused decision, upcoming, every subscription.
//
// ⚠️ WHY EVERY CASE ASSERTS THE OTHER STATES ABSENT, BY KEY. The defect this
// shape exists to keep fixed (`data_states_test.dart`'s header) is two states
// collapsing into one: "failed" rendered as "empty" told a user whose network
// had died that they had no subscriptions. A check that only looks for the
// state under test passes on exactly that defect. Keys, not copy, so a
// translation can never satisfy them.
//
// ⚠️ AND THE HEADER IS ASSERTED IN EVERY STATE: it is the route to
// notifications and settings, and a state that hid it would be a screen with no
// door (the old home's spinner did exactly that before its header moved out).
//
// `pump`, never `pumpAndSettle`: `pumpAt` pumps a fixed 12 frames.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart'
    show OfflineBannerHost;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/home/home_signals.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/home_fixture.dart';
import 'support/width_harness.dart';

/// `fetchAll` never completes: the only honest way to hold LOADING.
class _Pending implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() =>
      Completer<List<Subscription>>().future;

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

/// `fetchAll` throws [failures] times, then answers [then].
class _Flaky implements SubscriptionRepository {
  _Flaky({this.failures = 1 << 30, this.then = const <Subscription>[]});

  int failures;
  final List<Subscription> then;
  int calls = 0;

  @override
  Future<List<Subscription>> fetchAll() async {
    calls++;
    if (failures > 0) {
      failures--;
      throw StateError('the network is down');
    }
    return then;
  }

  @override
  Future<BudgetInfo> budget() async => throw StateError('not under test');

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

class _Unreachable extends NetworkReachabilityController {
  @override
  bool build() => true;
}

List<Override> _repo(SubscriptionRepository r) => <Override>[
  subscriptionRepositoryProvider.overrideWithValue(r),
  nowProvider.overrideWithValue(() => kHomeFixtureNow),
];

/// The five state markers, and which one is on screen.
enum _State { loading, failed, empty, populated }

Key _keyOf(_State s) => switch (s) {
  _State.loading => SkeletonList.skeletonKey,
  _State.failed => DataStateView.failedKey,
  _State.empty => DataStateView.emptyKey,
  _State.populated => HomeScreen.summaryKey,
};

void _expectOnly(_State present) {
  for (final _State s in _State.values) {
    expect(
      find.byKey(_keyOf(s)),
      s == present ? findsOneWidget : findsNothing,
      reason: s == present
          ? 'home did not render the ${s.name} state at all'
          : 'home rendered ${s.name} BESIDE ${present.name} — the states are '
                'exclusive branches, and two at once is how "failed" and '
                '"empty" were one screen in the first place',
    );
  }
  // The header is outside the states, so it survives every one of them.
  expect(
    find.byIcon(Icons.notifications_none_rounded),
    findsOneWidget,
    reason: 'the route to notifications vanished in the ${present.name} state',
  );
}

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

/// Home under the shell's offline notice, wired the way `app.dart`'s
/// `_OfflineBanner` wires it.
class _OfflineHost extends ConsumerWidget {
  const _OfflineHost();

  @override
  Widget build(BuildContext context, WidgetRef ref) => OfflineBannerHost(
    unreachable: ref.watch(networkUnreachableProvider),
    onRetry: () {},
    child: const HomeScreen(),
  );
}

void main() {
  testWidgets('LOADING is the list outline, announced once', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await pumpAt(
      tester,
      kPhone,
      const HomeScreen(),
      overrides: _repo(_Pending()),
    );
    _expectOnly(_State.loading);
    final AppLocalizations l10n = await _en();
    expect(
      find.bySemanticsLabel(l10n.dataLoading),
      findsOneWidget,
      reason: 'the placeholder rows are excluded; the label is the one node',
    );
    expect(
      find.byType(CircularProgressIndicator),
      findsNothing,
      reason: 'a list about to fill shows its outline, not a spinner',
    );
    handle.dispose();
  });

  testWidgets('FAILED is a sentence and a Retry — never the exception', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      kPhone,
      const HomeScreen(),
      overrides: _repo(_Flaky()),
    );
    _expectOnly(_State.failed);
    final AppLocalizations l10n = await _en();
    expect(find.text(l10n.dataFailedTitle), findsOneWidget);
    expect(find.byKey(DataStateView.retryKey), findsOneWidget);
    expect(
      find.textContaining('the network is down'),
      findsNothing,
      reason:
          'the old home printed `couldNotLoad(\'\$e\')` — a stack-adjacent '
          'string in front of the user',
    );
  });

  testWidgets('Retry re-runs the fetch, and a recovery is POPULATED', (
    WidgetTester tester,
  ) async {
    final _Flaky repo = _Flaky(failures: 1, then: homeFixture());
    await pumpAt(tester, kPhone, const HomeScreen(), overrides: _repo(repo));
    _expectOnly(_State.failed);
    await tester.tap(find.byKey(DataStateView.retryKey));
    for (int i = 0; i < 12; i++) {
      await tester.pump();
    }
    expect(repo.calls, 2, reason: 'Retry must ask the repository again');
    _expectOnly(_State.populated);
  });

  testWidgets('EMPTY says so, and offers NO retry', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      kPhone,
      const HomeScreen(),
      overrides: _repo(_Flaky(failures: 0)),
    );
    _expectOnly(_State.empty);
    final AppLocalizations l10n = await _en();
    expect(find.text(l10n.dataEmptyTitle), findsOneWidget);
    expect(
      find.byKey(DataStateView.retryKey),
      findsNothing,
      reason: 'a retry tells a user their empty account is a malfunction',
    );
  });

  group('OFFLINE', () {
    testWidgets('with a cached list: ONE notice, and the list under it', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const _OfflineHost(),
        overrides: <Override>[
          ..._repo(_Flaky(failures: 0, then: homeFixture())),
          networkUnreachableProvider.overrideWith(_Unreachable.new),
        ],
      );
      _expectOnly(_State.populated);
      expect(
        find.byType(OfflineNotice),
        findsOneWidget,
        reason:
            'the shell\'s notice is the ONE offline surface; home adds no '
            'second banner of its own',
      );
      // The search and the decisions sit above the list now (HO-03/05), so
      // on a phone the first row is a scroll away — still the user's list.
      await tester.scrollUntilVisible(
        find.text(homeFixture().first.name),
        200,
        scrollable: find
            .descendant(
              of: find.byKey(HomeScreen.listPaneKey),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(
        find.text(homeFixture().first.name),
        findsWidgets,
        reason: 'being offline does not take the user\'s list away',
      );
    });

    testWidgets('with nothing cached: the FAILED state, with its Retry', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const _OfflineHost(),
        overrides: <Override>[
          ..._repo(_Flaky()),
          networkUnreachableProvider.overrideWith(_Unreachable.new),
        ],
      );
      _expectOnly(_State.failed);
      expect(find.byType(OfflineNotice), findsOneWidget);
      expect(find.byKey(DataStateView.retryKey), findsOneWidget);
    });
  });

  group('POPULATED', () {
    testWidgets('summary, the unused decision, upcoming and every row', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        const Size(375, 2400),
        const HomeScreen(),
        overrides: _repo(_Flaky(failures: 0, then: homeFixture())),
      );
      _expectOnly(_State.populated);
      final AppLocalizations l10n = await _en();
      final List<Subscription> subs = homeFixture();

      // HO-05: the fixture raises a yearly plan due in 40 days and two rows
      // flagged rarely used; Home asks the most urgent, the yearly one.
      expect(
        find.byKey(HomeScreen.signalKey(HomeSignalKind.yearlyDue, 'adb')),
        findsOneWidget,
      );
      expect(find.byType(DecisionStrip), findsOneWidget);
      expect(
        find.text(l10n.homeSignalStillUsing(subs[2].name)),
        findsNothing,
        reason: 'one decision at a time',
      );
      expect(find.byKey(HomeScreen.upcomingKey), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(HomeScreen.allKey),
          matching: find.byType(AppListRow),
        ),
        findsNWidgets(subs.length),
        reason: 'every subscription is one row in the all-subscriptions group',
      );
      expect(
        find.text(l10n.activeCount(subs.length)),
        findsOneWidget,
        reason: 'the "N active" fact is what the store capture records',
      );
    });

    testWidgets('a renewal within a day is a warn STATUS, carried by words', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        const Size(375, 2400),
        const HomeScreen(),
        overrides: _repo(_Flaky(failures: 0, then: homeFixture())),
      );
      final AppLocalizations l10n = await _en();
      final AppListRow tomorrow = tester.widget<AppListRow>(
        find.descendant(
          of: find.byKey(HomeScreen.upcomingKey),
          matching: find.widgetWithText(AppListRow, l10n.renewsTomorrow),
        ),
      );
      expect(tomorrow.status, StatusKind.warn);
      expect(tomorrow.subtitle, l10n.renewsTomorrow);
    });

    testWidgets('a decision answer opens its subscription', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        const Size(375, 2400),
        const HomeScreen(),
        overrides: _repo(_Flaky(failures: 0, then: homeFixture())),
      );
      await tester.tap(
        find.byKey(HomeScreen.signalActionKey(HomeSignalKind.yearlyDue, 'adb')),
      );
      await tester.pump();
      // `pumpAt` builds no router, so "this tap reached go_router" and "this
      // tap threw" are the same event — the width tests' idiom.
      expect(
        tester.takeException(),
        isNotNull,
        reason: 'the answer must navigate, not merely look like a button',
      );
    });
  });

  // THE PLATFORM-OWNED TEXT SCALE. Every target lets the user raise it (Android
  // font size, iOS Dynamic Type, the desktop and browser zoom), and a dashboard
  // of figures is where it overflows first. 200 % on the narrowest phone the
  // row names (360) is the harshest case the matrix asks for.
  for (final _State s in <_State>[
    _State.populated,
    _State.failed,
    _State.empty,
  ]) {
    testWidgets('${s.name} lays out clean at 200 % text on a 360 px phone', (
      WidgetTester tester,
    ) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final SubscriptionRepository repo = switch (s) {
        _State.populated => _Flaky(failures: 0, then: homeFixture()),
        _State.empty => _Flaky(failures: 0),
        _ => _Flaky(),
      };
      await pumpAt(
        tester,
        const Size(360, 2400),
        const HomeScreen(),
        overrides: _repo(repo),
      );
      _expectOnly(s);
      expect(
        tester.takeException(),
        isNull,
        reason: 'a RenderFlex overflow at 200 % is a clipped figure for real',
      );
    });
  }
}
